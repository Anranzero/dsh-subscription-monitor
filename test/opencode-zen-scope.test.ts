import assert from 'node:assert/strict'
import { test } from 'node:test'
import { opencodeZenInUse } from '../lib/apikey/opencode-go/accounts.js'
import { ensureOpencodeZenRoute } from '../lib/oauth/harness-sync.js'
import { opencodeZenRoutes } from '../lib/apikey/opencode-go/models.js'

function settingsFixture(initial: Record<string, any> = {}) {
  const providers: Record<string, any> = structuredClone(initial)
  return {
    providers,
    async describe() { return [{ ns: 'llm-pi-ai', value: { providers } }] },
    async mutate(namespace: string, mutations: any[]) {
      assert.equal(namespace, 'llm-pi-ai')
      for (const mutation of mutations) {
        const [, id] = mutation.path
        if (mutation.op === 'unset') delete providers[id]
        else providers[id] = mutation.value
      }
    },
  }
}

test('a Zen wallet row marks the product as in use; Go rows and empty quota do not', () => {
  const account = (rows: any[]) => ({ accounts: [{ id: 'go_1', quota: { status: 'ready', rows } }] })
  assert.equal(opencodeZenInUse(account([{ kind: 'zen-balance', remaining: 4 }])), true)
  assert.equal(opencodeZenInUse(account([{ kind: 'zen-credit', remaining: 4 }])), true)
  assert.equal(opencodeZenInUse(account([{ kind: 'go-week', remaining: 4 }])), false)
  assert.equal(opencodeZenInUse(account([])), false)
  assert.equal(opencodeZenInUse({ accounts: [] }), false)
  assert.equal(opencodeZenInUse(undefined), false)
})

test('without a Zen wallet read the sync writes no Zen route at all', async () => {
  const settings = settingsFixture()
  await ensureOpencodeZenRoute(settings, { selected: [] })
  assert.deepEqual(Object.keys(settings.providers), [])
})

test('existing owned Zen routes are removed when Zen is not in use', async () => {
  const settings = settingsFixture()
  await ensureOpencodeZenRoute(settings)
  assert.deepEqual(Object.keys(settings.providers).sort(), opencodeZenRoutes().map(route => route.id).sort())
  await ensureOpencodeZenRoute(settings, { selected: [] })
  assert.deepEqual(Object.keys(settings.providers), [])
})

test('a user-owned profile on the same route id is left alone', async () => {
  const userRoute = { apiKeyEnv: 'SOMEONE_ELSES_KEY', api: 'openai-completions', baseURL: 'https://example.test', models: [{ id: 'x', name: 'x' }] }
  const settings = settingsFixture({ 'opencode-zen-chat': userRoute })
  await ensureOpencodeZenRoute(settings, { selected: [] })
  assert.deepEqual(settings.providers['opencode-zen-chat'], userRoute)
})

test('an enabled Zen pick still writes exactly the picked rows', async () => {
  const settings = settingsFixture()
  const route = opencodeZenRoutes()[0]
  const picked = `${route.id}/${route.models[0].id}`
  await ensureOpencodeZenRoute(settings, { selected: [picked] })
  assert.deepEqual(settings.providers[route.id].models.map((model: any) => model.id), [route.models[0].id])
  assert.equal(settings.providers[route.id].models[0].name, `${'OpenCode Zen'}/${route.models[0].name.trim()}`)
})
