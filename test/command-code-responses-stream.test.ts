import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeCommandCodeResponsesStream } from '../lib/apikey/command-code/responses-stream.js'
import { installCommandCodeConnectionRecovery } from '../lib/apikey/command-code/connection-recovery.js'

const encoder = new TextEncoder()
const event = (type: string, fields: any = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`
const alias = event('response.reasoning.delta', { output_index: 0, item_id: 'rs_fixture', content_index: 0, delta: '正在检查🙂' })
const expected = event('response.reasoning_text.delta', { output_index: 0, item_id: 'rs_fixture', content_index: 0, delta: '正在检查🙂' })

test('reasoning delta becomes visible before upstream finishes the reasoning item', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream({ start(controller) { source = controller } }), {
    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'fixture-id' },
  })
  const normalized = normalizeCommandCodeResponsesStream(response)
  const reader = normalized.body!.getReader()
  source.enqueue(encoder.encode(alias))
  const first = await reader.read()
  assert.equal(new TextDecoder().decode(first.value), expected)
  assert.equal(normalized.headers.get('x-request-id'), 'fixture-id')
  // Still open: exposing a delta must not wait for output_item.done/completed.
  const terminal = event('response.completed', { response: { status: 'completed', output: [], usage: { output_tokens: 2 } } })
  source.enqueue(encoder.encode(terminal))
  source.close()
  assert.equal(new TextDecoder().decode((await reader.read()).value), terminal)
  assert.equal((await reader.read()).done, true)
})

test('arbitrary byte boundaries, Unicode and CRLF keep intact reasoning and untouched events', async () => {
  const tool = event('response.function_call_arguments.delta', { output_index: 1, delta: '{"type":"response.reasoning.delta"}' })
  const data = encoder.encode(alias.replaceAll('\n', '\r\n') + tool)
  const input = new ReadableStream<Uint8Array>({
    start(controller) { for (const byte of data) controller.enqueue(Uint8Array.of(byte)); controller.close() },
  })
  const result = await normalizeCommandCodeResponsesStream(new Response(input, { headers: { 'content-type': 'text/event-stream' } })).text()
  assert.equal(result.replaceAll('\r\n', '\n'), expected + tool)
})

test('standard frames, malformed frames and truncated tails pass through without invented completion', async () => {
  const wire = ': keepalive\n\n' + expected + 'event: response.reasoning.delta\ndata: not json\n\n' + 'data: {"type":"response.completed"'
  const normalized = normalizeCommandCodeResponsesStream(new Response(wire, { headers: { 'content-type': 'text/event-stream' } }))
  assert.equal(await normalized.text(), wire)
  const json = new Response('{"type":"response.reasoning.delta"}', { headers: { 'content-type': 'application/json' } })
  assert.equal(normalizeCommandCodeResponsesStream(json), json)
  const error = new Response(alias, { status: 500, headers: { 'content-type': 'text/event-stream' } })
  assert.equal(normalizeCommandCodeResponsesStream(error), error)
})

test('consumer cancellation propagates to upstream', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-type': 'text/event-stream' } })
  await normalizeCommandCodeResponsesStream(response).body!.cancel()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelled, true)
})

test('a failure after visible reasoning stays a stream failure, never a fabricated completion', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream({ start(controller) { source = controller } }), { headers: { 'content-type': 'text/event-stream' } })
  const reader = normalizeCommandCodeResponsesStream(response).body!.getReader()
  source.enqueue(encoder.encode(alias))
  assert.equal(new TextDecoder().decode((await reader.read()).value), expected)
  source.error(new Error('upstream disconnected'))
  await assert.rejects(reader.read(), /upstream disconnected/)
})

test('native fetch integration normalizes only the Command Code Responses endpoint', async () => {
  const native = globalThis.fetch
  globalThis.fetch = async () => new Response(alias, { headers: { 'content-type': 'text/event-stream' } })
  const dispose = installCommandCodeConnectionRecovery()
  try {
    const options = { method: 'POST', body: '{"stream":true}' }
    assert.equal(await (await fetch('https://api.commandcode.ai/provider/v1/responses', options)).text(), expected)
    assert.equal(await (await fetch('https://api.commandcode.ai/provider/v1/chat/completions', options)).text(), alias)
    assert.equal(await (await fetch('https://other.example/v1/responses', options)).text(), alias)
  } finally { dispose(); globalThis.fetch = native }
})
