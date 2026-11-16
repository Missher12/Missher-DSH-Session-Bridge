import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

function fixture() {
  const slots = [], providers = [], disposers = [], copied = [], requests = []
  const listeners = new Set()
  const rows = { chosen: { cwd: '/chosen', running: false } }
  const sessions = { list: { getSnapshot: () => ({ byId: rows }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } } }
  let client
  runInNewContext(readFileSync(new URL('../lib/client/index.js', import.meta.url), 'utf8'), {
    AbortController, AbortSignal, setTimeout, clearTimeout,
    navigator: { clipboard: { async writeText(text) { copied.push(text) } } },
    fetch: (_url, options) => new Promise(resolve => requests.push({ options, resolve })),
    window: { __ModuleLoader__: { load({ factory }) {
      client = factory(id => id === '@deepseek-ai/dsh-client-ui-primitives'
        ? new Proxy({}, { get: () => () => null }) : {})
    } } },
  })
  client.apply({
    effect(start, label) { if (label !== 'session-bridge: styles') disposers.push(start()) },
    locale: { register: () => () => {}, bind: () => key => key },
    uiWorkspace: {}, sessions,
    workspaces: { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} } },
    get(name) { return name === 'contextMenus' ? { register(provider) {
      providers.push(provider); return () => providers.splice(providers.indexOf(provider), 1)
    } } : undefined },
    slots: { inject(_name, register) { register() }, register(options, component) {
      slots.push({ ...options, component }); return () => {}
    } },
  })
  return { slots, providers, copied, requests, rows, listeners,
    dispose() { for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose() } }
}

it('joins the native copy group without duplicating ID and places icon-backed deletion after archive', async () => {
  const f = fixture()
  try {
    assert.equal(f.slots.filter(row => row.name === 'sidebar.workspaces.session.menu.item').length, 0,
      'the new Host already owns the ID action; legacy contributions duplicate it')
    const target = { sessionId: 'chosen', displayTitle: 'Chosen' }
    const entries = f.providers.flatMap(provider => provider.resolve(target, new AbortController().signal))
    assert.equal(entries.length, 3)
    const icons = new Set(f.slots.filter(row => row.name === 'contextMenu.icon').map(row => row.key))
    assert(entries.every(entry => icons.has(entry.icon.key)), 'every action has a registered native icon')
    for (const provider of f.providers.filter(row => row.order < 600)) {
      assert(provider.order > 450, 'copies follow the native ID action')
      for (const entry of provider.resolve(target, new AbortController().signal)) {
        assert(!entry.separatorBefore && !entry.afterContent, 'copy fields stay in the ID group')
        await entry.run()
      }
    }
    assert.deepEqual(f.copied, ['/chosen', '/bridge chosen '])
    const deletion = f.providers.find(row => row.order > 600)
    const [entry] = deletion.resolve(target, new AbortController().signal)
    assert(entry.afterContent && entry.separatorBefore && entry.danger && entry.disabled)
  } finally { f.dispose() }
  assert.equal(f.providers.length, 0)
})

it('keeps native deletion visible while checking, disables running sessions and opens only confirmation', async () => {
  const f = fixture()
  const target = { sessionId: 'chosen', displayTitle: 'Chosen' }
  const deletion = f.providers.find(row => row.order > 600)
  assert(deletion, 'native deletion must be registered')
  const unobserve = deletion.observe(target).map(source => source.subscribe(() => {}))
  try {
    const resolve = () => deletion.resolve(target, new AbortController().signal)[0]
    assert.equal(resolve().disabled, true)
    f.requests[0].resolve(Response.json({ supported: true }))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(resolve().disabled, false)
    f.rows.chosen.running = true
    assert.equal(resolve().disabled, true)
    f.rows.chosen.running = false
    resolve().run()
    const dialog = f.slots.find(row => row.id === 'dsh-session-bridge.delete-dialog').inject().deleteActions
    assert.equal(dialog.getSnapshot().sessionId, 'chosen')
    assert(f.requests.every(request => request.options.method === undefined), 'opening confirmation sends no deletion')
    dialog.dismiss()
  } finally { for (const off of unobserve) off(); f.dispose() }
  assert(f.requests[0].options.signal.aborted, 'menu disposal cancels its capability request')
})

it('retains a disabled native deletion entry when capability lookup fails or is unsupported', async () => {
  for (const response of [Response.json({ supported: false }), new Response('', { status: 500 })]) {
    const f = fixture(), target = { sessionId: 'chosen' }
    const deletion = f.providers.find(row => row.order > 600)
    assert(deletion, 'native deletion must be registered')
    const off = deletion.observe(target).map(source => source.subscribe(() => {}))
    try {
      f.requests[0].resolve(response)
      await new Promise(resolve => setImmediate(resolve))
      const [entry] = deletion.resolve(target, new AbortController().signal)
      assert(entry.disabled)
      assert.notEqual(entry.label, 'delete.checkingAction')
    } finally { for (const dispose of off) dispose(); f.dispose() }
  }
})
