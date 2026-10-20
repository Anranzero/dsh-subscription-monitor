import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogProviders, FAMILY_IDS, harnessModelAlias } from '../lib/oauth/models.js'
import { ensureOpencodeGoRoute, ensureOpencodeZenRoute, syncHarnessModels } from '../lib/oauth/harness-sync.js'
import { opencodeGoRoutes, opencodeZenRoutes } from '../lib/apikey/opencode-go/models.js'
import { directApiKeyProviders } from '../lib/apikey/direct-routes.js'

const origin = 'http://localhost:12345'
const agentNames = {
  codex: 'Codex', chatgpt: 'ChatGPT', grok: 'Grok', glm: 'GLM', kiro: 'Kiro',
  antigravity: 'Antigravity', cursor: 'Cursor', ollama: 'Ollama', minimax: 'MiniMax',
  kimi: 'Kimi', devin: 'Devin', cline: 'Cline', 'command-code': 'Command Code',
  workbuddy: 'WorkBuddy', 'workbuddy-ai': 'WorkBuddy AI', 'kimi-work': 'Kimi Work',
  autoclaw: 'AutoClaw', 'autoclaw-cn': 'AutoClaw CN', opendesign: 'Open Design',
  mimo: 'Xiaomi MiMo', zed: 'Zed',
}
function settingsFixture() {
  const providers: Record<string, any> = {}
  return {
    providers,
    async describe() { return [{ ns: 'llm-pi-ai', value: { providers } }] },
    async mutate(namespace: string, mutations: any[]) {
      assert.equal(namespace, 'llm-pi-ai')
      for (const mutation of mutations) {
        const [root, id] = mutation.path
        assert.equal(root, 'providers')
        if (mutation.op === 'unset') delete providers[id]
        else providers[id] = mutation.value
      }
    },
  }
}
async function synchronize(settings: ReturnType<typeof settingsFixture>) {
  await syncHarnessModels({
    settings, prefix: 'oauth', origin,
    loggedIn: Object.fromEntries(FAMILY_IDS.map(family => [family, true])),
  })
  await ensureOpencodeGoRoute(settings)
  await ensureOpencodeZenRoute(settings)
}
function agentOf(provider: string) {
  if (provider.startsWith('opencode-go-')) return 'OpenCode Go'
  if (provider.startsWith('opencode-zen-')) return 'OpenCode Zen'
  if (provider.startsWith('oauth-zed-')) return 'Zed'
  if (provider === 'oauth-command-code-messages') return 'Command Code'
  const family = provider.slice('oauth-'.length) as keyof typeof agentNames
  assert.ok(agentNames[family], `Uncovered family: ${family}`)
  return agentNames[family]
}

test('uses canonical labels for every family, including MiniMax and both OpenCode products', () => {
  for (const [family, agent] of Object.entries(agentNames)) {
    assert.equal(harnessModelAlias(`oauth-${family}`, 'new-model-id', 'Official Model V2'), `${agent}/Official Model V2`)
  }
  for (const [provider, id, name, expected] of [
    ['oauth-codex', 'gpt-6.1-sol', 'GPT-6.1 Sol', 'Codex/GPT-6.1 Sol'],
    ['oauth-codex', 'gpt-6.1-sol-fast', 'GPT-6.1 Sol Fast', 'Codex/GPT-6.1 Sol Fast'],
    ['oauth-antigravity', 'claude-opus-5-5-high', 'Claude Opus 5.5', 'Antigravity/Claude Opus 5.5'],
    ['oauth-command-code', 'deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'Command Code/DeepSeek V4.1 Flash'],
    ['opencode-go-responses', 'gpt-5.6-luna', 'GPT-5.6 Luna', 'OpenCode Go/GPT-5.6 Luna'],
    ['opencode-zen-responses', 'gpt-5.5', 'GPT-5.5', 'OpenCode Zen/GPT-5.5'],
  ]) assert.equal(harnessModelAlias(provider, id, name), expected)
})

test('keeps two-argument compatibility and uses safe fallback without guessing brand casing', () => {
  assert.equal(harnessModelAlias('oauth-codex', 'future-gpt'), 'Codex/future-gpt')
  assert.equal(harnessModelAlias('oauth-codex', 'future-gpt', '  '), 'Codex/future-gpt')
  assert.equal(harnessModelAlias('oauth-codex', 'future-gpt', '  FutureLab R2  '), 'Codex/FutureLab R2')
  assert.equal(harnessModelAlias('custom-provider', 'vendor/wire-id', 'Vendor Model'), 'custom-provider/Vendor Model')
})

test('synchronization preserves canonical model names across native and proxy routes', async () => {
  const catalog = directApiKeyProviders(catalogProviders({ prefix: 'oauth', origin }))
  // OpenCode's existing writer preserves raw route rows (caps and compat);
  // the settings picker projection intentionally has a different row shape.
  for (const route of [...opencodeGoRoutes(), ...opencodeZenRoutes()]) {
    catalog[route.id] = { ...catalog[route.id], models: route.models }
  }
  const settings = settingsFixture()
  await synchronize(settings)
  assert.deepEqual(Object.keys(settings.providers).sort(), Object.keys(catalog).sort())
  let models = 0
  for (const [provider, expected] of Object.entries(catalog)) {
    const actual = settings.providers[provider]
    const agent = agentOf(provider)
    assert.equal(actual.models.length, expected.models.length, provider)
    for (let index = 0; index < expected.models.length; index++) {
      assert.deepEqual(actual.models[index], {
        ...expected.models[index], name: `${agent}/${expected.models[index].name.trim()}`,
      }, `${provider}/${expected.models[index].id}`)
      models++
    }
    assert.deepEqual({ ...actual, models: undefined }, { ...expected, models: undefined }, `${provider} route parameters`)
  }
  assert.ok(models > 0)
  console.log(`Checked ${Object.keys(catalog).length} routes and ${models} model rows`)
})

test('repeated synchronization preserves normalized names without repeated prefixes', async () => {
  const settings = settingsFixture()
  await synchronize(settings)
  const first = structuredClone(settings.providers)
  await synchronize(settings)
  assert.deepEqual(settings.providers, first)
})
