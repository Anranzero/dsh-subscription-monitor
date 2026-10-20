import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncHarnessModels, removeHarnessModels } from '../lib/oauth/harness-sync.js'
import { AuthController } from '../lib/oauth/controller.js'
import { saveSession, switchAccount, deleteSession, accountIdOf } from '../lib/oauth/store.js'
import { catalogProviders } from '../lib/oauth/models.js'
import { registerEngineHosts, configureEngineBridge, resetEngineBridge } from '../lib/upstream-engine/bridge.js'

const origin = 'http://127.0.0.1:8318'
const chat = 'deepseek/deepseek-v4.1-flash'
const claude = 'claude-haiku-5-5'
function fixture() {
  const providers: Record<string, any> = {}
  return {
    providers,
    async describe() { return [{ ns: 'llm-pi-ai', value: { providers } }] },
    async mutate(_ns: string, mutations: any[]) {
      for (const row of mutations) {
        if (row.op === 'unset') delete providers[row.path[1]]
        else providers[row.path[1]] = row.value
      }
    },
  }
}

test('key routes use official SDK base URLs and preserve selection, aliases and context', async () => {
  const settings = fixture()
  const catalog = catalogProviders({ prefix: 'oauth', origin })
  const ollama = catalog['oauth-ollama'].models[0].id
  const minimax = catalog['oauth-minimax'].models[0].id
  await syncHarnessModels({ settings, prefix: 'oauth', origin,
    loggedIn: { 'command-code': true, ollama: true, minimax: true },
    selected: [`oauth-command-code/${chat}`, `oauth-command-code/${claude}`, `oauth-ollama/${ollama}`, `oauth-minimax/${minimax}`],
    contexts: { [`oauth-command-code/${claude}`]: 100000 },
  })
  for (const [id, baseURL, apiKeyEnv] of [
    ['oauth-command-code', 'https://api.commandcode.ai/provider/v1', 'DSH_SUBS_COMMAND_CODE_API_KEY'],
    ['oauth-command-code-messages', 'https://api.commandcode.ai/provider', 'DSH_SUBS_COMMAND_CODE_API_KEY'],
    ['oauth-minimax', 'https://api.minimax.cn/v1', 'DSH_SUBS_MINIMAX_API_KEY'],
    ['oauth-ollama', 'https://ollama.com/v1', 'DSH_SUBS_OLLAMA_API_KEY'],
  ]) {
    const route = settings.providers[id]
    assert.ok(route, id)
    assert.equal(route.baseURL, baseURL)
    assert.equal(route.apiKeyEnv, apiKeyEnv)
    assert.equal(route.cacheRetention, undefined, 'do not force OpenAI cache parameters on direct vendors')
  }
  assert.deepEqual(settings.providers['oauth-command-code'].models.map((m: any) => m.id), [chat])
  const messages = settings.providers['oauth-command-code-messages']
  assert.equal(messages.api, 'anthropic-messages')
  assert.equal(messages.compat, undefined)
  assert.equal(messages.models[0].id, claude)
  assert.equal(messages.models[0].name, 'Command Code/Claude Haiku 5.5')
  assert.equal(messages.models[0].contextWindow, 100000)
  assert.ok(catalog['oauth-command-code'].models.some((m: any) => m.id === claude), 'picker keys stay stable')
})

test('Command Code Go retains its required adapter and a later sync removes stale Messages routes', async () => {
  const settings = fixture()
  const options = { settings, prefix: 'oauth', origin, loggedIn: { 'command-code': true },
    selected: [`oauth-command-code/${claude}`] }
  await syncHarnessModels(options)
  assert.ok(settings.providers['oauth-command-code-messages'])
  await syncHarnessModels({ ...options, commandCodePlan: 'individual-go' })
  assert.equal(settings.providers['oauth-command-code-messages'], undefined)
  assert.equal(settings.providers['oauth-command-code'].baseURL, `${origin}/command-code`)
  assert.equal(settings.providers['oauth-command-code'].apiKeyEnv, 'DSH_OAUTH_SUBS_API_KEY')
})

test('withdrawal handles both migrated direct and legacy routes without deleting user routes', async () => {
  const settings = fixture()
  await syncHarnessModels({ settings, prefix: 'oauth', origin, loggedIn: { 'command-code': true, minimax: true } })
  settings.providers['oauth-ollama'] = { api: 'openai-completions', apiKeyEnv: 'DSH_OAUTH_SUBS_API_KEY', baseURL: `${origin}/ollama` }
  settings.providers['oauth-minimax'].apiKeyEnv = 'MY_MINIMAX_KEY'
  const removed = await removeHarnessModels({ settings, prefix: 'oauth', origin })
  assert.ok(removed.includes('oauth-command-code'))
  assert.ok(removed.includes('oauth-command-code-messages'))
  assert.ok(removed.includes('oauth-ollama'))
  assert.ok(settings.providers['oauth-minimax'])
})

test('native inference bypasses the engine fetch bridge while quota and CLI keep their outbound lane', async () => {
  const original = globalThis.fetch
  const native: string[] = []
  const engine: string[] = []
  try {
    globalThis.fetch = async (input: any) => { native.push(String(input)); return new Response('{}') }
    configureEngineBridge({ fetchFn: async (input: any) => { engine.push(String(input)); return new Response('{}') } })
    registerEngineHosts('command-code', ['api.commandcode.ai'], {
      directPaths: ['/provider/v1/chat/completions', '/provider/v1/messages', '/provider/v1/responses'],
    })
    for (const path of ['chat/completions', 'messages', 'responses']) await fetch(`https://api.commandcode.ai/provider/v1/${path}`)
    await fetch('https://api.commandcode.ai/alpha/billing/credits')
    await fetch('https://api.commandcode.ai/alpha/generate')
    assert.equal(native.length, 3)
    assert.equal(engine.length, 2)
    resetEngineBridge()
    assert.equal(globalThis.fetch !== original, true, 'reset restores the captured native fetch')
  } finally {
    resetEngineBridge()
    globalThis.fetch = original
  }
})

test('controller mirrors the active key before publishing routes, switches it, and clears a removed account', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-direct-'))
  const settings = fixture()
  const keys = new Map<string, string>()
  const authPath = join(dir, 'auth.json')
  const session = (key: string, account: string) => ({ accessToken: key, refreshToken: key, account, expiresAt: Number.MAX_SAFE_INTEGER })
  const ref = 'DSH_SUBS_MINIMAX_API_KEY'
  const first = session('fixture-first', 'first')
  const second = session('fixture-second', 'second')
  let ctl: AuthController | undefined
  try {
    await saveSession('minimax', first, authPath)
    ctl = new AuthController({ authPath, prefix: 'oauth', origin: () => origin, settings,
      credentials: {
        async resolve(id: string) { return { value: keys.get(id) } },
        async set(id: string, key: string) { keys.set(id, key) },
        async unset(id: string) { keys.delete(id) },
      },
    })
    const mutate = settings.mutate.bind(settings)
    settings.mutate = async (ns, rows) => {
      if (rows.some(row => row.op === 'set' && row.path[1] === 'oauth-minimax')) assert.ok(keys.has(ref), 'credential must exist first')
      await mutate(ns, rows)
    }
    await ctl.sync()
    assert.equal(keys.get(ref), first.accessToken)
    await saveSession('minimax', second, authPath)
    await ctl.sync()
    assert.equal(keys.get(ref), second.accessToken)
    await switchAccount('minimax', accountIdOf('minimax', first), authPath)
    await ctl.sync()
    assert.equal(keys.get(ref), first.accessToken)
    assert.ok(!JSON.stringify(settings.providers).includes('fixture-'))
    await deleteSession('minimax', authPath)
    await ctl.sync()
    assert.equal(keys.get(ref), second.accessToken, 'removing the active account selects the remaining one')
    await deleteSession('minimax', authPath)
    await ctl.sync()
    assert.equal(keys.has(ref), false)
    assert.equal(settings.providers['oauth-minimax'], undefined)
  } finally {
    await ctl?.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
