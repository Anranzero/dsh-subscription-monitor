import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeOpencodeGoModels, opencodeGoRouteModels, refreshOpencodeGoCatalog, resetOpencodeGoCatalogCache } from '../lib/apikey/opencode-go/catalog.js'
import { opencodeGoRoutes } from '../lib/apikey/opencode-go/models.js'

test('appends live-only ids with the vendor name/window and the models.dev protocol', () => {
  const entries = mergeOpencodeGoModels(
    [
      { id: 'new-chat', name: 'New Chat', context_length: 131072 },
      { id: 'new-resp', name: 'New Resp', context_length: 200000 },
      { id: 'new-msg', name: 'New Msg', context_length: 200000 },
      { id: 'no-window', name: 'No Window' },
    ],
    {
      'new-chat': { provider: { npm: '@ai-sdk/openai-compatible' }, limit: { context: 131072 } },
      'new-resp': { provider: { npm: '@ai-sdk/openai' }, limit: { context: 200000 } },
      'new-msg': { provider: { npm: '@ai-sdk/anthropic' }, limit: { context: 200000 } },
    },
  )
  const routeOf = new Map(entries.map(entry => [entry.row.id, entry.route]))
  assert.equal(routeOf.get('new-chat'), 'opencode-go-flash')
  assert.equal(routeOf.get('new-resp'), 'opencode-go-responses')
  assert.equal(routeOf.get('new-msg'), 'opencode-go-messages')
  assert.equal(routeOf.has('no-window'), false, 'an id with no window from either source stays out')
  const live = entries.find(entry => entry.row.id === 'new-chat')
  assert.deepEqual(live.row, { id: 'new-chat', name: 'New Chat', contextWindow: 131072 })
})

test('ids on protocols DSH cannot serve (models.dev @ai-sdk/google) stay out', () => {
  const entries = mergeOpencodeGoModels(
    [{ id: 'gemini-4-argon-contributor', name: 'Gemini 4 Argon Contributor', context_length: 1048576 }],
    { 'gemini-4-argon-contributor': { provider: { npm: '@ai-sdk/google' }, limit: { context: 1048576 } } },
  )
  assert.equal(entries.some(entry => entry.row.id === 'gemini-4-argon-contributor'), false)
  assert.equal(opencodeGoRouteModels('opencode-go-flash').some(row => row.id === 'gemini-4-argon-contributor'), false)
})

test('curated rows keep their dialects and ids; duplicates are ignored', () => {
  const entries = mergeOpencodeGoModels([{ id: 'step-5-preview', name: 'Renamed Upstream', context_length: 1 }])
  const row = entries.find(entry => entry.row.id === 'step-5-preview').row
  assert.equal(row.name, 'Step 5 Preview')
  assert.equal(entries.filter(entry => entry.row.id === 'step-5-preview').length, 1)
})

test('a refresh publishes the merged rows and a failure keeps the curated floor', async () => {
  resetOpencodeGoCatalogCache()
  const floor = opencodeGoRouteModels('opencode-go-flash').map(row => row.id)
  await refreshOpencodeGoCatalog({ accessToken: 'key' }, { fetchFn: async () => ({ ok: false }) })
  assert.deepEqual(opencodeGoRouteModels('opencode-go-flash').map(row => row.id), floor)

  const fetchFn = async (url: string) => url.includes('models.dev')
    ? { ok: true, json: async () => ({ 'opencode-go': { models: { 'live-new': { provider: { npm: '@ai-sdk/openai' }, limit: { context: 999999 } } } } }) }
    : { ok: true, json: async () => ({ data: [{ id: 'live-new', name: 'Live New', context_length: 999999 }] }) }
  await refreshOpencodeGoCatalog({ accessToken: 'key' }, { fetchFn, ttlMs: 0 })
  const added = opencodeGoRouteModels('opencode-go-responses').find(row => row.id === 'live-new')
  assert.equal(added?.name, 'Live New')
  assert.equal(added?.contextWindow, 999999)
  assert.ok(opencodeGoRoutes().find(route => route.id === 'opencode-go-responses').models.some(model => model.id === 'live-new'))

  resetOpencodeGoCatalogCache()
  assert.equal(opencodeGoRouteModels('opencode-go-responses').some(row => row.id === 'live-new'), false)
})

test('no credential leaves the curated floor in place', async () => {
  resetOpencodeGoCatalogCache()
  const before = opencodeGoRouteModels('opencode-go-messages').map(row => row.id)
  let called = false
  await refreshOpencodeGoCatalog({}, { fetchFn: async () => { called = true; return { ok: true, json: async () => ({ data: [] }) } } })
  assert.equal(called, false)
  assert.deepEqual(opencodeGoRouteModels('opencode-go-messages').map(row => row.id), before)
})
