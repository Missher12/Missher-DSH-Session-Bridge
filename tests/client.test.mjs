import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client/index.js', import.meta.url), 'utf8')
let client
let request
runInNewContext(source, { fetch: (...args) => request(...args), window: { __ModuleLoader__: { load({ factory }) {
  client = factory(id => {
    if (['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'].includes(id)) return {}
    throw new Error(`Unapproved runtime import: ${id}`)
  })
} } } })


/* The chip/panel behaviour lives in tests/chip-panel.test.mjs, which drives the
   real React renderer and jsdom; this file stays dependency-free. */

it('adopts the canonical workspace in the client store before navigation, without any disposable session', async () => {
  const calls = []
  request = async (path, options) => {
    calls.push([path, JSON.parse(options.body).title])
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.method, 'POST')
    return Response.json({ ok: true, value: { workspaceId: 'workspace-one', path: '/private/tmp/dsh-scratch', title: '不在工作区' } })
  }
  const ctx = {
    workspaces: { async create({ path }) { calls.push(['adopt', path]); return { workspaceId: 'workspace-one' } } },
    uiWorkspace: { pickDirectory: async () => null },
  }
  const injected = client.scratchPickerInjected(ctx)
  assert.deepEqual(await injected.startScratchSession('不在工作区'), { workspaceId: 'workspace-one' })
  assert.deepEqual(calls, [
    ['api/session-bridge/ensure-workspace', '不在工作区'], ['adopt', '/private/tmp/dsh-scratch'],
  ])
  assert.equal(await injected.pickDirectory(), null)
  const controller = new AbortController()
  request = async (path, options) => {
    assert.equal(path, 'api/session-bridge/ensure-workspace')
    assert.equal(options.method, undefined)
    assert.equal(options.signal, controller.signal)
    assert.equal(options.cache, 'no-store')
    return Response.json({ ok: true, value: { workspaceId: 'workspace-one', path: '/private/tmp/dsh-scratch', title: 'Renamed scratch' } })
  }
  assert.equal(await injected.findScratchWorkspace(controller.signal), 'workspace-one')
  request = async () => Response.json({ ok: true, value: null })
  assert.equal(await injected.findScratchWorkspace(controller.signal), null)
  assert.equal(calls.length, 2, 'lookup never adopts or creates a workspace')
})

it('keeps Host failures visible and never proceeds to workspace navigation', async () => {
  request = async () => Response.json({ ok: false, error: { message: 'directory denied' } })
  const ctx = {
    workspaces: { create() { assert.fail('failed request must not be adopted') } },
    uiWorkspace: {},
  }
  await assert.rejects(client.scratchPickerInjected(ctx).startScratchSession('Scratch'), /directory denied/)
})

it('uses the client store return type directly for normal directory adoption', async () => {
  const view = { workspaceId: 'ordinary', title: 'Project', path: '/project' }
  const ctx = { workspaces: { create: async () => view }, uiWorkspace: {} }
  assert.equal(await client.scratchPickerInjected(ctx).createWorkspace({ path: '/project' }), view)
})

it('copies the chosen sidebar row ID, cwd and bridge reference without opening that session', async () => {
  const copied = []
  const actions = client.createSessionCopyActions({ list: { getSnapshot: () => ({ byId: {
    archived: { cwd: '/projects/archived' }, current: { cwd: '/projects/current' },
  } }) } }, async value => { copied.push(value); return 'copied' })
  for (const kind of ['id', 'cwd', 'bridge']) await actions.copy(kind, 'archived')
  assert.deepEqual(copied, ['archived', '/projects/archived', '/bridge archived '])
  assert.equal(actions.getSnapshot().success, true)
  actions.dismiss()
  assert.equal(actions.getSnapshot(), null)
  actions.dispose()
})

it('keeps identity actions in the sidebar without a header control or identity overlay', () => {
  const registrations = []
  client.apply({
    effect() {},
    locale: { register: () => () => {} },
    uiWorkspace: {},
    sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    workspaces: { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }), subscribe: () => () => {} } },
    slots: {
      inject(_name, register) { register() },
      register(options, component) { registrations.push({ ...options, component }); return () => {} },
    },
  })
  assert.equal(registrations.filter(entry => entry.name === 'conversation.session.header.actions').length, 0)
  assert.equal(registrations.filter(entry => entry.id === 'session-bridge-identity-panel').length, 0)
  const copies = registrations.filter(entry => entry.name === 'sidebar.workspaces.session.menu.item'
    && entry.id.startsWith('dsh-session-bridge.copy-'))
  assert.deepEqual(copies.map(entry => entry.id), [
    'dsh-session-bridge.copy-id', 'dsh-session-bridge.copy-cwd', 'dsh-session-bridge.copy-bridge',
  ])
  for (const entry of copies) {
    assert.equal(typeof entry.component, 'function')
    assert.equal(typeof entry.inject().copyReference, 'function')
  }
  assert.equal(registrations.filter(entry => entry.id === 'session-bridge-picker').length, 1)
  assert.equal(registrations.filter(entry => entry.id === 'dsh-session-bridge.copy-notice').length, 1)
  assert.equal(registrations.filter(entry => entry.id === 'dsh-session-bridge.delete-dialog').length, 1)
  assert.equal(registrations.filter(entry => entry.id === 'dsh-session-bridge.move').length, 0)
  assert.equal(registrations.filter(entry => entry.id === 'dsh-session-bridge.move-dialog').length, 0)
  assert.equal(registrations.filter(entry => entry.id === 'dsh-session-bridge.move-toast').length, 1)
})

it('reports a missing cwd or clipboard rejection without inventing a directory', async () => {
  const copied = []
  const actions = client.createSessionCopyActions({ list: { getSnapshot: () => ({ byId: {} }) } },
    async value => { copied.push(value); throw new Error('clipboard denied') })
  await actions.copy('cwd', 'cold')
  assert.equal(actions.getSnapshot().key, 'menu.cwdUnavailable')
  assert.deepEqual(copied, [])
  await actions.copy('id', 'cold')
  assert.deepEqual(copied, ['cold'])
  assert.equal(actions.getSnapshot().key, 'chip.failed')
  actions.dispose()
})

it('suppresses late copy feedback after the plugin is unloaded', async () => {
  let complete
  let notifications = 0
  const actions = client.createSessionCopyActions({ list: { getSnapshot: () => ({ byId: {} }) } },
    () => new Promise(resolve => { complete = resolve }))
  actions.subscribe(() => { notifications++ })
  const pending = actions.copy('id', 'target')
  actions.dispose()
  complete('copied')
  await pending
  assert.equal(notifications, 0)
  assert.equal(actions.getSnapshot(), null)
})

it('owns its stylesheet before insertion and disposes only its own generation', () => {
  const sheets = []
  const document = {
    getElementById: id => sheets.find(sheet => sheet.id === id) ?? null,
    createElement(tag) {
      assert.equal(tag, 'style')
      return { dataset: {}, remove() {
        const index = sheets.indexOf(this)
        if (index !== -1) sheets.splice(index, 1)
      } }
    },
    head: { appendChild(sheet) {
      if (sheet.id === 'dsh-session-bridge-styles') {
        assert.equal(sheet.dataset.plugin, '@missher/dsh-session-bridge')
        assert.equal(sheet.dataset.pluginCss, sheet.id)
      }
      sheets.push(sheet)
    } },
  }
  const peer = document.createElement('style')
  peer.id = 'unrelated-styles'
  peer.dataset.plugin = 'unrelated-plugin'
  document.head.appendChild(peer)
  let exports
  runInNewContext(source, { document, fetch, window: { __ModuleLoader__: { load({ factory }) {
    exports = factory(() => ({}))
  } } } })
  const mount = () => {
    const disposers = []
    exports.apply({
      effect(start) { disposers.push(start()) },
      locale: { register: () => () => {} },
      uiWorkspace: {},
      slots: { inject() {} },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
      workspaces: { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }), subscribe: () => () => {} } },
    })
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }
  const disposeFirst = mount()
  const first = document.getElementById('dsh-session-bridge-styles')
  const disposeSecond = mount()
  const second = document.getElementById('dsh-session-bridge-styles')
  assert.notEqual(first, second)
  disposeFirst()
  assert.deepEqual(sheets, [peer, second], 'old cleanup must not remove the new sheet or another plugin')
  disposeSecond()
  assert.deepEqual(sheets, [peer])
})


it('requests confirmation for any session; cancel never sends a deletion', async () => {
  let requests = 0
  const actions = client.createSessionDeleteActions(async () => {
    requests++
    return Response.json({ ok: true, value: { sessionId: 'ordinary' } })
  })
  actions.request('ordinary')
  assert.equal(actions.getSnapshot().sessionId, 'ordinary')
  assert.equal(requests, 0)
  actions.dismiss()
  assert.equal(actions.getSnapshot(), null)
  await actions.confirm()
  assert.equal(requests, 0)
})

it('sends the exact confirmed identity once and leaves a busy dialog open until settled', async () => {
  let finish
  let requests = 0
  const actions = client.createSessionDeleteActions(async (path, options) => {
    requests++
    assert.equal(path, 'api/session-bridge/delete-session')
    assert.deepEqual(JSON.parse(options.body), { sessionId: 'ordinary', confirmed: true })
    assert.equal(options.credentials, 'same-origin')
    return await new Promise(resolve => { finish = resolve })
  })
  actions.request('ordinary')
  const pending = actions.confirm()
  await actions.confirm()
  actions.dismiss()
  assert.equal(actions.getSnapshot().pending, true)
  assert.equal(requests, 1)
  finish(Response.json({ ok: true, value: { sessionId: 'ordinary' } }))
  await pending
  assert.equal(actions.getSnapshot().done, true)
})

it('keeps Host failures explicit and suppresses late feedback after unload', async () => {
  let response = Response.json({ ok: false, error: { code: 'session/delete-unsupported' } }, { status: 501 })
  const actions = client.createSessionDeleteActions(async () => response)
  actions.request('ordinary')
  await actions.confirm()
  assert.equal(actions.getSnapshot().error, 'delete.unsupported')
  actions.dismiss()
  actions.request('ordinary')
  response = Response.json({ ok: false, error: { code: 'session/delete-owned' } }, { status: 409 })
  await actions.confirm()
  assert.equal(actions.getSnapshot().error, 'delete.busy')
  actions.dismiss()
  actions.request('ordinary')
  response = Response.json({ ok: true, value: { sessionId: 'ordinary' } })
  const pending = actions.confirm()
  actions.dispose()
  await pending
  assert.equal(actions.getSnapshot(), null)
})

it('turns the archived-only Host refusal into an explicit message', async () => {
  const actions = client.createSessionDeleteActions(async () =>
    Response.json({ ok: false, error: { code: 'session/delete-not-archived' } }, { status: 409 }))
  actions.request('ordinary')
  await actions.confirm()
  assert.equal(actions.getSnapshot().error, 'delete.notArchived')
})

it('distinguishes unsupported deletion from a failed or malformed capability check', async () => {
  const signal = new AbortController().signal
  for (const [body, status, expected] of [
    [{ supported: true }, 200, 'supported'], [{ supported: false }, 200, 'unsupported'],
    [{ supported: 'true' }, 200, 'error'], [{}, 200, 'error'], [null, 200, 'error'],
    [{ supported: true }, 403, 'error'], [{ supported: false }, 500, 'error'],
  ]) {
    const result = await client.readSessionDeleteCapability(signal, async (path, options) => {
      assert.equal(path, 'api/session-bridge/delete-session')
      assert.equal(options.method, undefined, 'a capability probe cannot delete')
      assert.equal(options.signal, signal)
      assert.equal(options.cache, 'no-store')
      return Response.json(body, { status })
    })
    assert.equal(result, expected)
  }
  assert.equal(await client.readSessionDeleteCapability(signal, async () => new Response('Unavailable', { status: 501 })), 'unsupported')
  await assert.rejects(client.readSessionDeleteCapability(signal, async () => new Response('not JSON')))
  await assert.rejects(client.readSessionDeleteCapability(signal, async () => { throw new Error('network unavailable') }))
})

it('reports text-only POST 501 and blocks repeated confirmation until the dialog is reopened', async () => {
  let sends = 0
  const actions = client.createSessionDeleteActions(async () => {
    sends++
    return new Response('Unsupported', { status: 501 })
  })
  actions.request('ordinary')
  await actions.confirm()
  await actions.confirm()
  assert.equal(sends, 1)
  assert.equal(actions.getSnapshot().error, 'delete.unsupported')
  actions.dismiss()
  assert.equal(actions.getSnapshot(), null)
})

it('refreshes Session summaries after a confirmed deletion', async () => {
  let refreshed = 0
  const actions = client.createSessionDeleteActions(
    async () => Response.json({ ok: true, value: { sessionId: 'ordinary' } }),
    () => { refreshed += 1 },
  )
  actions.request('ordinary')
  await actions.confirm()
  assert.equal(refreshed, 1)
})

it('sends only when a drag target calls moveTo and refreshes after success', async () => {
  let requests = 0
  let refreshed = 0
  const actions = client.createSessionMoveActions(async (path, options) => {
    requests += 1
    assert.equal(path, 'api/session-bridge/move-session')
    assert.deepEqual(JSON.parse(options.body), { sessionId: 'ordinary', targetWorkspaceId: 'workspace-two', confirmed: true })
    assert.equal(options.credentials, 'same-origin')
    return Response.json({ ok: true, value: { sessionId: 'ordinary', targetWorkspaceId: 'workspace-two' } })
  }, () => { refreshed += 1 })
  assert.equal(actions.getSnapshot(), null)
  await actions.moveTo('ordinary', 'workspace-two')
  assert.equal(requests, 1)
  assert.equal(actions.getSnapshot().phase, 'done')
  assert.equal(refreshed, 1)
})
it('shows the Host refusal reason and permits a later drag retry', async () => {
  let response = Response.json({ ok: false, error: { code: 'session/move-active' } }, { status: 409 })
  let refreshed = 0
  const actions = client.createSessionMoveActions(async () => response, () => { refreshed += 1 })
  await actions.moveTo('ordinary', 'workspace-two')
  assert.equal(actions.getSnapshot().phase, 'error')
  assert.equal(actions.getSnapshot().error, 'move.active')
  assert.equal(refreshed, 0)
  response = Response.json({ ok: true, value: { sessionId: 'ordinary', targetWorkspaceId: 'workspace-two' } })
  await actions.moveTo('ordinary', 'workspace-two')
  assert.equal(actions.getSnapshot().phase, 'done')
  assert.equal(refreshed, 1)
})

it('aggregates native pending/running/completion facts without double-counting children', () => {
  const statuses = new Map([
    ['waiting', { pendingInteraction: { kind: 'approval' }, running: true }],
    ['running', { running: true }],
    ['completed', { completionUnread: true, running: false }],
    ['failed', { completionUnread: true, running: false }],
    ['parent-waiting', { pendingInteraction: { kind: 'question' }, running: false }],
    ['child-running', { running: true }],
    ['stale', { running: false }],
    ['not-a-wait', { pendingInteraction: { kind: 'other' }, running: false }],
    ['parent-child-wait', { pendingInteraction: { kind: 'approval' }, running: false }],
    ['child-waiting', { pendingInteraction: { kind: 'question' }, running: true }],
  ])
  const list = {
    phase: 'ready',
    byId: {
      waiting: { running: true }, running: { running: true }, completed: { running: false },
      failed: { running: false }, 'parent-waiting': { running: false }, 'child-running': { running: true },
      stale: { running: true }, 'not-a-wait': { running: false },
      'parent-child-wait': { running: false }, 'child-waiting': { running: true },
    },
    ids: ['waiting', 'running', 'completed', 'failed', 'parent-waiting', 'child-running', 'stale', 'not-a-wait'],
    projectionsBySession: {
      'parent-waiting': { values: { subagentCatalog: [{ id: 'child-running' }] } },
      'parent-child-wait': { values: { subagentCatalog: [{ id: 'child-waiting' }] } },
    },
  }
  const plain = value => ({ ...value })
  assert.deepEqual(
    plain(client.aggregateWorkspaceStatus(
      ['waiting', 'running', 'completed', 'failed'], statuses, list, new Set(['completed']),
    )),
    { pending: 1, running: 1, completed: 1 },
    'mixed states keep each real count; only the validated success is green',
  )
  assert.deepEqual(
    plain(client.aggregateWorkspaceStatus(['waiting'], statuses, list)),
    { pending: 1, running: 0, completed: 0 },
    'a waiting session that still reports running is not also counted as working for itself',
  )
  assert.deepEqual(
    plain(client.aggregateWorkspaceStatus(['parent-waiting'], statuses, list)),
    { pending: 1, running: 1, completed: 0 },
    'a waiting parent with a running child keeps the working count',
  )
  assert.deepEqual(
    plain(client.aggregateWorkspaceStatus(['parent-child-wait'], statuses, list)),
    { pending: 1, running: 0, completed: 0 },
    'a waiting child is not counted as running work',
  )
  assert.deepEqual(
    plain(client.aggregateWorkspaceStatus(['parent-waiting', 'child-running'], statuses, list)),
    { pending: 1, running: 1, completed: 0 },
    'a child that is also a member is folded into its parent once',
  )
  assert.deepEqual(
    plain(client.aggregateWorkspaceStatus(['stale', 'not-a-wait'], statuses, list)),
    { pending: 0, running: 0, completed: 0 },
    'stale true summary does not override a false status; unknown interaction kinds are not waits',
  )
  assert.deepEqual(
    plain(client.aggregateWorkspaceStatus(['completed'], statuses, { ...list, phase: 'pending' })),
    { unknown: true, pending: 0, running: 0, completed: 0 },
    'unsynchronized list is unknown, not idle or zero',
  )
  assert.deepEqual(
    plain(client.aggregateWorkspaceStatus(['completed'], statuses, list, new Set(), false)),
    { unknown: true, pending: 0, running: 0, completed: 0 },
    'missing connection generation is unknown',
  )
  assert.deepEqual(
    plain(client.aggregateWorkspaceStatus(['missing'], statuses, list)),
    { unknown: true, pending: 0, running: 0, completed: 0 },
    'a workspace member absent from the synchronized list is unknown',
  )
})

it('treats only completed turn/end as successful; cancel/error/interrupted are not green', () => {
  const record = reason => [{ event: { type: 'turn/end', data: { reason: { kind: reason } } } }]
  assert.equal(client.completionSucceeded(record('completed')), true)
  for (const reason of ['aborted', 'error', 'blocked', 'interrupted', 'forked', 'max-tokens']) {
    assert.equal(client.completionSucceeded(record(reason)), false, reason)
  }
  assert.equal(client.completionSucceeded([]), false, 'no completed turn is not success')
})
