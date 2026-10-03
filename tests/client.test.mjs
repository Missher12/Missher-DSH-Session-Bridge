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
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }), subscribe: () => () => {} } },
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


it('requests confirmation first; cancel and unarchived rows never send a deletion', async () => {
  let ids = ['archived']
  let requests = 0
  const actions = client.createSessionDeleteActions({ getSnapshot: () => ({ archivedSessionIds: ids }) }, async () => {
    requests++
    return Response.json({ ok: true, value: { sessionId: 'archived' } })
  })
  actions.request('live')
  assert.equal(actions.getSnapshot(), null)
  actions.request('archived')
  assert.equal(actions.getSnapshot().sessionId, 'archived')
  assert.equal(requests, 0)
  actions.dismiss()
  await actions.confirm()
  assert.equal(requests, 0)
  actions.request('archived')
  ids = []
  await actions.confirm()
  assert.equal(actions.getSnapshot().error, 'delete.notArchived')
  assert.equal(requests, 0)
})

it('sends the exact confirmed identity once and leaves a busy dialog open until settled', async () => {
  let finish
  let requests = 0
  const actions = client.createSessionDeleteActions({ getSnapshot: () => ({ archivedSessionIds: ['archived'] }) }, async (path, options) => {
    requests++
    assert.equal(path, 'api/session-bridge/delete-session')
    assert.deepEqual(JSON.parse(options.body), { sessionId: 'archived', confirmed: true })
    assert.equal(options.credentials, 'same-origin')
    return await new Promise(resolve => { finish = resolve })
  })
  actions.request('archived')
  const pending = actions.confirm()
  await actions.confirm()
  actions.dismiss()
  assert.equal(actions.getSnapshot().pending, true)
  assert.equal(requests, 1)
  finish(Response.json({ ok: true, value: { sessionId: 'archived' } }))
  await pending
  assert.equal(actions.getSnapshot().done, true)
})

it('keeps old-Host and busy failures explicit and suppresses late feedback after unload', async () => {
  let response = Response.json({ ok: false, error: { code: 'session/delete-unsupported' } }, { status: 501 })
  const actions = client.createSessionDeleteActions({ getSnapshot: () => ({ archivedSessionIds: ['archived'] }) }, async () => response)
  actions.request('archived')
  await actions.confirm()
  assert.equal(actions.getSnapshot().error, 'delete.unsupported')
  response = Response.json({ ok: false, error: { code: 'session/delete-owned' } }, { status: 409 })
  await actions.confirm()
  assert.equal(actions.getSnapshot().error, 'delete.busy')
  response = Response.json({ ok: true, value: { sessionId: 'archived' } })
  const pending = actions.confirm()
  actions.dispose()
  await pending
  assert.equal(actions.getSnapshot(), null)
})
