import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crc32 } from 'node:zlib'
import { forwardKiro } from '../lib/oauth/kiro/transport.js'
import { kiroCatalogModels } from '../lib/oauth/kiro/catalog.js'

function frame(type: string, payload: any) {
  const key = Buffer.from(':event-type')
  const value = Buffer.from(type)
  const header = Buffer.alloc(1 + key.length + 1 + 2 + value.length)
  header[0] = key.length
  key.copy(header, 1)
  header[1 + key.length] = 7
  header.writeUInt16BE(value.length, 2 + key.length)
  value.copy(header, 4 + key.length)
  const data = Buffer.from(JSON.stringify(payload))
  const bytes = Buffer.alloc(16 + header.length + data.length)
  bytes.writeUInt32BE(bytes.length, 0)
  bytes.writeUInt32BE(header.length, 4)
  bytes.writeUInt32BE(crc32(bytes.subarray(0, 8)), 8)
  header.copy(bytes, 12)
  data.copy(bytes, 12 + header.length)
  bytes.writeUInt32BE(crc32(bytes.subarray(0, -4)), bytes.length - 4)
  return bytes
}
function output() {
  return {
    headersSent: false, writableEnded: false, destroyed: false, body: '',
    writeHead() { this.headersSent = true },
    write(value: string) { this.body += value; return true },
    end(value = '') { this.body += value; this.writableEnded = true },
  }
}
function run(response: any, stream: boolean, fetchFn: any, retry = false) {
  return forwardKiro(response, {
    payload: { model: kiroCatalogModels()[0].id, messages: [{ role: 'user', content: 'fixture' }] },
    stream, session: { accessToken: 'fixture-only' }, fetchFn,
    signal: AbortSignal.timeout(4000),
    timeouts: { firstByteMs: 500, budgetMs: retry ? 3500 : 500, idleMs: 1000 },
  })
}
for (const stream of [true, false]) {
  test(`Kiro rejects empty and metadata-only responses (stream=${stream})`, async () => {
    for (const body of [Buffer.alloc(0), frame('metadataEvent', { tokenUsage: { inputTokens: 10, outputTokens: 0 } })]) {
      const response = output()
      await assert.rejects(run(response, stream, async () => new Response(body)), /without.*output/i)
      assert.equal(response.headersSent, false)
      assert.equal(response.body, '')
    }
  })
  test(`Kiro retries an empty response and returns only the recovered answer (stream=${stream})`, async () => {
    const response = output()
    let attempts = 0
    await run(response, stream, async () => new Response(++attempts === 1 ? Buffer.alloc(0) : frame('assistantResponseEvent', { content: 'OK' })), true)
    assert.equal(attempts, 2)
    assert.equal(response.body.match(/"content":"OK"/g)?.length, 1)
    assert.equal(response.writableEnded, true)
  })
  test(`Kiro retains valid text, thinking, tools and explicit output cap (stream=${stream})`, async () => {
    for (const [body, reason] of [
      [frame('assistantResponseEvent', { content: 'OK' }), 'stop'],
      [frame('reasoningEvent', { text: 'Checking.' }), 'stop'],
      [frame('toolUseEvent', { toolUseId: 'tool-id', name: 'read', input: {} }), 'tool_calls'],
      [frame('ContentLengthExceededException', {}), 'length'],
    ] as const) {
      const response = output()
      await run(response, stream, async () => new Response(body))
      assert.ok(response.body.includes(`"finish_reason":"${reason}"`))
    }
  })
}
