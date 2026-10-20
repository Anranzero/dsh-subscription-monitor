import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { Agent } from 'undici'
import { installCommandCodeConnectionRecovery } from '../lib/apikey/command-code/connection-recovery.js'

const url = 'https://api.commandcode.ai/provider/v1/responses'
const request = { method: 'POST', headers: { authorization: 'Bearer fixture-only' }, body: '{"model":"fixture"}' }
const connectError = () => new TypeError('fetch failed', { cause: Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) })

test('real TLS connect timeout recovers before the only HTTP POST is delivered', async () => {
  const sockets = new Set<any>()
  let handshakes = 0
  const blackhole = createTcpServer(socket => { handshakes++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  let deliveries = 0
  let received = ''
  const healthy = createHttpServer(async (req, res) => {
    deliveries++
    for await (const chunk of req) received += chunk
    res.end('recovered')
  })
  await new Promise<void>(resolve => blackhole.listen(0, '127.0.0.1', resolve))
  await new Promise<void>(resolve => healthy.listen(0, '127.0.0.1', resolve))
  const dispatcher = new Agent({ connectTimeout: 50 })
  const native = globalThis.fetch
  let attempts = 0
  globalThis.fetch = (_input, init) => {
    attempts++
    const target = attempts === 1
      ? `https://127.0.0.1:${(blackhole.address() as any).port}`
      : `http://127.0.0.1:${(healthy.address() as any).port}`
    return native(target, { ...init, dispatcher })
  }
  const dispose = installCommandCodeConnectionRecovery()
  try {
    assert.equal(await (await fetch(url, request)).text(), 'recovered')
    assert.equal(attempts, 2)
    assert.equal(handshakes, 1)
    assert.equal(deliveries, 1)
    assert.equal(received, request.body)
  } finally {
    dispose()
    globalThis.fetch = native
    await dispatcher.destroy()
    for (const socket of sockets) socket.destroy()
    await Promise.all([new Promise<void>(resolve => blackhole.close(() => resolve())), new Promise<void>(resolve => healthy.close(() => resolve()))])
  }
})

test('connection recovery is bounded, preserves native request options, and respects cancellation', async () => {
  const native = globalThis.fetch
  let calls = 0
  const controller = new AbortController()
  const options = { ...request, signal: controller.signal, dispatcher: {} }
  globalThis.fetch = async (_input, init) => {
    calls++
    assert.equal(init, options)
    throw connectError()
  }
  const dispose = installCommandCodeConnectionRecovery()
  try {
    await assert.rejects(fetch(url, options), (error: any) => error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT')
    assert.equal(calls, 3)
    calls = 0
    controller.abort()
    await assert.rejects(fetch(url, options))
    assert.equal(calls, 1)
  } finally { dispose(); globalThis.fetch = native }
})

test('only Command Code JSON POSTs retry; ambiguous failures, responses and streaming bodies never replay', async () => {
  const native = globalThis.fetch
  let calls = 0
  let failure: any = connectError()
  globalThis.fetch = async () => { calls++; throw failure }
  const dispose = installCommandCodeConnectionRecovery()
  try {
    for (const [target, init] of [
      ['https://other.example/provider/v1/responses', request],
      ['https://api.commandcode.ai/alpha/generate', request],
      ['http://api.commandcode.ai/provider/v1/responses', request],
      ['https://api.commandcode.ai:444/provider/v1/responses', request],
      [url, { ...request, method: 'GET' }],
      [url, { ...request, body: new ReadableStream() }],
    ] as const) {
      calls = 0
      await assert.rejects(fetch(target, init as any))
      assert.equal(calls, 1, target)
    }
    for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'CERT_HAS_EXPIRED']) {
      calls = 0
      failure = new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })
      await assert.rejects(fetch(url, request))
      assert.equal(calls, 1, code)
    }
  } finally { dispose(); globalThis.fetch = native }
})

test('HTTP errors and failures while consuming a successful response are left to the caller', async () => {
  const native = globalThis.fetch
  let calls = 0
  let response = new Response('busy', { status: 503 })
  globalThis.fetch = async () => { calls++; return response }
  const dispose = installCommandCodeConnectionRecovery()
  try {
    assert.equal((await fetch(url, request)).status, 503)
    response = new Response(new ReadableStream({ start(controller) { controller.error(connectError()) } }))
    await assert.rejects((await fetch(url, request)).text())
    assert.equal(calls, 2)
  } finally { dispose(); globalThis.fetch = native }
})

test('unloading disables recovery even when another fetch wrapper was installed afterwards', async () => {
  const native = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; throw connectError() }
  const dispose = installCommandCodeConnectionRecovery()
  const recovery = globalThis.fetch
  const later = (input: any, init: any) => recovery(input, init)
  globalThis.fetch = later
  try {
    dispose()
    assert.equal(globalThis.fetch, later)
    await assert.rejects(fetch(url, request))
    assert.equal(calls, 1)
  } finally { globalThis.fetch = native }
})

test('hot reload keeps one retry budget and old cleanup cannot disable its replacement', async () => {
  const native = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; throw connectError() }
  const oldDispose = installCommandCodeConnectionRecovery()
  const oldWrapper = globalThis.fetch
  globalThis.fetch = (input, init) => oldWrapper(input, init)
  const dispose = installCommandCodeConnectionRecovery()
  oldDispose()
  try {
    for (const path of ['chat/completions', 'responses', 'messages']) {
      calls = 0
      await assert.rejects(fetch(`https://api.commandcode.ai/provider/v1/${path}`, request))
      assert.equal(calls, 3, path)
    }
  } finally { dispose(); globalThis.fetch = native }
})

test('cancellation during a failed connection prevents the next attempt', async () => {
  const native = globalThis.fetch
  let calls = 0
  const controller = new AbortController()
  globalThis.fetch = async () => {
    calls++
    controller.abort()
    throw connectError()
  }
  const dispose = installCommandCodeConnectionRecovery()
  try {
    await assert.rejects(fetch(url, { ...request, signal: controller.signal }))
    assert.equal(calls, 1)
  } finally { dispose(); globalThis.fetch = native }
})
