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
  let moveSends = 0
  let finish
  let finishMove
  let refreshes = 0
  let probe = async () => Response.json({ supported: true })
  const registrations = new Map()
  const sessionsRow = { archived: { cwd: '/synthetic/workspace', running: false }, 'drag-me': { cwd: '/private/tmp/dsh-scratch', running: false }, 'pending-wait': { running: false }, 'running-other': { running: true }, 'completed-other': { running: false }, rejected: { running: false } }
  let statusSnapshot = new Map()
  const sessionsSnapshot = { byId: sessionsRow, ids: Object.keys(sessionsRow), phase: 'ready', projectionsBySession: {} }
  const statusListeners = new Set()
  let generation = 'generation-1'
  const generationListeners = new Set()
  let finishValidation
  const workspacesList = {
    getSnapshot() {
      return {
        items: [
          { workspaceId: 'workspace-source', title: 'Outside a workspace', path: '/private/tmp/dsh-scratch', sessionIds: ['archived', 'drag-me', 'pending-wait', 'running-other', 'completed-other', 'rejected'] },
          { workspaceId: 'workspace-target', title: 'Crodis', path: '/Users/missher/Documents/Deepseek-File/Crodis', sessionIds: [] },
        ],
        archivedSessionIds: ['archived'],
      }
    },
    subscribe() { assert.equal(this, workspacesList, 'subscribe keeps the Host store receiver'); return () => {} },
  }
  dom.window.__ModuleLoader__ = { load({ factory }) {
      plugin = factory(id => {
        if (id === 'react') return React
        if (id === 'react/jsx-runtime') return requireUi(id)
        if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
        throw new Error('Unexpected import ' + id)
      })
    } }
  const sandbox = {
    window: dom.window, document, navigator, console, setTimeout, clearTimeout, AbortController,
    Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    // JSDOM has no layout/ResizeObserver. As in the dedicated chip tests, this
    // observer is inert: this script tests text/copy, never resizing or pixels.
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    fetch: async (path, options) => {
      if (path === 'api/session-bridge/delete-session') {
        if (options.method !== 'POST') return await probe(options)
        sends++
        assert.deepEqual(JSON.parse(options.body), { sessionId: 'archived', confirmed: true })
        return await new Promise(resolve => { finish = resolve })
      }
      if (path === 'api/session-bridge/move-session') {
        moveSends++
        assert.deepEqual(JSON.parse(options.body), { sessionId: 'drag-me', targetWorkspaceId: 'workspace-target', confirmed: true })
        return await new Promise(resolve => { finishMove = resolve })
      }
      throw new Error('Unexpected route ' + path)
    },
  }
  vm.runInNewContext(await readFile(new URL('../lib/client/index.js', import.meta.url), 'utf8'), sandbox)
  plugin.apply({
    effect(start) { const dispose = start(); if (typeof dispose === 'function') cleanup.push(dispose) },
    locale: { register: () => () => {} },
    uiWorkspace: {}, workspaces: { list: workspacesList },
    sessions: { refresh: () => { refreshes++ }, list: { getSnapshot: () => sessionsSnapshot, subscribe: () => () => {} } },
    uiSession: { sessionStatus: { getSnapshot: () => statusSnapshot, subscribe: listener => { statusListeners.add(listener); return () => { statusListeners.delete(listener) } } } },
    connection: { generation: { getSnapshot: () => generation, subscribe: listener => { generationListeners.add(listener); return () => { generationListeners.delete(listener) } } } },
    remote: { session: { events: () => new Promise(resolve => { finishValidation = resolve }) } },
    slots: { inject(_slot, register) { register() }, register(options, component) {
      registrations.set(options.id, { options, component }); return () => {}
    } },
  })
  let reopen
  let closeMenu
  function View() {
    const [open, setOpen] = React.useState(true)
    reopen = () => setOpen(true)
    closeMenu = () => setOpen(false)
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
  assert.equal(refreshes, 1, 'a committed deletion refreshes the Session summaries')
  const sentBeforeProbes = sends
  for (const [response, reason] of [
    [Response.json({ supported: false }), 'This Host cannot safely delete chat history'],
    [new Response('Unsupported', { status: 501 }), 'This Host cannot safely delete chat history'],
    [new Response('Unavailable', { status: 503 }), 'Could not check this Host'],
    [Response.json({ supported: 'true' }), 'Could not check this Host'],
    [new Response('invalid JSON'), 'Could not check this Host'],
  ]) {
    probe = async () => response
    await act(async () => reopen())
    assert.equal(button('Delete session…').disabled, true)
    assert.ok(document.querySelector('[role=note]').textContent.includes(reason))
    await act(async () => button('Delete session…').click())
    assert.equal(document.querySelector('[role=dialog]'), null)
    assert.equal(sends, sentBeforeProbes, 'unavailable capability cannot submit deletion')
    await act(async () => closeMenu())
  }
  let lateProbe
  let oldSignal
  probe = options => { oldSignal = options.signal; return new Promise(resolve => { lateProbe = resolve }) }
  await act(async () => reopen())
  assert.equal(button('Delete session…').disabled, true)
  assert.ok(document.querySelector('[role=note]').textContent.includes('Checking this Host'))
  await act(async () => closeMenu())
  assert.equal(oldSignal.aborted, true, 'closing the menu aborts the old probe')
  probe = async () => Response.json({ supported: false })
  await act(async () => reopen())
  await act(async () => lateProbe(Response.json({ supported: true })))
  assert.equal(button('Delete session…').disabled, true, 'late success cannot override a newer unsupported result')
  await act(async () => closeMenu())
  probe = async () => Response.json({ supported: true })
  await act(async () => reopen())
  assert.equal(button('Delete session…').disabled, false, 'reopening checks capability again')
  await act(async () => button('Delete session…').click())
  await act(async () => button('Delete permanently').click())
  await act(async () => finish(new Response('Unsupported', { status: 501 })))
  const deleteDialog = document.querySelector('[role=dialog]')
  console.log(JSON.stringify({ phase: 'post501', alerts: [...document.querySelectorAll('[role=alert]')].slice(0, 8)
    .map(node => ({ inDeleteDialog: deleteDialog?.contains(node) ?? false, text: node.textContent.slice(0, 512) })) }))
  assert.ok(deleteDialog, 'POST 501 must leave the deletion dialog open')
  assert.ok(deleteDialog.querySelector('[role=alert]').textContent.includes('This Host cannot safely delete chat history'))
  assert.equal(button('Delete permanently').disabled, true)
  await act(async () => button('Delete permanently').click())
  assert.equal(sends, sentBeforeProbes + 1, '501 blocks repeat confirmation')
  await act(async () => button('Cancel').click())
  assert.equal(document.querySelector('[role=dialog]'), null)
  const dragSource = document.createElement('div')
  dragSource.dataset.rowKey = 'session:drag-me'
  const sourceWorkspace = document.createElement('div')
  sourceWorkspace.dataset.rowKey = 'workspace:workspace-source'
  const targetWorkspace = document.createElement('div')
  targetWorkspace.dataset.rowKey = 'workspace:workspace-target'
  document.body.append(dragSource, sourceWorkspace, targetWorkspace)
  const fireDrag = (element, type) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { dropEffect: 'none' } })
    element.dispatchEvent(event)
    return event
  }
  await act(async () => {
    fireDrag(dragSource, 'dragstart')
    const over = fireDrag(targetWorkspace, 'dragover')
    assert.equal(over.defaultPrevented, true, 'a different Workspace header accepts the drop')
    fireDrag(targetWorkspace, 'drop')
  })
  assert.equal(moveSends, 1, 'dropping a session on another Workspace sends one move')
  assert.ok(document.body.textContent.includes('Moving…'))
  await act(async () => {
    finishMove(Response.json({ ok: true, value: { sessionId: 'drag-me', targetWorkspaceId: 'workspace-target' } }))
    await Promise.resolve()
  })
  assert.ok(document.body.textContent.includes('Session moved'))
  assert.equal(refreshes, 2, 'a committed drag move refreshes the Session summaries')
  await act(async () => {
    fireDrag(dragSource, 'dragstart')
    const same = fireDrag(sourceWorkspace, 'dragover')
    assert.equal(same.defaultPrevented, false, 'same-Workspace drag keeps the native reorder path')
    fireDrag(sourceWorkspace, 'drop')
  })
  assert.equal(moveSends, 1, 'same-Workspace drop has no side effect')
  await act(async () => {
    fireDrag(dragSource, 'dragstart')
    fireDrag(targetWorkspace, 'drop')
  })
  assert.equal(moveSends, 2)
  await act(async () => {
    finishMove(Response.json({ ok: false, error: { code: 'session/move-active' } }, { status: 409 }))
    await Promise.resolve()
  })
  assert.ok(document.body.textContent.includes('still has active work'))
  const notifyStatus = () => { for (const listener of statusListeners) listener() }
  await act(async () => {
    statusSnapshot = new Map([
      ['drag-me', { completionUnread: true, running: false }],
      ['archived', { running: false }],
      ['pending-wait', { running: false }],
      ['running-other', { running: false }],
      ['completed-other', { running: false }],
    ])
    notifyStatus()
    await Promise.resolve()
  })
  assert.ok(finishValidation, 'completion validation starts with a controlled request')
  await act(async () => {
    statusSnapshot = new Map([
      ['drag-me', { completionUnread: true, running: false }],
      ['archived', { running: false }],
      ['pending-wait', { running: false }],
      ['running-other', { running: false }],
      ['completed-other', { running: false }],
      ['other', { running: true }],
    ])
    notifyStatus()
    await Promise.resolve()
  })
  assert.equal(document.body.textContent.includes('已完成'), false, 'other-session update must not cancel the pending validation')
  await act(async () => {
    finishValidation({ ok: true, value: { records: [{ event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } }] } })
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.ok([...document.querySelectorAll('.dsh-sb-ws-status')].some(node => node.textContent.includes('已完成')),
    'the original candidate still turns green after another session updates')
  await act(async () => {
    statusSnapshot = new Map([
      ['archived', { running: false }],
      ['drag-me', { running: false }],
      ['pending-wait', { pendingInteraction: { kind: 'approval' }, running: false }],
      ['running-other', { running: true }],
      ['completed-other', { completionUnread: true, running: false }],
    ])
    notifyStatus()
    await Promise.resolve()
  })
  const sourceBadge = document.querySelector('[data-row-key="workspace:workspace-source"] .dsh-sb-ws-status')
  assert.ok(sourceBadge?.textContent.includes('等你处理 · 1'), 'pending count is shown')
  assert.ok(sourceBadge?.textContent.includes('工作中 · 1'), 'running count remains visible alongside pending')
  assert.equal(sourceBadge?.textContent.includes('已完成'), false, 'green completion is suppressed while pending/running exist')
  await act(async () => {
    statusSnapshot = new Map([
      ['archived', { running: false }],
      ['drag-me', { running: false }],
      ['pending-wait', { running: false }],
      ['running-other', { running: false }],
      ['completed-other', { running: false }],
      ['rejected', { completionUnread: true, running: false }],
      ['other', { running: true }],
    ])
    notifyStatus()
    await Promise.resolve()
  })
  assert.ok(finishValidation, 'the rejected result starts validation')
  await act(async () => {
    finishValidation({ ok: false, error: { code: 'session/events' } })
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(document.querySelector('[data-row-key="workspace:workspace-source"] .dsh-sb-ws-status')?.textContent.includes('已完成'), false,
    'a failed Remote Result must not turn green')
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
  assert.deepEqual(rowLabels(), ['Add workspace…', '不在工作区'], 'existing identity is the last choice, without a duplicate')
  assert.equal(button('Add workspace…').closest('[role=presentation]'), button('不在工作区').closest('[role=presentation]'), 'scratch scrolls in the same menu list')
  assert.equal(button('不在工作区').closest('[role=menu]').querySelectorAll('[role=presentation]').length, 1, 'there is no separate footer')
  assert.equal(creations, 0, 'opening the picker is read-only')
  await act(async () => button('不在工作区').click())
  assert.equal(picks.at(-1), 'scratch-existing', 'selection uses the existing identity')
  await picker('renamed', [{ workspaceId: 'scratch-existing', title: '我的临时目录' }], 'scratch-existing')
  assert.deepEqual(rowLabels(), ['Add workspace…', '我的临时目录'], 'renaming preserves the fixed last choice')
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
  const fullSessionId = 'session-12345678-1234-5678-90ab-1234567890ab'
  await act(async () => root.render(React.createElement(plugin.SessionIdChip, {
    sessionId: fullSessionId,
    useSessions: select => select({ byId: { [fullSessionId]: { cwd: '/synthetic/workspace' } } }),
  })))
  assert.equal(document.querySelector('.dsh-sbc-chipId').textContent, fullSessionId, 'visible ID includes every character and the prefix')
  await act(async () => document.querySelector('.dsh-sbc-chip').click())
  assert.equal(copied.at(-1), fullSessionId, 'copy matches the full visible identity')
  const result = { status: 'passed', realReactAndPrimitives: true, builtPlugin: true, copiedSelectedRow: true,
    fullSessionIdVisible: true, fullSessionIdCopied: true, archiveReceiverPreserved: true,
    confirmationBeforeSend: true, cancelDoesNotDelete: true, pendingBlocksRepeat: true, feedbackAfterMenuClose: true,
    unsupportedVisibleAndDisabled: true, failedProbeDistinct: true, staleProbeIgnored: true,
    reopenChecksCapability: true, text501VisibleAndBlocksRepeat: true,
    scratchPickerSingleEntry: true, scratchIdentitySurvivesRename: true, sameTitleProjectPreserved: true,
    pickerOpenDoesNotCreate: true, firstScratchClickCreatesOnce: true, lookupFailureKeepsOrdinarySelection: true,
    dragAcrossWorkspace: true, dragSameWorkspaceNoop: true, dragRefusalShown: true,
    workspaceStatusRace: true, workspaceStatusPriority: true, workspaceStatusResult: true,
    nativeElectronClicks: false, clipboardMock: true, resizeObserverMock: true, cssLayoutVerified: false }
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
