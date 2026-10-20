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
