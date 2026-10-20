import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { Writable } from 'node:stream'

const sockets: FakeSocket[] = []
let failConnect = false
let missingPrevious = false
class FakeSocket extends EventTarget {
  readyState = 0
  sent: any[] = []
  constructor() {
    super()
    sockets.push(this)
    queueMicrotask(() => {
      if (this.readyState === 3) return
      if (failConnect) this.dispatchEvent(new Event('error'))
      else { this.readyState = 1; this.dispatchEvent(new Event('open')) }
    })
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
  send(text: string) {
    const body = JSON.parse(text)
    this.sent.push(body)
    queueMicrotask(() => {
      const events = missingPrevious && body.previous_response_id
        ? [{ type: 'error', error: { code: 'previous_response_not_found' } }]
        : [{ type: 'response.output_item.added', item: { type: 'message' } },
          { type: 'response.output_text.delta', delta: 'ok' },
          { type: 'response.completed', response: { id: 'resp-fixture', output: [] } }]
      for (const event of events) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
    })
  }
}
mock.module('../lib/utils/outbound.js', {
  namedExports: {
    OutboundWebSocket: FakeSocket,
    outboundWebsocketDispatcher: async () => ({ close: async () => {} }),
    outboundFetch: async () => { throw new Error('unexpected HTTP request') },
  },
})
const ws = await import('../lib/oauth/codex/websocket.js')
const session = { accessToken: 'fixture', accountId: 'account' }
const url = 'https://example.invalid/responses'
function response() {
  const output = new Writable({ write(_chunk, _encoding, done) { done() } }) as any
  output.headersSent = false
  output.writeHead = () => { output.headersSent = true }
  return output
}
test('preconnection deduplicates, sends no prompt, and subsequent requests send only the input tail', async () => {
  ws.closeCodexWebSockets()
  delete process.env.DSH_CODEX_WEBSOCKET
  assert.equal(ws.codexWebSocketMode(), 'auto')
  await Promise.all([ws.prepareCodexWebSocket(url, session, 'chat'), ws.prepareCodexWebSocket(url, session, 'chat')])
  assert.equal(sockets.length, 1)
  assert.equal(sockets[0].sent.length, 0)
  assert.equal(ws.codexWebSocketReady(session, 'chat'), true)
  const payload = { model: 'fixture', stream: true, store: false, input: [{ role: 'user', content: 'one' }] }
  const timing = { stats: {} as any, mark() {} }
  let textSeen = false
  await ws.attemptCodexWebSocket(response(), { url, session, cacheSessionId: 'chat', payload, timing,
    captureSse: { onText: () => { textSeen = true } } })
  assert.equal(textSeen, true, 'text arriving after the stream committed is still measured')
  assert.equal(sockets[0].sent[0].stream, undefined)
  await ws.attemptCodexWebSocket(response(), { url, session, cacheSessionId: 'chat',
    payload: { ...payload, input: [...payload.input, { role: 'user', content: 'two' }] }, timing })
  assert.equal(timing.stats.wsReused, true)
  assert.equal(timing.stats.wsDelta, true)
  assert.equal(sockets[0].sent[1].previous_response_id, 'resp-fixture')
  assert.deepEqual(sockets[0].sent[1].input, [{ role: 'user', content: 'two' }])
  missingPrevious = true
  await ws.attemptCodexWebSocket(response(), { url, session, cacheSessionId: 'chat',
    payload: { ...payload, input: [...payload.input, { role: 'user', content: 'two' }, { role: 'user', content: 'three' }] } })
  assert.equal(sockets.at(-1)!.sent[0].previous_response_id, undefined)
  assert.equal(sockets.at(-1)!.sent[0].input.length, 3)
  missingPrevious = false
  const oldClose = ws.ownCodexWebSockets()
  const newClose = ws.ownCodexWebSockets()
  oldClose()
  assert.equal(ws.codexWebSocketPoolSize(), 1)
  newClose()
  assert.equal(ws.codexWebSocketPoolSize(), 0)
})
test('failed preparation enters cooldown; disabling or disposing cannot leave a live socket', async () => {
  failConnect = true
  await ws.prepareCodexWebSocket(url, session, 'failed')
  assert.equal(ws.codexWebSocketCooling('failed'), true)
  assert.equal(ws.codexWebSocketReady(session, 'failed'), false)
  const before = sockets.length
  await ws.prepareCodexWebSocket(url, session, 'failed')
  assert.equal(sockets.length, before)
  failConnect = false
  process.env.DSH_CODEX_WEBSOCKET = 'off'
  await ws.prepareCodexWebSocket(url, session, 'disabled')
  assert.equal(sockets.length, before)
  delete process.env.DSH_CODEX_WEBSOCKET
  const preparing = ws.prepareCodexWebSocket(url, session, 'dispose')
  ws.closeCodexWebSockets()
  await preparing
  assert.equal(ws.codexWebSocketPoolSize(), 0)
  assert.ok(sockets.every(socket => socket.readyState === 3))
})
