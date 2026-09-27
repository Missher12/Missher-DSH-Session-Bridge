/** Render shipped session menus, confirmation and scratch picker with real React/primitives in JSDOM. */
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { build } from 'esbuild'

const checkout = resolve(process.argv[2] ?? '')
const requireHost = createRequire(join(checkout, 'package.json'))
const requireUi = createRequire(join(checkout, 'packages/client/ui-primitives/package.json'))
const { JSDOM } = requireHost('jsdom')
const React = requireUi('react')
const { createRoot } = requireUi('react-dom/client')
const { act } = React
const temporary = await mkdtemp(join(tmpdir(), 'bridge-menu-dom-'))
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
const keys = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver']
const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key], writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const copied = []
Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async text => { copied.push(text) } } })
let root
const cleanup = []
try {
  const primitiveDir = join(checkout, 'packages/client/ui-primitives/src')
  const entry = join(temporary, 'primitives.mjs')
  await writeFile(entry, ['Menu:Menu', 'MenuItemButton:Menu', 'Modal:Modal', 'Button:Button', 'Toast:Toast'].map(item => {
    const [name, file] = item.split(':')
    return `export { ${name} } from ${JSON.stringify(join(primitiveDir, file + '.tsx'))};`
  }).join('\n') + `\nexport { IconFolderCloseRegular, IconPlusOutlineRegular, IconSparkleRegular } from ${JSON.stringify(join(primitiveDir, 'icons/index.tsx'))};\n`)
  const output = await build({ entryPoints: [entry], outfile: join(temporary, 'primitives.cjs'), bundle: true, write: false, format: 'cjs', platform: 'browser', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const primitiveModule = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${output.outputFiles.find(file => file.path.endsWith('.cjs')).text}\n})`)(requireUi, primitiveModule, primitiveModule.exports)
  const primitives = primitiveModule.exports
  let plugin
  let sends = 0
  let finish
  const registrations = new Map()
  const snapshot = { archivedSessionIds: ['archived'] }
  const archive = { getSnapshot: () => snapshot, subscribe: () => () => {} }
  const sandbox = {
    window: { __ModuleLoader__: { load({ factory }) {
      plugin = factory(id => {
        if (id === 'react') return React
        if (id === 'react/jsx-runtime') return requireUi(id)
        if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
        throw new Error('Unexpected import ' + id)
      })
    } } }, document, navigator, console, setTimeout, clearTimeout, AbortController,
    fetch: async (path, options) => {
      sends++
      assert.equal(path, 'api/session-bridge/delete-session')
      assert.deepEqual(JSON.parse(options.body), { sessionId: 'archived', confirmed: true })
      return await new Promise(resolve => { finish = resolve })
    },
  }
  vm.runInNewContext(await readFile(new URL('../lib/client/index.js', import.meta.url), 'utf8'), sandbox)
  plugin.apply({
    effect(start) { const dispose = start(); if (typeof dispose === 'function') cleanup.push(dispose) },
    locale: { register: () => () => {} },
    uiWorkspace: {}, workspaces: { list: archive },
    sessions: { list: { getSnapshot: () => ({ byId: { archived: { cwd: '/synthetic/workspace' } } }) } },
    slots: { inject(_slot, register) { register() }, register(options, component) {
      registrations.set(options.id, { options, component }); return () => {}
    } },
  })
  let reopen
  function View() {
    const [open, setOpen] = React.useState(true)
    reopen = () => setOpen(true)
    const cells = []
    for (const [id, { options, component }] of registrations) {
      if (options.name === 'shell.overlay' || (open && options.name === 'sidebar.workspaces.session.menu.item')) {
        cells.push(React.createElement(component, { key: id, ...options.inject(), sessionId: 'archived', useMenuOpenState: () => [open, setOpen] }))
      }
    }
    return React.createElement(React.Fragment, null, ...cells)
  }
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(View)))
  function button(text) {
    const found = [...document.querySelectorAll('button')].find(node => node.textContent === text)
    assert.ok(found, `missing button: ${text}`)
    return found
  }
  for (const label of ['Copy session ID', 'Copy working directory', 'Copy /bridge reference']) {
    await act(async () => button(label).click())
    assert.equal(document.querySelector('[role=menuitem]'), null, 'copy closes the row menu')
    assert.ok(document.body.textContent.includes('Copied'), 'copy feedback survives menu unmount')
    await act(async () => reopen())
  }
  assert.deepEqual(copied, ['archived', '/synthetic/workspace', '/bridge archived '])
  await act(async () => button('Delete session…').click())
  assert.equal(sends, 0)
  assert.ok(document.querySelector('[role=dialog]').textContent.includes('Files in the workspace are kept.'))
  await act(async () => button('Cancel').click())
  assert.equal(document.querySelector('[role=dialog]'), null)
  assert.equal(sends, 0)
  await act(async () => reopen())
  await act(async () => button('Delete session…').click())
  await act(async () => button('Delete permanently').click())
  assert.equal(sends, 1)
  assert.equal(button('Deleting…').disabled, true)
  assert.equal(button('Cancel').disabled, true)
  await act(async () => {
    finish(Response.json({ ok: true, value: { sessionId: 'archived' } }))
    await Promise.resolve()
  })
  assert.equal(document.querySelector('[role=dialog]'), null)
  assert.ok(document.body.textContent.includes('Chat history deleted'))
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  const picks = []
  let creations = 0
  let pickerLookups = 0
  const scratchLabel = 'Outside a workspace (temp folder)…'
  const rowLabels = () => [...document.querySelectorAll('[role=menuitem]')].map(node => node.textContent)
  async function picker(key, items, scratchId, selectedId, failure) {
    const props = {
      key, open: true, anchorRef: { current: anchor }, selectedId,
      onPick: id => picks.push(id), onClose() {},
      useWorkspaces: select => select({ phase: 'ready', items }),
      createWorkspace: async () => { throw new Error('normal adoption was not requested') },
      pickDirectory: async () => null,
      findScratchWorkspace: async () => { pickerLookups++; if (failure) throw failure; return scratchId },
      startScratchSession: async () => { creations++; return { workspaceId: 'new-scratch' } },
    }
    await act(async () => root.render(React.createElement(plugin.ScratchWorkspacePicker, props)))
  }
  await picker('existing', [{ workspaceId: 'scratch-existing', title: '不在工作区' }], 'scratch-existing', 'scratch-existing')
  assert.deepEqual(rowLabels(), ['不在工作区', 'Add workspace…'], 'one existing workspace, no duplicate shortcut')
  assert.equal(creations, 0, 'opening the picker is read-only')
  await act(async () => button('不在工作区').click())
  assert.equal(picks.at(-1), 'scratch-existing', 'selection uses the existing identity')
  await picker('renamed', [{ workspaceId: 'scratch-existing', title: '我的临时目录' }], 'scratch-existing')
  assert.deepEqual(rowLabels(), ['我的临时目录', 'Add workspace…'], 'a renamed scratch workspace still suppresses the duplicate')
  await picker('same-title', [{ workspaceId: 'ordinary', title: '不在工作区' }], null)
  assert.deepEqual(rowLabels(), ['不在工作区', 'Add workspace…', scratchLabel], 'a same-named unrelated workspace must not hide scratch creation')
  await picker('first-use', [], null)
  assert.deepEqual(rowLabels(), ['Add workspace…', scratchLabel])
  assert.equal(creations, 0)
  await act(async () => button(scratchLabel).click())
  assert.equal(creations, 1)
  assert.equal(picks.at(-1), 'new-scratch')
  await picker('lookup-error', [{ workspaceId: 'ordinary', title: 'Real project' }], null, undefined, new Error('Scratch lookup unavailable'))
  assert.ok(document.querySelector('[role=dialog]').textContent.includes('Scratch lookup unavailable'))
  await act(async () => button('Cancel').click())
  await act(async () => button('Real project').click())
  assert.equal(picks.at(-1), 'ordinary', 'a failed optional lookup leaves ordinary workspace selection usable')
  assert.equal(pickerLookups, 5, 'rendering lookup results must not loop or create additional requests')
  anchor.remove()
  const result = { status: 'passed', realReactAndPrimitives: true, builtPlugin: true, copiedSelectedRow: true,
    confirmationBeforeSend: true, cancelDoesNotDelete: true, pendingBlocksRepeat: true, feedbackAfterMenuClose: true,
    scratchPickerSingleEntry: true, scratchIdentitySurvivesRename: true, sameTitleProjectPreserved: true,
    pickerOpenDoesNotCreate: true, firstScratchClickCreatesOnce: true, lookupFailureKeepsOrdinarySelection: true,
    nativeElectronClicks: false, clipboardMock: true, cssLayoutVerified: false }
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (root) await act(async () => root.unmount())
  for (const dispose of cleanup.reverse()) await dispose()
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
  dom.window.close()
  await rm(temporary, { recursive: true, force: true })
}
