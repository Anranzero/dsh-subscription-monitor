import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { readUsage, scanUsage } from '../lib/utils/usage.js'

const now = Date.parse('2026-10-20T12:00:00Z')
const message = (id: string | undefined, time: number, step = 1) => ({
  type: 'assistant/message', seq: step, time,
  data: { turn: 1, step, message: { id, source: { provider: 'fixture', model: 'model' } },
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 85, totalTokens: 100 } },
})
const session = (id: string, createdAt: number, messages: any[]) => [
  { type: 'session', id, version: 4, createdAt }, ...messages,
].map(event => JSON.stringify(event)).join('\n') + '\n'

async function temporary(run: (root: string) => Promise<void>) {
  const base = resolve(tmpdir(), 'dsh-usage-statistics-')
  const root = await mkdtemp(base)
  try { await run(root) } finally {
    assert.ok(resolve(root).startsWith(base))
    await rm(root, { recursive: true, force: true })
  }
}
const tokens = (rows: any[]) => rows.reduce((n, row) => n + row[4] + row[5] + row[6] + row[7], 0)
const calls = (rows: any[]) => rows.reduce((n, row) => n + row[3], 0)

test('forked messages count once across sessions, including cached scans', async () => {
  await temporary(async root => {
    const inherited = message('shared-message', now - 3600000)
    // Alphabetical order puts the child first; ownership must not depend on it.
    await writeFile(join(root, 'session-child.jsonl'), session('child', now - 1000, [inherited, message('child-message', now, 2)]))
    await writeFile(join(root, 'session-parent.jsonl'), session('parent', now - 7200000, [inherited]))
    const result = scanUsage(root, -Infinity)
    assert.equal(tokens(result.rows), 200)
    assert.equal(calls(result.rows), 2)
    assert.equal(tokens(result.sessions.find(row => row.id === 'parent')!.rows), 100)
    assert.equal(tokens(result.sessions.find(row => row.id === 'child')!.rows), 100)
    const before = JSON.stringify(result.files)
    const again = scanUsage(root, -Infinity, result.files)
    assert.equal(tokens(again.rows), 200)
    assert.equal(JSON.stringify(result.files), before, 'deduplication must not mutate cached per-file totals')
  })
})

test('independent calls with equal timestamps and usage are not merged', async () => {
  await temporary(async root => {
    await writeFile(join(root, 'session-a.jsonl'), session('a', now - 1000, [message('a-message', now)]))
    await writeFile(join(root, 'session-b.jsonl'), session('b', now - 1000, [message('b-message', now)]))
    await writeFile(join(root, 'session-legacy.jsonl'), session('legacy', now - 1000, [message(undefined, now)]))
    const result = scanUsage(root, -Infinity)
    assert.equal(tokens(result.rows), 300)
    assert.equal(calls(result.rows), 3)
  })
})

test('concurrent 30-day and all-history reads retain their own windows', async () => {
  await temporary(async root => {
    await writeFile(join(root, 'session-history.jsonl'), session('history', now - 60 * 86400000, [
      message('old-message', now - 45 * 86400000), message('recent-message', now, 2),
    ]))
    const options = { root, cachePath: join(root, 'usage-cache.json'), now }
    const [recent, all] = await Promise.all([readUsage(options), readUsage({ ...options, days: Infinity })])
    assert.equal(tokens(recent.rows), 100)
    assert.equal(tokens(all.rows), 200)
    assert.equal(tokens(all.sessions[0].rows), 200)
  })
})

test('simultaneous reads of different roots cannot share another profile\'s data', async () => {
  await temporary(async first => temporary(async second => {
    await writeFile(join(first, 'session-a.jsonl'), session('a', now - 1000, [message('a-message', now)]))
    const [a, b] = await Promise.all([
      readUsage({ root: first, cachePath: join(first, 'usage-cache.json'), now }),
      readUsage({ root: second, cachePath: join(second, 'usage-cache.json'), now }),
    ])
    assert.equal(tokens(a.rows), 100)
    assert.equal(tokens(b.rows), 0)
  }))
})

// The real controller must request history, rather than present a 30-day scan as 全部.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('statistics controller requests all history while the usage tab keeps 30 days', async () => {
  const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const start = source.indexOf('    let usageMemo;')
  const end = source.indexOf('    const snapshot = controller.snapshot.bind(controller);', start)
  const windows: number[] = []
  const controller: any = {}
  runInNewContext(source.slice(start, end), {
    controller, USAGE_MEMO_MS: 60000, HOST_DEEPSEEK: new Set(), prefix: 'oauth',
    familyOfProvider: (provider: string) => provider, join, dshHome: () => '/fixture', dataDir: '/fixture',
    readUsage: async ({ days = 30 }) => { windows.push(days); return { rows: [], sessions: [] } },
    usageRowCosts: () => [],
  })
  await controller.usage({ includeAll: true })
  await controller.usage({ includeAll: false })
  assert.deepEqual(windows, [Infinity, 30])
})

const client = readFileSync(new URL('../lib/ui/client.js', import.meta.url), 'utf8')
function renderStats(range: string, rows: any[]) {
  const state = [range, 'day', -1, null]
  class Clock extends Date {
    constructor(value: any = now) { super(value) }
    static now() { return now }
  }
  const helpers = client.slice(client.indexOf('        const dayKey ='), client.indexOf('        // ── Long screenshot'))
  const panel = client.slice(client.indexOf('        const STATS_RANGE_STORE'), client.indexOf('        function UsagePanel'))
  return runInNewContext(helpers + '\n' + panel + '\nStatsPanel({ t, data, scope: "all" })', {
    Date: Clock, HOUR_MS: 3600000, Fragment: 'fragment', Button: 'button', IconRefresh: 'refresh',
    useState: () => [state.shift(), () => {}], useRef: () => ({ current: null }),
    h: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(value => value != null) }),
    t: new Proxy({ statsDays: '{n} d' }, { get: (obj: any, key: string) => obj[key] ?? key }),
    fill: (text: string, value: any) => text.replace('{n}', String(value)), localeOf: () => 'zh',
    data: { at: now, rows, sessions: [] },
  })
}
function nodes(tree: any): any[] {
  return typeof tree === 'object' && tree ? [tree, ...(tree.children ?? []).flatMap(nodes)] : []
}

test('all range selections retain historical heatmap activity', () => {
  const hour = Math.floor(now / 3600000)
  const rows = [[hour - 10 * 24, 'fixture', 'model', 1, 10, 5, 85, 0], [hour, 'fixture', 'model', 1, 20, 10, 170, 0]]
  for (const range of ['1', '7', '30', 'all']) {
    const tree = renderStats(range, rows)
    const cells = nodes(tree).filter(node => node.type === 'i' && node.props['aria-label'] && node.props['data-lvl'])
    assert.equal(cells.length, 2, `heatmap lost historical activity with range ${range}`)
    const strip = nodes(tree).find(node => node.props.className === 'osubs-sstrip')
    const value = nodes(strip).find(node => node.props.className === 'osubs-sitem-v')
    assert.equal(value.children[0], ['1', '7'].includes(range) ? '200' : '300')
  }
})

test('today activity does not truncate the current streak at the trend window', () => {
  const hour = Math.floor(now / 3600000)
  const tree = renderStats('1', [0, 1, 2].map(days => [hour - days * 24, 'fixture', 'model', 1, 10, 5, 85, 0]))
  const strip = nodes(tree).find(node => node.props.className === 'osubs-sstrip')
  const values = nodes(strip).filter(node => node.props.className === 'osubs-sitem-v').map(node => node.children[0])
  assert.equal(values[4], '3 d')
  assert.equal(values[5], '3 d')
})

test('an idle today keeps historical activity visible rather than replacing it with an empty state', () => {
  const hour = Math.floor(now / 3600000)
  const tree = renderStats('1', [[hour - 24, 'fixture', 'model', 1, 10, 5, 85, 0]])
  const cells = nodes(tree).filter(node => node.type === 'i' && node.props['aria-label'] && node.props['data-lvl'])
  assert.equal(cells.length, 1)
  const strip = nodes(tree).find(node => node.props.className === 'osubs-sstrip')
  const values = nodes(strip).filter(node => node.props.className === 'osubs-sitem-v').map(node => node.children[0])
  assert.equal(values[0], '0')
  assert.equal(values[4], '1 d')
})

// Fix the timezone in this test process only; production follows the user's locale.
process.env.TZ = 'Asia/Shanghai'
