import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAntigravityOpenaiStream, antigravityToOpenai, collectAntigravityParts } from '../lib/oauth/antigravity/request.js'
import { forwardAntigravity } from '../lib/oauth/antigravity/transport.js'

const event = (parts: any[], finishReason?: string) => ({ response: { candidates: [{ content: { parts }, finishReason }] } })
test('Antigravity exposes thought deltas before answer text without duplicating cumulative thoughts', () => {
  const mapper = createAntigravityOpenaiStream({ model: 'fixture' })
  assert.deepEqual(mapper.push(event([{ thought: true, text: 'Check' }]))?.choices[0].delta, { reasoning_content: 'Check' })
  assert.deepEqual(mapper.push(event([{ thought: true, text: 'Check numbers' }]))?.choices[0].delta, { reasoning_content: ' numbers' })
  assert.equal(mapper.push(event([{ thought: true, text: 'Check numbers' }])), undefined)
  assert.deepEqual(mapper.push(event([{ thought: true, text: 'Check numbers' }, { text: '391' }], 'STOP'))?.choices[0].delta, { content: '391' })
  assert.equal(mapper.finish().choices[0].finish_reason, 'stop')
})
test('Antigravity buffered replies preserve thoughts separately from answer and tool signatures', () => {
  const input = event([{ thought: true, text: 'Checking.', thoughtSignature: 'fixture-signature' }, { functionCall: { name: 'read', args: {} } }, { text: 'OK' }], 'STOP')
  const collected = collectAntigravityParts(input)
  assert.equal(collected.thinking, 'Checking.')
  assert.equal(collected.toolCalls[0].thoughtSignature, 'fixture-signature')
  const message = antigravityToOpenai(input, { model: 'fixture' }).choices[0].message
  assert.equal(message.reasoning_content, 'Checking.')
  assert.equal(message.content, 'OK')
  assert.equal(message.tool_calls[0].thoughtSignature, 'fixture-signature')
})

test('Antigravity forwarding exposes thought-only frames but never completes a truncated reply', async () => {
  const response = {
    headersSent: false, writableEnded: false, destroyed: false, body: '',
    writeHead() { this.headersSent = true },
    write(value: string) { this.body += value; return true },
    end() { this.writableEnded = true },
  }
  let calls = 0
  const body = `data: ${JSON.stringify(event([{ thought: true, text: 'Checking.' }]))}\n\n`
  await assert.rejects(forwardAntigravity(response, {
    payload: { model: 'gemini-3.5-flash-lite', messages: [{ role: 'user', content: 'fixture' }] },
    stream: true, session: { projectId: 'fixture-project', accessToken: 'fixture-only' },
    fetchFn: async () => { calls++; return new Response(body) },
    signal: AbortSignal.timeout(3000),
  }), /without a finishReason/)
  assert.equal(calls, 1)
  assert.match(response.body, /"reasoning_content":"Checking\."/)
  assert.equal(response.body.includes('[DONE]'), false)
  assert.equal(response.writableEnded, false)
})
