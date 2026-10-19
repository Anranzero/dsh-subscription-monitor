import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const client = readFileSync(new URL('../lib/ui/client.js', import.meta.url), 'utf8')
const rule = client.split('\n').find((line) => line.includes('.osubs-schart-x > span')) ?? ''

test('stats trend x-axis labels are never clipped by their flex slot', () => {
  // Each label is centred in a 1/n flex slot. In a 30-day window that slot is
  // narrower than "10月15日", and `overflow: hidden` truncated the date to
  // "10月1" — the axis then disagreed with the hover card above it. Labels are
  // only drawn every `step`-th slot, so overflowing the slot cannot collide.
  assert.match(rule, /overflow:\s*visible/)
  assert.doesNotMatch(rule, /overflow:\s*hidden/)
})
