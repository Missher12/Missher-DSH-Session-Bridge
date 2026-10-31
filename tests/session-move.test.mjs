import assert from 'node:assert/strict'
import { it } from 'node:test'
import { registerSessionMoveRoute } from '../lib/session-move-route.js'
import { moveSessionRequest } from '../lib/session-move-wire.js'

/** Mirrors the Host's SessionLifecycleError: stable code, natural-language message. */
class HostLifecycleError extends Error {
  constructor(code) {
    super(`host refusal for ${code}`)
    this.name = 'SessionLifecycleError'
    this.code = code
  }
}

it('accepts exactly a confirmed Session and Workspace identity', () => {
  assert.deepEqual(moveSessionRequest({ sessionId: 'session-one', targetWorkspaceId: 'workspace-two', confirmed: true }),
    { sessionId: 'session-one', targetWorkspaceId: 'workspace-two' })
  for (const value of [
    null,
    {},
    { sessionId: 'one', targetWorkspaceId: 'two' },
    { sessionId: 'one', targetWorkspaceId: 'two', confirmed: false },
    { sessionId: '/private/tmp/log', targetWorkspaceId: 'two', confirmed: true },
    { sessionId: 'one', targetWorkspaceId: '../escape', confirmed: true },
    { sessionId: 'one', targetWorkspaceId: 'two', confirmed: true, path: '/tmp' },
  ]) {
    assert.throws(() => moveSessionRequest(value))
  }
})

it('reports an unsupported Host and never moves through a guessed path', async () => {
  let route
  const cleanups = []
  let unregistered = false
  const controller = {}
  const ctx = {
    inject(names, callback) { assert.deepEqual(names, ['connection', 'sessionController']); callback(this) },
    get: key => key === 'sessionController' ? controller : {
      fetch: { register(value) { route = value; return async () => { unregistered = true } } },
    },
    effect(start) { cleanups.push(start()) },
  }
  registerSessionMoveRoute(ctx)
  const capability = () => route.fetch(new Request('http://localhost' + route.path)).then(response => response.json())
  assert.deepEqual(await capability(), { supported: false, reason: 'session/move-unsupported' })
  const send = value => route.fetch(new Request('http://localhost' + route.path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  }))
  assert.equal((await send({ sessionId: 'one', targetWorkspaceId: 'two' })).status, 400)
  const unsupported = await send({ sessionId: 'one', targetWorkspaceId: 'two', confirmed: true })
  assert.equal(unsupported.status, 501)
  assert.equal((await unsupported.json()).error.code, 'session/move-unsupported')
  controller.moveSession = true
  assert.deepEqual(await capability(), { supported: false, reason: 'session/move-unsupported' })
  const moves = []
  controller.moveSession = async (sessionId, targetWorkspaceId) => { moves.push([sessionId, targetWorkspaceId]) }
  assert.deepEqual(await capability(), { supported: true, backend: 'host' })
  assert.deepEqual(moves, [], 'capability lookup must never move a session')
  const response = await send({ sessionId: 'one', targetWorkspaceId: 'two', confirmed: true })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, value: { sessionId: 'one', targetWorkspaceId: 'two' } })
  assert.deepEqual(moves, [['one', 'two']])
  for (const code of ['session/move-active', 'session/move-busy', 'session/move-same-workspace']) {
    controller.moveSession = async () => { throw new HostLifecycleError(code) }
    const refused = await send({ sessionId: 'one', targetWorkspaceId: 'two', confirmed: true })
    assert.equal(refused.status, 409)
    assert.equal((await refused.json()).error.code, code, 'the Host code field must survive the route, not just its message')
  }
  controller.moveSession = async () => { throw new Error('session/move-busy') }
  assert.equal((await (await send({ sessionId: 'one', targetWorkspaceId: 'two', confirmed: true })).json()).error.code, 'session/move-busy',
    'older Hosts that only embed the code in the message remain supported')
  for (const code of ['session/move-not-found', 'session/move-target-missing']) {
    controller.moveSession = async () => { throw new HostLifecycleError(code) }
    assert.equal((await send({ sessionId: 'one', targetWorkspaceId: 'two', confirmed: true })).status, 404)
  }
  for (const cleanup of cleanups) await cleanup()
  assert.equal(unregistered, true)
  assert.equal((await send({ sessionId: 'one', targetWorkspaceId: 'two', confirmed: true })).status, 409)
})
