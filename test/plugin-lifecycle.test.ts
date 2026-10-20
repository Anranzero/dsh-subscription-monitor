import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AuthController } from '../lib/oauth/controller.js'
import { saveSession } from '../lib/oauth/store.js'
import { ModelSwitch } from '../lib/oauth/model-switch.js'
import { catalogProviders, OAUTH_CREDENTIAL_REF } from '../lib/oauth/models.js'
import { removeHarnessModels } from '../lib/oauth/harness-sync.js'
import { opencodeGoRoutes } from '../lib/apikey/opencode-go/models.js'
import { createServer } from 'node:net'
import { apply } from '../lib/index.js'

const origin = 'http://127.0.0.1:8318'
function settingsFixture(initial: Record<string, any> = {}) {
  const providers = structuredClone(initial)
  let beforeWrite = async () => {}
  return {
    providers,
    block(fn: () => Promise<void>) { beforeWrite = fn },
    async describe() { return [{ ns: 'llm-pi-ai', value: { providers } }] },
    async mutate(_ns: string, mutations: any[]) {
      await beforeWrite()
      for (const row of mutations) {
        if (row.op === 'unset') delete providers[row.path[1]]
        else providers[row.path[1]] = row.value
      }
    },
  }
}
async function temporary(run: (dir: string) => Promise<void>) {
  const base = resolve(tmpdir(), 'dsh-lifecycle-')
  const dir = await mkdtemp(base)
  try { await run(dir) } finally {
    assert.ok(resolve(dir).startsWith(base))
    await rm(dir, { recursive: true, force: true })
  }
}
test('withdrawal removes owned OAuth/OpenCode routes and preserves user routes', async () => {
  const catalog = catalogProviders({ prefix: 'oauth', origin })
  const direct = opencodeGoRoutes()[0]
  const settings = settingsFixture({
    'oauth-codex': catalog['oauth-codex'],
    'oauth-zed-responses': catalog['oauth-zed-responses'],
    [direct.id]: { ...catalog[direct.id], models: [catalog[direct.id].models[0]] },
    'oauth-grok': { ...catalog['oauth-grok'], baseURL: 'https://user.example/v1' },
    custom: { apiKeyEnv: OAUTH_CREDENTIAL_REF, baseURL: origin },
    'opencode-go': { apiKeyEnv: 'MY_KEY' },
  })
  const user = structuredClone(settings.providers['oauth-grok'])
  const removed = await removeHarnessModels({ settings, prefix: 'oauth', origin })
  assert.ok(removed.includes('oauth-codex'))
  assert.ok(removed.includes('oauth-zed-responses'))
  assert.ok(removed.includes(direct.id))
  assert.deepEqual(settings.providers['oauth-grok'], user)
  assert.ok(settings.providers.custom)
  assert.ok(settings.providers['opencode-go'])
})
test('disable drains writes, rejects late sync, and re-enable restores the saved selection', async () => {
  await temporary(async dir => {
    const authPath = join(dir, 'auth.json')
    const path = join(dir, 'models.json')
    await saveSession('codex', { accessToken: 'fixture', refreshToken: 'fixture', accountId: 'account', expiresAt: Date.now() + 3600000 }, authPath)
    const settings = settingsFixture()
    const models = new ModelSwitch({ path })
    await models.ready
    await models.setEnabled(['oauth-codex/gpt-6.1-sol'], catalogProviders({ prefix: 'oauth', origin }))
    const options = { authPath, prefix: 'oauth', origin: () => origin, settings, models }
    const ctl = new AuthController(options)
    await ctl.sync()
    assert.equal(settings.providers['oauth-codex'].models.length, 1)
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const blocked = new Promise<void>(resolve => { release = resolve })
    settings.block(async () => { entered(); await blocked })
    const writing = ctl.sync()
    await started
    const disposing = ctl.dispose()
    release()
    await Promise.all([writing, disposing])
    await ctl.sync()
    assert.equal(settings.providers['oauth-codex'], undefined)
    const restored = new AuthController({ ...options, models: new ModelSwitch({ path }) })
    await restored.sync()
    assert.deepEqual(settings.providers['oauth-codex'].models.map((row: any) => row.id), ['gpt-6.1-sol'])
    await restored.dispose()
  })
})
test('an old instance cannot remove routes owned by its reload replacement', async () => {
  await temporary(async dir => {
    const settings = settingsFixture({ 'oauth-codex': catalogProviders({ prefix: 'oauth', origin })['oauth-codex'] })
    const options = { authPath: join(dir, 'auth.json'), prefix: 'oauth', origin: () => origin, settings }
    const old = new AuthController(options)
    await old.loginsReady
    const replacement = new AuthController(options)
    await replacement.loginsReady
    await old.dispose()
    assert.ok(settings.providers['oauth-codex'])
    await replacement.dispose()
    assert.equal(settings.providers['oauth-codex'], undefined)
  })
})

test('the real plugin apply starts its proxy before sync and disposes owned routes', async () => {
  await temporary(async dir => {
    const reservation = createServer()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const port = (reservation.address() as any).port
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    const settings = settingsFixture()
    const disposers: (() => any)[] = []
    const routes = new Map<string, any>()
    const errors: string[] = []
    let started!: () => void
    const listening = new Promise<void>(resolve => { started = resolve })
    const ctx = {
      settings, credentials: { async set() {} },
      connection: { fetch: { register(route: any) { routes.set(route.path, route) } }, rpc: { handle() {} } },
      logger: { info(message: string) { if (message.includes('proxy on')) started() },
        warn() {}, error(message: string) { errors.push(message); started() } },
      inject(_services: string[], callback: any) { callback(ctx) },
      effect(callback: any, label: string) {
        // External updater jobs are independent of proxy startup and route disposal.
        if (label.endsWith('auto-update watch') || label.endsWith('upstream engine watch')) return
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
    }
    try {
      apply(ctx, { dataDir: dir, port })
      await listening
      assert.deepEqual(errors, [])
      const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json()
      assert.equal(health.ok, true)
      assert.equal(health.codexTransport.mode, 'auto')
      const sync = await routes.get('/api/oauth-subs-auth/sync').fetch(
        new Request('http://localhost/api/oauth-subs-auth/sync', { method: 'POST', body: '{}' }))
      assert.equal(sync.status, 200)
      const actualOrigin = `http://127.0.0.1:${port}`
      settings.providers['oauth-codex'] = catalogProviders({ prefix: 'oauth', origin: actualOrigin })['oauth-codex']
    } finally {
      await Promise.all(disposers.map(dispose => dispose()))
    }
    assert.equal(settings.providers['oauth-codex'], undefined)
  })
})

test('disabling during startup removes stale routes without starting a late proxy', async () => {
  await temporary(async dir => {
    const settings = settingsFixture({
      'oauth-codex': catalogProviders({ prefix: 'oauth', origin: 'http://127.0.0.1:0' })['oauth-codex'],
    })
    const disposers: (() => any)[] = []
    const messages: string[] = []
    const ctx = {
      settings, credentials: { async set() {} },
      connection: { fetch: { register() {} }, rpc: { handle() {} } },
      logger: { info(message: string) { messages.push(message) },
        warn() {}, error(message: string) { messages.push(message) } },
      inject(_services: string[], callback: any) { callback(ctx) },
      effect(callback: any, label: string) {
        if (label.endsWith('watch') || label.endsWith('sweep')) return
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
    }
    apply(ctx, { dataDir: dir, port: 0 })
    await Promise.all(disposers.map(dispose => dispose()))
    assert.equal(settings.providers['oauth-codex'], undefined)
    assert.deepEqual(messages, [])
  })
})
