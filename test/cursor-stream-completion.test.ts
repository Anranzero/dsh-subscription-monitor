import assert from 'node:assert/strict'
import { test } from 'node:test'
import http2 from 'node:http2'
import { once } from 'node:events'
import { runCursorAgent } from '../lib/oauth/cursor/h2-session.js'
import { frameConnect } from '../lib/oauth/cursor/proto.js'
import { forwardCursor } from '../lib/oauth/cursor/transport.js'

const session = { accessToken: 'fixture' }
const built = { requestBytes: Buffer.alloc(0), tools: [], blobStore: new Map() }
// AgentServerMessage.interaction.textDelta.text = "OK".
const text = frameConnect(Buffer.from([0x0a, 6, 0x0a, 4, 0x0a, 2, 0x4f, 0x4b]))
// AgentServerMessage.interaction.turnEnded = {}.
const turnEnded = frameConnect(Buffer.from([0x0a, 2, 0x72, 0]))
const endStream = frameConnect(Buffer.from('{}'), true)

async function withUpstream(chunks: Buffer[] | ((attempt: number) => Buffer[]), check: (run: (options?: any) => Promise<any>) => Promise<void>) {
  const server = http2.createServer()
  const peers = new Set<any>()
  const clients: any[] = []
  let attempts = 0
  server.on('session', peer => {
    peers.add(peer)
    peer.on('error', () => {})
    peer.on('close', () => peers.delete(peer))
  })
  server.on('stream', stream => {
    stream.on('error', () => {})
    stream.resume()
    stream.respond({ ':status': 200, 'content-type': 'application/connect+proto' })
    const reply = typeof chunks === 'function' ? chunks(++attempts) : chunks
    for (const chunk of reply) stream.write(chunk)
    stream.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    await check((options = {}) => runCursorAgent(session, built, {
      url, signal: AbortSignal.timeout(3000),
      ...options,
      connectFn: () => {
        const client = http2.connect(url)
        clients.push(client)
        return client
      },
    }))
  } finally {
    for (const client of clients) client.destroy()
    for (const peer of peers) peer.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

test('Cursor rejects empty HTTP EOF instead of completing an empty model reply', async () => {
  await withUpstream([], async run => {
    await assert.rejects(run(), /without.*(?:completion|end|terminal)/i)
  })
})

test('Cursor rejects EOF after complete text frames without a terminal event', async () => {
  await withUpstream([text], async run => {
    await assert.rejects(run(), /without.*(?:completion|end|terminal)/i)
  })
})

test('Cursor accepts an explicit turn-ended update', async () => {
  await withUpstream([text, turnEnded], async run => {
    const result = await run()
    assert.equal(result.collected.text, 'OK')
  })
})

test('Cursor accepts a successful Connect end envelope', async () => {
  await withUpstream([text, endStream], async run => {
    const result = await run()
    assert.equal(result.collected.text, 'OK')
  })
})

test('Cursor preserves an error from the Connect end envelope', async () => {
  const failure = frameConnect(Buffer.from(JSON.stringify({
    error: { code: 'unavailable', message: 'upstream unavailable' },
  })), true)
  await withUpstream([failure], async run => {
    await assert.rejects(run(), (error: any) => error.status === 503 && /upstream unavailable/.test(error.message))
  })
})

test('Cursor treats a code-only Connect error as failure', async () => {
  const failure = frameConnect(Buffer.from('{"error":{"code":"unavailable"}}'), true)
  await withUpstream([failure], async run => {
    await assert.rejects(run(), (error: any) => error.status === 503)
  })
})

function output() {
  return {
    headersSent: false, writableEnded: false, destroyed: false, body: '',
    writeHead() { this.headersSent = true },
    write(value: string) { this.body += value; return true },
    end() { this.writableEnded = true },
  }
}
function forward(response: any, run: (options?: any) => Promise<any>) {
  return forwardCursor(response, {
    payload: { model: 'composer-2.5', messages: [{ role: 'user', content: 'Hello' }] },
    stream: true, session, startedAt: Date.now(), signal: AbortSignal.timeout(4000),
    upstreamTimeouts: { firstByteMs: 500, budgetMs: 3500, idleMs: 1000 },
    runFn: (_session: any, _built: any, options: any) => run(options),
  })
}

test('Cursor retries an empty truncated attempt and returns the recovered answer once', async () => {
  await withUpstream(attempt => attempt === 1 ? [] : [text, turnEnded], async run => {
    const response = output()
    await forward(response, run)
    assert.equal(response.writableEnded, true)
    assert.equal(response.body.match(/"content":"OK"/g)?.length, 1)
    assert.equal(response.body.match(/\[DONE\]/g)?.length, 1)
  })
})

test('Cursor does not append a successful finish after a partial answer is truncated', async () => {
  await withUpstream([text], async run => {
    const response = output()
    await assert.rejects(forward(response, run), /without.*terminal/)
    assert.match(response.body, /"content":"OK"/)
    assert.equal(response.body.includes('[DONE]'), false)
    assert.equal(response.body.includes('"finish_reason":"stop"'), false)
    assert.equal(response.writableEnded, false)
  })
})

test('Cursor still hands a complete tool call to DSH when EOF follows the call', async () => {
  // AgentServerMessage.exec.mcpArgs: toolName="tool", toolCallId="id".
  const tool = frameConnect(Buffer.from([
    0x12, 12, 0x5a, 10, 0x0a, 4, 0x74, 0x6f, 0x6f, 0x6c, 0x1a, 2, 0x69, 0x64,
  ]))
  await withUpstream([tool], async run => {
    const result = await run()
    assert.deepEqual(result.collected.toolCalls, [{
      id: 'id', type: 'function', function: { name: 'tool', arguments: '{}' },
    }])
  })
})
