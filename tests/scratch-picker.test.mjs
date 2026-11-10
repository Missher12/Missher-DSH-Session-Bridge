import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { it } from 'node:test'
import { build } from 'esbuild'

// Reuse a development checkout's DOM toolchain; these never enter the plugin.
const require = createRequire(resolve(process.env.DSH_UI_TEST_DEPS ?? '.', 'package.json'))
let React, JSDOM, createRoot
try {
  React = require('react'); ({ JSDOM } = require('jsdom'))
} catch { /* Bare checkouts retain the existing optional DOM-test convention. */ }
const skip = !React || !JSDOM ? 'set DSH_UI_TEST_DEPS to a checkout with React and jsdom' : false
let Picker
if (!skip) {
  const bootstrap = new JSDOM('<!doctype html><body></body>')
  globalThis.window = bootstrap.window; globalThis.document = bootstrap.window.document
  ;({ createRoot } = require('react-dom/client'))
  bootstrap.window.close(); delete globalThis.window; delete globalThis.document
  const { outputFiles } = await build({ entryPoints: [new URL('../src/client/ScratchWorkspacePicker.tsx', import.meta.url).pathname],
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] })
  const primitives = {
    Menu: ({ open, items, onSelect }) => open && React.createElement('nav', {}, items.map(item =>
      React.createElement('button', { key: item.id, 'data-id': item.id, disabled: item.disabled, onClick: () => onSelect(item.id) }, item.label))),
    Modal: ({ open, children, footer }) => open && React.createElement('dialog', { open: true }, children, footer),
    Button: ({ children, ...props }) => React.createElement('button', props, children),
    IconFolderCloseRegular: () => null, IconPlusOutlineRegular: () => null, IconSparkleRegular: () => null,
  }
  const scope = { module: { exports: {} }, AbortController, require: id => id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(id) }
  vm.runInNewContext(outputFiles[0].text, scope); Picker = scope.module.exports.ScratchWorkspacePicker
}

async function fixture(items) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root')), requests = [], picks = []
  let creations = 0
  const props = { open: true, useWorkspaces: select => select({ phase: 'ready', items }),
    createWorkspace: async () => { throw new Error('unexpected adoption') }, pickDirectory: async () => null,
    findScratchWorkspace: signal => new Promise((resolve, reject) => requests.push({ resolve, reject, signal })),
    startScratchSession: async () => { creations++; return { workspaceId: 'scratch' } },
    onPick: id => picks.push(id), onClose() {} }
  const rows = () => [...document.querySelectorAll('nav button')]
  const ids = () => rows().map(row => row.dataset.id)
  const render = async () => React.act(async () => root.render(React.createElement(Picker, props)))
  await render()
  return { requests, picks, ids, props, render, rows, get creations() { return creations },
    async close() { await React.act(async () => root.unmount()); dom.window.close(); delete globalThis.window; delete globalThis.document } }
}

it('keeps the scratch action directly after Add workspace during lookup and every source order', { skip }, async () => {
  for (const items of [
    [{ workspaceId: 'scratch', title: 'Outside' }, { workspaceId: 'project', title: 'Project' }],
    [{ workspaceId: 'project', title: 'Project' }, { workspaceId: 'scratch', title: 'Renamed scratch' }],
  ]) {
    const f = await fixture(items)
    try {
      assert.deepEqual(f.ids().slice(-2), ['::add-workspace', '::scratch-session'])
      assert.equal(f.ids().includes('scratch'), false, 'unknown identities never flash in the ordinary list')
      await React.act(async () => f.requests[0].resolve('scratch'))
      assert.deepEqual(f.ids(), ['project', '::add-workspace', 'scratch'])
      assert.equal(f.creations, 0, 'opening remains read-only')
      await React.act(async () => f.rows().at(-1).click())
      assert.equal(f.creations, 1, 'the fixed directory is ensured even for a saved registration')
      assert.deepEqual(f.picks, ['scratch'])
    } finally { await f.close() }
  }
})

it('a failed lookup keeps a fixed disabled action and offers a retry without guessing by title', { skip }, async () => {
  const f = await fixture([{ workspaceId: 'scratch', title: 'Outside' }, { workspaceId: 'project', title: 'Project' }])
  try {
    await React.act(async () => f.requests[0].reject(new Error('network failure')))
    assert.deepEqual(f.ids().slice(-2), ['::add-workspace', '::scratch-session'])
    assert.equal(f.rows().at(-1).disabled, true)
    assert.equal(f.ids().includes('scratch'), false)
    const retry = f.rows().find(row => row.dataset.id === '::scratch-retry')
    assert.ok(retry)
    await React.act(async () => document.querySelector('dialog button').click())
    await React.act(async () => retry.click())
    await React.act(async () => f.requests[1].resolve('scratch'))
    assert.deepEqual(f.ids(), ['project', '::add-workspace', 'scratch'])
    assert.equal(f.creations, 0)
  } finally { await f.close() }
})

it('a refresh failure preserves the known scratch identity and its last-row placement', { skip }, async () => {
  let items = [{ workspaceId: 'scratch', title: 'Outside' }, { workspaceId: 'project', title: 'Project' }]
  const f = await fixture(items)
  try {
    await React.act(async () => f.requests[0].resolve('scratch'))
    items = [...items, { workspaceId: 'other', title: 'Other' }]
    f.props.useWorkspaces = select => select({ phase: 'ready', items })
    await f.render()
    await React.act(async () => f.requests[1].reject(new Error('temporary failure')))
    assert.deepEqual(f.ids().slice(-2), ['::add-workspace', 'scratch'])
    assert.equal(f.ids().filter(id => id === 'scratch').length, 1)
    assert.equal(f.rows().at(-1).disabled, false)
  } finally { await f.close() }
})
