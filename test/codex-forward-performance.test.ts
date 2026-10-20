import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { test, mock } from 'node:test'
import { zstdDecompressSync } from 'node:zlib'
import { encodeCodexBody } from '../lib/oauth/codex/request.js'
import { UpstreamFailure } from '../lib/oauth/upstream.js'

let websocket: 'off' | 'success' | 'fallback' = 'off'
let websocketMode = 'on'
let websocketReady = true
let preparations = 0
mock.module('../lib/oauth/codex/websocket.js', {
  namedExports: {
    codexWebSocketEnabled: () => websocket !== 'off',
    codexWebSocketMode: () => websocketMode,
    codexWebSocketReady: () => websocketReady,
    prepareCodexWebSocket: () => { preparations++; return new Promise(() => {}) },
    codexWebSocketCooling: () => false,
    markCodexWebSocketFallback: () => {},
    attemptCodexWebSocket: async (response: any) => {
      if (websocket === 'fallback')
        throw new UpstreamFailure(502, 'fixture', { code: 'transport' })
      response.writeHead(200, {})
      response.end('websocket output')
    },
  },
})
const { forward } = await import('../lib/oauth/passthrough.js')
const { codexTimingSnapshot } = await import('../lib/oauth/codex/timing.js')
const sse = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n'

function fixture() {
  const raw = Buffer.from(JSON.stringify({
    model: 'gpt-6.1-sol', stream: true, prompt_cache_key: 'test-session',
    input: [{ role: 'user', content: 'PRIVATE_PROMPT' }],
  }))
  const request = Readable.from([raw]) as any
  request.headers = { 'content-type': 'application/json', 'content-length': String(raw.length) }
  const chunks: Buffer[] = []
  const response = new Writable({
    write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() },
  }) as any
  response.headersSent = false
  response.writeHead = (status: number) => {
    response.statusCode = status
    response.headersSent = true
  }
  return { request, response, chunks }
}
function options(overrides: any = {}) {
  return {
    url: 'https://example.invalid/responses', family: 'codex',
    session: { accessToken: 'PRIVATE_TOKEN' },
    tokens: {
      sourceOf: () => ({ id: 'fixture-account' }),
      refreshNow: async () => ({ session: { accessToken: 'ROTATED_TOKEN' } }),
    },
    headersOf: (session: any) => ({ authorization: `Bearer ${session.accessToken}` }),
    fetchFn: async () => new Response(sse),
    encodeBody: encodeCodexBody, startedAt: Date.now(),
    ...overrides,
  }
}

test('Codex compression yields a promise and preserves every request byte', async () => {
  const raw = Buffer.from('请求正文\n'.repeat(10000))
  const pending = encodeCodexBody(raw)
  assert.ok(pending instanceof Promise, 'compression must leave the main thread')
  const encoded = await pending
  assert.equal(encoded.headers['content-encoding'], 'zstd')
  assert.deepEqual(zstdDecompressSync(encoded.body), raw)
})

test('successful WebSocket bypasses HTTP encoding and fetch entirely', async () => {
  websocket = 'success'
  const f = fixture()
  await forward(f.request, f.response, options({
    encodeBody: () => { assert.fail('unused HTTP encoding') },
    fetchFn: () => { assert.fail('unused HTTP fetch') },
  }))
  assert.equal(Buffer.concat(f.chunks).toString(), 'websocket output')
})

test('auto mode answers on HTTP while the background handshake is pending', async () => {
  websocket = 'success'
  websocketMode = 'auto'
  websocketReady = false
  const f = fixture()
  const before = preparations
  try {
    await forward(f.request, f.response, options())
    assert.equal(preparations, before + 1)
    assert.equal(Buffer.concat(f.chunks).toString(), sse)
    assert.equal(codexTimingSnapshot().last.transport, 'sse')
    assert.ok(codexTimingSnapshot().last.stagesMs.firstText >= 0)
  } finally { websocketMode = 'on'; websocketReady = true }
})

test('first text excludes preamble and empty deltas, including split SSE frames', async () => {
  websocket = 'off'
  const f = fixture()
  const preamble = 'event: response.created\ndata: {"type":"response.created"}\n\n'
    + 'event: response.output_text.delta\ndata: {"delta":""}\n\n'
  const text = new TextEncoder().encode(sse)
  await forward(f.request, f.response, options({
    fetchFn: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(preamble))
        controller.enqueue(text.slice(0, text.length - 2))
        controller.enqueue(text.slice(text.length - 2))
        controller.close()
      },
    })),
  }))
  const last = codexTimingSnapshot().last
  assert.equal(last.success, true)
  assert.ok(last.stagesMs.firstText >= last.stagesMs.upstreamHeaders)
  assert.equal(Buffer.concat(f.chunks).toString(), preamble + sse)
  assert.ok(!JSON.stringify(last).includes('PRIVATE_'))
})

test('WebSocket fallback awaits async encoding and forwards unchanged SSE', async () => {
  websocket = 'fallback'
  const f = fixture()
  let encodes = 0
  await forward(f.request, f.response, options({
    encodeBody: async (raw: Buffer) => { encodes++; return await encodeCodexBody(raw) },
    fetchFn: async (_url: string, init: any) => {
      assert.equal(init.headers['content-encoding'], 'zstd')
      const payload = JSON.parse(zstdDecompressSync(init.body).toString())
      assert.equal(payload.input[0].content, 'PRIVATE_PROMPT')
      return new Response(sse)
    },
  }))
  assert.equal(encodes, 1)
  assert.equal(Buffer.concat(f.chunks).toString(), sse)
})

test('401 refresh reuses encoded bytes and replaces only credential headers', async () => {
  websocket = 'off'
  const f = fixture()
  let encodes = 0
  const bodies: Buffer[] = []
  const headers: string[] = []
  await forward(f.request, f.response, options({
    encodeBody: async (raw: Buffer) => { encodes++; return await encodeCodexBody(raw) },
    fetchFn: async (_url: string, init: any) => {
      bodies.push(init.body)
      headers.push(init.headers.authorization)
      return bodies.length === 1 ? new Response('{}', { status: 401 }) : new Response(sse)
    },
  }))
  assert.equal(encodes, 1)
  assert.ok(Buffer.isBuffer(bodies[0]))
  assert.equal(bodies[0], bodies[1])
  assert.deepEqual(headers, ['Bearer PRIVATE_TOKEN', 'Bearer ROTATED_TOKEN'])
})

test('cancellation during encoding cannot dispatch a late upstream request', async () => {
  websocket = 'off'
  const f = fixture()
  const controller = new AbortController()
  let release!: (value: any) => void
  let entered!: () => void
  const encoding = new Promise(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  let fetched = false
  const running = forward(f.request, f.response, options({
    signal: controller.signal,
    encodeBody: () => { entered(); return encoding },
    fetchFn: async () => { fetched = true; return new Response(sse) },
  }))
  const rejected = assert.rejects(running, /cancelled/)
  await started
  controller.abort(new Error('cancelled'))
  release({ body: Buffer.from('encoded'), headers: {} })
  await rejected
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fetched, false)
})

test('opt-in timing reports stage offsets without request or credential data', async (t) => {
  websocket = 'off'
  const previous = process.env.DSH_CODEX_TIMING
  process.env.DSH_CODEX_TIMING = 'on'
  const logs: string[] = []
  t.mock.method(console, 'error', (line: string) => { logs.push(line) })
  try {
    const f = fixture()
    await forward(f.request, f.response, options())
    const line = logs.find(line => line.startsWith('[oauth-subs] codex timing '))
    assert.ok(line)
    assert.doesNotMatch(line, /PRIVATE|test-session|fixture-account|example.invalid/)
    const trace = JSON.parse(line.slice('[oauth-subs] codex timing '.length))
    assert.equal(trace.success, true)
    assert.equal(trace.transport, 'sse')
    assert.equal(trace.attempts, 1)
    const stages = ['credentialsReady', 'bodyRead', 'normalized', 'encodeStart',
      'encodeEnd', 'upstreamSend', 'upstreamHeaders', 'firstForward']
    let last = 0
    for (const stage of stages) {
      assert.equal(typeof trace.stagesMs[stage], 'number', stage)
      assert.ok(trace.stagesMs[stage] >= last, stage)
      last = trace.stagesMs[stage]
    }
  } finally {
    if (previous === undefined) delete process.env.DSH_CODEX_TIMING
    else process.env.DSH_CODEX_TIMING = previous
  }
})

test('timing is silent by default and a non-Codex route keeps its JSON wire', async (t) => {
  websocket = 'off'
  const previous = process.env.DSH_CODEX_TIMING
  delete process.env.DSH_CODEX_TIMING
  const logs: string[] = []
  t.mock.method(console, 'error', (line: string) => { logs.push(line) })
  try {
    const codex = fixture()
    await forward(codex.request, codex.response, options())
    process.env.DSH_CODEX_TIMING = 'on'
    const chatgpt = fixture()
    await forward(chatgpt.request, chatgpt.response, options({
      family: 'chatgpt',
      encodeBody: undefined,
      fetchFn: async (_url: string, init: any) => {
        assert.equal(init.headers['content-encoding'], undefined)
        assert.equal(JSON.parse(init.body.toString()).input[0].content, 'PRIVATE_PROMPT')
        return new Response(sse)
      },
    }))
    assert.equal(logs.length, 0)
    assert.equal(Buffer.concat(chatgpt.chunks).toString(), sse)
  } finally {
    if (previous === undefined) delete process.env.DSH_CODEX_TIMING
    else process.env.DSH_CODEX_TIMING = previous
  }
})
