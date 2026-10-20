import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parseGrokBilling } from '../lib/oauth/grok/quota.js'

const billing = {
  config: {
    isUnifiedBillingUser: true,
    creditUsagePercent: 25,
    productUsage: ['Api', 'Cursor', 'GrokAppBuilder', 'GrokImagine', 'GrokChat', 'GrokBot']
      .map(product => ({ product, usagePercent: 10 })),
  },
}

test('confirmed merged subscription marks one shared allowance and retains every product breakdown', () => {
  const parsed = parseGrokBilling(billing, { cliUser: { cursorMerged: true } })
  assert.deepEqual(parsed.rows[0].sharedWith, ['grok', 'cursor'])
  assert.equal(parsed.rows.filter(row => row.sharedWith).length, 1)
  assert.deepEqual(parsed.rows.slice(1).map(row => row.product), billing.config.productUsage.map(row => row.product))
})

test('plan names, missing flags and a nonmerged account never establish a shared pool', () => {
  for (const cliUser of [{ subscriptionTier: 'SuperGrok' }, { cursorMerged: false }, undefined]) {
    assert.equal(parseGrokBilling(billing, { cliUser }).rows[0].sharedWith, undefined)
  }
  assert.equal(parseGrokBilling({ config: { creditUsagePercent: 20 } }, {
    cliUser: { cursorMerged: true },
  }).rows[0].sharedWith, undefined)
})

test('on-demand money is not labelled as the shared included allowance', () => {
  const parsed = parseGrokBilling({ config: {
    isUnifiedBillingUser: true, onDemandUsed: 5, onDemandCap: 20,
  } }, { cliUser: { cursorMerged: true } })
  assert.equal(parsed.rows[0].sharedWith, undefined)
})

function renderRows(rows: any[], family = 'grok') {
  const source = readFileSync(new URL('../lib/ui/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('        function renderQuotaRows(')
  const end = source.indexOf('        function QuotaBlock(', start)
  const render = runInNewContext(`${source.slice(start, end)}; renderQuotaRows`, {
    h: (type: string, props: any, ...children: any[]) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    QuotaRow: 'quota-meter', antigravityGroupLabel: (label: string) => label,
    fill: (text: string, n: number) => text.replace('{n}', String(n)),
  })
  return render(rows, { grokPoolUsage: '共享池消耗明细', grokPoolUsageHint: '不是独立额度', usedPercent: '已消耗 {n}%' }, family)
}
function descendants(nodes: any[]): any[] {
  return Array.from(nodes).flatMap(node => node && typeof node === 'object' ? [node, ...descendants(node.children ?? [])] : [])
}
function textOf(node: any): string {
  return typeof node === 'object' && node ? (node.children ?? []).map(textOf).join('') : String(node ?? '')
}

test('Grok renders one pool meter and product consumption without separate remaining meters', () => {
  const parsed = parseGrokBilling({ config: { isUnifiedBillingUser: true, creditUsagePercent: 91,
    productUsage: ['Api', 'Cursor', 'GrokAppBuilder', 'GrokImagine', 'GrokChat', 'GrokBot']
      .map((product, i) => ({ product, usagePercent: [43, 30, 10, 4, 3, 1][i] })),
  } }, { cliUser: { cursorMerged: true } })
  const tree = renderRows(parsed.rows)
  const all = descendants(tree)
  const meters = all.filter(node => node.type === 'quota-meter')
  assert.equal(meters.length, 1)
  assert.equal(meters[0].props.row.remainingPercent, 9)
  const details = all.find(node => node.type === 'details')
  assert.ok(details)
  assert.equal(details.children[0].type, 'summary')
  assert.match(textOf(details), /Api已消耗 43%/)
  assert.match(textOf(details), /Cursor已消耗 30%/)
  assert.doesNotMatch(textOf(details), /剩余|57%|70%/)
})

test('on-demand and prepaid stay separate, and other families retain product meters', () => {
  const rows = [
    { key: 'weekly', kind: 'weekly', remainingPercent: 9 },
    { key: 'product:Api', kind: 'product', product: 'Api', usedPercent: 43 },
    { key: 'product:on-demand', kind: 'product', product: 'on-demand', remainingPercent: 80 },
    { key: 'prepaid', kind: 'prepaid', remaining: 5 },
  ]
  const grok = descendants(renderRows(rows))
  assert.deepEqual(grok.filter(node => node.type === 'quota-meter').map(node => node.props.row.key),
    ['weekly', 'product:on-demand', 'prepaid'])
  const other = descendants(renderRows(rows, 'cursor'))
  assert.equal(other.filter(node => node.type === 'quota-meter').length, 4)
  assert.equal(other.filter(node => node.type === 'details').length, 0)
})

test('unknown product consumption is not presented as zero or full remaining allowance', () => {
  const rendered = descendants(renderRows([{ key: 'product:Api', kind: 'product', product: 'Api' }]))
  assert.equal(rendered.filter(node => node.type === 'quota-meter').length, 0)
  assert.match(textOf(rendered.find(node => node.type === 'details')), /Api—/)
})

test('model catalog keeps configured all-off and expired accounts, excludes history-only and missing accounts', () => {
  const source = readFileSync(new URL('../lib/ui/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('        function configuredModelCatalog(')
  const end = source.indexOf('        const COPY =', start)
  assert.ok(start > 0 && end > start)
  const select = runInNewContext(`${source.slice(start, end)}; configuredModelCatalog`)
  const snapshot = {
    catalog: [
      { family: 'cursor', loggedIn: true, models: [{ enabled: false }] },
      { family: 'grok', loggedIn: false, models: [{ enabled: false }] },
      { family: 'codex', loggedIn: false },
      { family: 'minimax', loggedIn: false },
    ],
    accounts: { grok: { accounts: [{ id: 'expired-account' }] } },
    usage: [{ family: 'codex' }],
  }
  assert.deepEqual(Array.from(select(snapshot), (group: any) => group.family), ['cursor', 'grok'])
  assert.equal(select(undefined).length, 0)
})
