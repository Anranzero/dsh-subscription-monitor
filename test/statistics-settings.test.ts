import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

function setup(storage: Map<string, string>, forceOpen = false) {
  let definition: any
  const slots = new Map<string, any>()
  const cleanups: (() => void)[] = []
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial: any) => [typeof initial === 'function' ? initial() : initial === false && forceOpen ? true : initial, () => {}],
    useEffect: (run: any) => { const off = run(); if (typeof off === 'function') cleanups.push(off) },
  }
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }
  const window = { localStorage, __ModuleLoader__: { load: (value: any) => { definition = value } } }
  vm.runInNewContext(readFileSync(new URL('../lib/ui/client.js', import.meta.url), 'utf8'), { window, localStorage })
  const plugin = definition.factory((name: string) => name === 'react' ? react : { Switch: 'native-switch' })
  plugin.apply({ get() {}, slots: {
    inject: (_name: string, run: any) => run(),
    register: (entry: any, view: any) => { slots.set(entry.key ?? entry.id ?? entry.name, { entry, view }) },
  } })
  return { slots, dispose: () => cleanups.reverse().forEach(off => off()) }
}
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)]

test('statistics has a persistent switch on the bundle detail card; disabling leaves subscriptions registered', () => {
  const storage = new Map<string, string>()
  let app = setup(storage)
  let card = app.slots.get('dsh-subscription-monitor')
  assert.equal(card?.entry.name, 'plugins.bundle.config', 'settings live on this bundle detail page')
  let tree = card.view({ view: 'page' })
  assert.equal(tree.type, 'div')
  assert.equal(nodes(tree).some(node => node.type === 'details' || node.type === 'summary'), false)
  let toggle = nodes(tree).find(node => node.type === 'native-switch')
  assert.equal(toggle.props.checked, true, 'existing statistics stays enabled by default')
  toggle.props.onChange(false)
  assert.ok(app.slots.has('oauth-subs'))
  assert.ok(app.slots.has('oauth-subs-quota'))
  assert.equal(app.slots.get('oauth-subs-stats-overlay').view({}), null)
  app.dispose()
  app = setup(storage, true)
  card = app.slots.get('dsh-subscription-monitor')
  tree = card.view({ view: 'page' })
  toggle = nodes(tree).find(node => node.type === 'native-switch')
  assert.equal(toggle.props.checked, false)
  assert.equal(app.slots.get('oauth-subs-stats-menu').view({}), null)
  let rpcTouches = 0
  const rpc = new Proxy({}, { get() { rpcTouches++; return () => Promise.resolve({}) } })
  assert.equal(app.slots.get('oauth-subs-stats-overlay').view({ rpc }), null)
  assert.equal(rpcTouches, 0, 'even an already-open overlay cannot request statistics while disabled')
  toggle.props.onChange()
  app.dispose()
  app = setup(storage)
  assert.equal(nodes(app.slots.get('dsh-subscription-monitor').view({ view: 'page' })).find(node => node.type === 'native-switch').props.checked, true)
  app.dispose()
})
