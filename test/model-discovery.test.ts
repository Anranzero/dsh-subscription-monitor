import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { toCodexPickerModels, refreshCodexCatalog, codexCatalogModels, resetCodexCatalogCache } from '../lib/oauth/codex/catalog.js'
import { toGrokPickerModels } from '../lib/oauth/grok/catalog.js'
import { toAntigravityPickerModels } from '../lib/oauth/antigravity/catalog.js'
import { toMinimaxPickerModels, refreshMinimaxCatalog, minimaxCatalogModels, resetMinimaxCatalogCache } from '../lib/apikey/minimax/catalog.js'
import { ModelSwitch } from '../lib/oauth/model-switch.js'
import { AuthController } from '../lib/oauth/controller.js'
import { saveSession, deleteSession } from '../lib/oauth/store.js'
import { buildProviders, catalogProviders } from '../lib/oauth/models.js'
import { applyFastMode } from '../lib/utils/fast-mode.js'
import { normalizeGrokModel } from '../lib/oauth/grok/request.js'
import { refreshGrokCatalog, resetGrokCatalogCache } from '../lib/oauth/grok/catalog.js'

const codexRow = {
  slug: 'test-codex-next', display_name: 'Next Codex', visibility: 'list',
  context_window: 300000, max_context_window: 600000,
  input_modalities: ['text', 'image'],
  supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
  service_tiers: [{ id: 'priority' }],
}
const response = (body: any) => new Response(JSON.stringify(body))
async function temporary(run: (dir: string) => Promise<void>) {
  const base = resolve(tmpdir(), 'dsh-model-discovery-')
  const dir = await mkdtemp(base)
  try { await run(dir) } finally {
    assert.ok(resolve(dir).startsWith(base))
    await rm(dir, { recursive: true, force: true })
  }
}

test('Codex discovers visible metadata, omitting hidden and incomplete rows', () => {
  const rows = toCodexPickerModels({ models: [
    codexRow, { ...codexRow, slug: 'hidden', visibility: 'hide' },
    { slug: 'no-window', visibility: 'list' }, codexRow,
  ] })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].contextWindow, 300000)
  assert.equal(rows[0].maxContextWindow, 600000)
  assert.equal(rows[0].fastTier, true)
  assert.equal(rows[0].reasoningEfforts.high, 'high')
})

test('Antigravity filters disabled, internal and non-agent rows', () => {
  const rows = toAntigravityPickerModels({ models: {
    'test-gemini-next': { displayName: 'Next Gemini', maxTokens: 900000, maxOutputTokens: 50000, supportsImages: true },
    hidden: { displayName: 'Internal', maxTokens: 10000, isInternal: true },
    disabled: { displayName: 'Disabled', maxTokens: 10000, disabled: true },
    tab_only: { maxTokens: 10000 },
  } })
  assert.deepEqual(rows.map(row => row.id), ['test-gemini-next'])
  assert.equal(rows[0].contextWindow, 900000)
  assert.deepEqual(rows[0].input, ['text', 'image'])
})

test('Grok only offers the Responses backend with sourced context limits', () => {
  const rows = toGrokPickerModels({ data: [
    { id: 'test-grok-next-fast', context_window: 400000, api_backend: 'responses' },
    { id: 'wrong-wire', context_window: 400000, api_backend: 'completions' },
    { id: 'no-window', api_backend: 'responses' },
  ] })
  assert.deepEqual(rows.map(row => row.id), ['test-grok-next-fast'])
})

test('MiniMax account membership is required; metadata only supplies parameters', () => {
  const rows = toMinimaxPickerModels({ data: [{ id: 'test-minimax-next' }, { id: 'no-metadata' }] }, {
    minimax: { models: {
      'test-minimax-next': { name: 'Next MiniMax', limit: { context: 250000, output: 32000 }, modalities: { input: ['text'] } },
      'not-on-account': { limit: { context: 250000 } },
    } },
  })
  assert.deepEqual(rows.map(row => row.id), ['test-minimax-next'])
  assert.equal(rows[0].maxTokens, 32000)
})

test('MiniMax retains discovered models when public parameter metadata becomes unavailable', async () => {
  resetMinimaxCatalogCache()
  try {
    let offline = false
    const session = { accessToken: 'fixture' }
    const fetchFn = async (url: string, init: any) => {
      if (url.includes('models.dev')) {
        assert.equal(init.headers, undefined)
        if (offline) throw new Error('metadata unavailable')
        return response({ minimax: { models: { 'test-minimax-next': { limit: { context: 250000 } } } } })
      }
      return response({ data: [{ id: 'test-minimax-next' }] })
    }
    await refreshMinimaxCatalog(session, { fetchFn, ttlMs: 0 })
    assert.ok(minimaxCatalogModels().some(row => row.id === 'test-minimax-next'))
    offline = true
    await refreshMinimaxCatalog(session, { fetchFn, ttlMs: 0 })
    assert.ok(minimaxCatalogModels().some(row => row.id === 'test-minimax-next'))
  } finally { resetMinimaxCatalogCache() }
})

test('discovery keeps the last good catalog on error and updates live wire aliases', async () => {
  resetCodexCatalogCache()
  resetGrokCatalogCache()
  try {
    const session = { accessToken: 'fixture', accountId: 'account' }
    await refreshCodexCatalog(session, { ttlMs: 0, fetchFn: async () => response({ models: [codexRow] }) })
    assert.equal(applyFastMode({ model: 'test-codex-next-fast' }).service_tier, 'priority')
    const before = codexCatalogModels()
    await refreshCodexCatalog(session, { ttlMs: 0, fetchFn: async () => { throw new Error('offline') } })
    assert.deepEqual(codexCatalogModels(), before)
    await refreshGrokCatalog(session, { fetchFn: async () => response({ data: [
      { id: 'test-grok-next-fast', context_window: 400000, api_backend: 'responses' },
    ] }) })
    assert.equal(normalizeGrokModel({ model: 'test-grok-next-fast' }).model, 'test-grok-next-fast')
    const providers = buildProviders({ prefix: 'oauth', origin: 'http://localhost', loggedIn: { codex: true }, codexModels: before })
    assert.ok(providers['oauth-codex'].models.some(row => row.id === 'test-codex-next-fast'))
    assert.ok(catalogProviders({ prefix: 'oauth', origin: 'http://localhost', codexModels: before })['oauth-codex'].models.some(row => row.id === 'test-codex-next'))
  } finally {
    resetCodexCatalogCache()
    resetGrokCatalogCache()
  }
})

test('new models start off; existing choices and later enables survive restart', async () => {
  await temporary(async dir => {
    const path = join(dir, 'models.json')
    const catalog = (ids: string[]) => ({ 'oauth-codex': { models: ids.map(id => ({ id })) } })
    const models = new ModelSwitch({ path })
    await models.ready
    const old = catalog(['old-on', 'old-off'])
    await models.toggle('oauth-codex/old-off', false, old)
    await models.rememberDiscovered(old, catalog(['old-on', 'old-off', 'new']))
    assert.equal(models.isEnabled('oauth-codex/old-on'), true)
    assert.equal(models.isEnabled('oauth-codex/old-off'), false)
    assert.equal(models.isEnabled('oauth-codex/new'), false)
    await models.toggle('oauth-codex/new', true, catalog(['old-on', 'old-off', 'new']))
    const reopened = new ModelSwitch({ path })
    await reopened.ready
    await reopened.rememberDiscovered(old, catalog(['old-on', 'old-off', 'new']))
    assert.equal(reopened.isEnabled('oauth-codex/new'), true)
    assert.equal(reopened.isEnabled('oauth-codex/old-off'), false)
    const direct = catalog(['old-on', 'old-off', 'new', 'picked-before-reconcile'])
    await reopened.toggle('oauth-codex/picked-before-reconcile', true, direct)
    await reopened.rememberDiscovered({}, direct)
    assert.equal(reopened.isEnabled('oauth-codex/picked-before-reconcile'), true)
    const concurrent = catalog(['old-on', 'old-off', 'new', 'picked-during-discovery'])
    await Promise.all([
      reopened.rememberDiscovered({}, concurrent),
      reopened.toggle('oauth-codex/picked-during-discovery', true, concurrent),
    ])
    const final = new ModelSwitch({ path })
    await final.ready
    assert.equal(final.isEnabled('oauth-codex/picked-during-discovery'), true)
    await final.toggle('oauth-codex/new', false, concurrent)
    await final.setEnabled(['oauth-codex/old-on'], old)
    await final.setAll(true, old)
    await final.rememberDiscovered({}, concurrent)
    assert.equal(final.isEnabled('oauth-codex/new'), false, 'a temporarily absent model keeps its off choice')
    assert.equal(final.isEnabled('oauth-codex/picked-during-discovery'), true)
  })
})

test('background discovery skips every unconfigured provider and coalesces refreshes', async () => {
  await temporary(async dir => {
    resetCodexCatalogCache()
    let calls = 0
    let metadataCalls = 0
    let proxyReady = false
    const authPath = join(dir, 'auth.json')
    const ctl = new AuthController({
      authPath, prefix: 'oauth', origin: () => {
        assert.ok(proxyReady, 'the origin is unavailable before the proxy starts')
        return 'http://localhost'
      },
      fetchFn: async (url: string) => {
        if (url.includes('registry.npmjs.org')) {
          metadataCalls++
          return response({ version: '0.163.0' })
        }
        assert.match(url, /codex\/models/)
        calls++
        return response({ models: [codexRow] })
      },
    })
    await ctl.loginsReady
    proxyReady = true
    await ctl.warmCatalogs()
    assert.equal(calls, 0)
    assert.equal(metadataCalls, 0)
    await saveSession('codex', { accessToken: 'fixture', refreshToken: 'fixture',
      accountId: 'account', expiresAt: Date.now() + 3600000 }, authPath)
    await Promise.all([ctl.warmCatalogs(), ctl.warmCatalogs()])
    assert.equal(calls, 1)
    assert.equal(metadataCalls, 1)
    assert.equal(ctl.models.isEnabled('oauth-codex/test-codex-next'), false)
    await ctl.warmCatalogs()
    assert.equal(calls, 1, 'the catalog TTL suppresses repeated reads')
    await deleteSession('codex', authPath)
    await ctl.warmCatalogs()
    assert.equal(calls, 1, 'a removed login is skipped')
    resetCodexCatalogCache()
  })
})

test('background updates preserve enabled host models and only sync a new model after selection', async () => {
  await temporary(async dir => {
    resetCodexCatalogCache()
    try {
      const authPath = join(dir, 'auth.json')
      await saveSession('codex', { accessToken: 'fixture', refreshToken: 'fixture',
        accountId: 'account', expiresAt: Date.now() + 3600000 }, authPath)
      const providers: Record<string, any> = {
        'oauth-codex': { models: [{ id: 'existing-live', name: 'Existing', contextWindow: 300000 }] },
      }
      const settings = {
        async describe() { return [{ ns: 'llm-pi-ai', value: { providers } }] },
        async mutate(_ns: string, mutations: any[]) {
          for (const row of mutations) {
            const id = row.path[1]
            if (row.op === 'unset') delete providers[id]
            else providers[id] = row.value
          }
        },
      }
      const ctl = new AuthController({ authPath, settings, prefix: 'oauth', origin: () => 'http://localhost',
        models: new ModelSwitch({ path: join(dir, 'models.json') }),
        fetchFn: async (url: string) => url.includes('registry.npmjs.org') ? response({ version: '0.163.0' })
          : response({ models: [codexRow, { ...codexRow, slug: 'existing-live' }] }),
      })
      await ctl.warmCatalogs()
      assert.ok(providers['oauth-codex'].models.some((row: any) => row.id === 'existing-live'))
      assert.ok(!providers['oauth-codex'].models.some((row: any) => row.id.startsWith('test-codex-next')))
      const catalog = await ctl.catalog()
      const key = 'oauth-codex/test-codex-next'
      await ctl.models.toggle(key, true, catalog)
      await ctl.models.setContext(key, 100000, catalog)
      await ctl.sync(undefined, { recover: false })
      assert.equal(providers['oauth-codex'].models.find((row: any) => row.id === 'test-codex-next').contextWindow, 100000)
      assert.ok(!providers['oauth-codex'].models.some((row: any) => row.id === 'test-codex-next-fast'))
    } finally { resetCodexCatalogCache() }
  })
})

test('the catalog watch schedules background refreshes and cleans up its timer', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  await temporary(async dir => {
    const ctl = new AuthController({ authPath: join(dir, 'auth.json'), prefix: 'oauth', origin: () => 'http://localhost' })
    await ctl.loginsReady
    let calls = 0
    ctl.warmCatalogs = async () => { calls++ }
    ctl.startCatalogWatch()
    ctl.startCatalogWatch()
    t.mock.timers.tick(5 * 60_000)
    assert.equal(calls, 1)
    ctl.stopCatalogWatch()
    t.mock.timers.tick(5 * 60_000)
    assert.equal(calls, 1)
    assert.equal(ctl.catalogWatchTimer, undefined)
  })
})

test('Codex follows the published client version without sending account credentials to npm', async () => {
  resetCodexCatalogCache()
  try {
    let modelCalls = 0
    const session = { accessToken: 'fixture', accountId: 'account' }
    await refreshCodexCatalog(session, { fetchFn: async (url: string, init: any) => {
      if (url.includes('registry.npmjs.org')) {
        assert.equal(init.headers, undefined)
        return response({ version: '99.0.0' })
      }
      modelCalls++
      assert.ok(url.endsWith('client_version=99.0.0'))
      assert.equal(init.headers['openai-version'], '99.0.0')
      return response({ models: [codexRow] })
    } })
    assert.equal(modelCalls, 1)
    await refreshCodexCatalog(session, { ttlMs: 0, fetchFn: async (url: string) => {
      if (url.includes('registry.npmjs.org')) throw new Error('metadata unavailable')
      assert.ok(url.endsWith('client_version=99.0.0'))
      return response({ models: [codexRow] })
    } })
  } finally { resetCodexCatalogCache() }
})
