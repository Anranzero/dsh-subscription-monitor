import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('undici is a regular dependency, never a peer dependency', () => {
  // Peer-declared packages are routed to the host by DSH's linked-resolution
  // layer. The host ships a patched undici 8.x build whose file set differs
  // from the registry package; routing it in (or materialising a partial copy)
  // used to kill the plugin at import time and take the loopback proxy with
  // it. Keep undici in `dependencies` so the registry 7.x is what runs.
  assert.equal(manifest.peerDependencies?.undici, undefined)
  assert.match(manifest.dependencies?.undici ?? '', /^\^?7\./)
})
