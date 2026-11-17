import assert from 'node:assert/strict'
import { it } from 'node:test'
import { registerSessionDeleteRoute } from '../lib/session-delete-route.js'
import { deletionSessionId } from '../lib/session-delete-wire.js'

/** Mirrors the Host's SessionLifecycleError: stable code, natural-language message. */
class HostLifecycleError extends Error {
  constructor(code) {
    super(`host refusal for ${code}`)
    this.name = 'SessionLifecycleError'
    this.code = code
  }
}

it('requires explicit confirmation and never accepts a storage path', () => {
  assert.equal(deletionSessionId({ sessionId: 'session-one', confirmed: true }), 'session-one')
  for (const value of [null, {}, { sessionId: 'one' }, { sessionId: 'one', confirmed: false },
    { sessionId: '/private/tmp/log', confirmed: true }, { sessionId: 'one', confirmed: true, path: '/tmp' }]) {
    assert.throws(() => deletionSessionId(value))
  }
})

it('reports an unsupported Host without inventing a private deletion path', async () => {
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
  registerSessionDeleteRoute(ctx)
  const capability = () => route.fetch(new Request('http://localhost' + route.path)).then(response => response.json())
  assert.deepEqual(await capability(), { supported: false, reason: 'session/delete-unsupported' })
  const send = value => route.fetch(new Request('http://localhost' + route.path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  }))
  assert.equal((await send({ sessionId: 'one' })).status, 400)
  const unsupported = await send({ sessionId: 'one', confirmed: true })
  assert.equal(unsupported.status, 501)
  assert.equal((await unsupported.json()).error.code, 'session/delete-unsupported')
  controller.deleteArchivedSession = true
  assert.deepEqual(await capability(), { supported: false, reason: 'session/delete-unsupported' })
  assert.equal((await send({ sessionId: 'one', confirmed: true })).status, 501,
    'a non-callable property must not be advertised or attempted as a deletion API')
  const deleted = []
  controller.deleteArchivedSession = async id => { deleted.push(id) }
  assert.deepEqual(await capability(), { supported: true, backend: 'host-archived' })
  assert.deepEqual(deleted, [], 'capability lookup must never delete a session')
  assert.equal((await (await send({ sessionId: 'one', confirmed: true })).json()).ok, true)
  assert.deepEqual(deleted, ['one'])
  for (const code of ['session/delete-active', 'session/delete-owned', 'session/delete-has-children', 'session/delete-not-archived', 'session/delete-cleanup-pending']) {
    controller.deleteArchivedSession = async () => { throw new HostLifecycleError(code) }
    const response = await send({ sessionId: 'one', confirmed: true })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error.code, code, 'the Host code field must survive the route, not just its message')
  }
  controller.deleteArchivedSession = async () => { throw new Error('session/delete-busy') }
  assert.equal((await (await send({ sessionId: 'one', confirmed: true })).json()).error.code, 'session/delete-busy',
    'older Hosts that only embed the code in the message remain supported')
  controller.deleteArchivedSession = async () => { throw new HostLifecycleError('session/delete-not-found') }
  assert.equal((await send({ sessionId: 'one', confirmed: true })).status, 404)
  for (const cleanup of cleanups) await cleanup()
  assert.equal(unregistered, true)
  assert.equal((await send({ sessionId: 'one', confirmed: true })).status, 409)
})

it('prefers the full-Session deletion method over the archived-only one', async () => {
  let route
  const calls = []
  const controller = {
    deleteArchivedSession: async id => { calls.push(['archived', id]) },
    deleteSession: async id => { calls.push(['session', id]) },
  }
  const ctx = {
    inject(names, callback) { callback(this) },
    get: key => key === 'sessionController' ? controller : {
      fetch: { register(value) { route = value; return async () => {} } },
    },
    effect(start) { start() },
  }
  registerSessionDeleteRoute(ctx)
  const capability = await (await route.fetch(new Request('http://localhost' + route.path))).json()
  assert.deepEqual(capability, { supported: true, backend: 'host-session' })
  const response = await route.fetch(new Request('http://localhost' + route.path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-two', confirmed: true }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(calls, [['session', 'session-two']], 'the broader Host transaction must win')
})

it('prefers the reviewed companion over an advertised Host deletion method', async () => {
  let route
  let companion
  const calls = []
  const controller = {}
  const ctx = {
    inject(names, callback) { callback(this) },
    get: key => key === 'sessionController' ? controller : {
      fetch: { register(value) { route = value; return async () => {} } },
    },
    effect(start) { start() },
  }
  registerSessionDeleteRoute(ctx, () => companion)
  const capability = () => route.fetch(new Request('http://localhost' + route.path)).then(r => r.json())
  assert.equal((await capability()).supported, false)
  companion = { async deleteSession(id) { calls.push(['companion', id]) } }
  assert.deepEqual(await capability(), { supported: true, backend: 'bridge-jsonl' })
  const remove = () => route.fetch(new Request('http://localhost' + route.path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-one', confirmed: true }),
  }))
  assert.equal((await remove()).status, 200)
  controller.deleteSession = async id => { calls.push(['host', id]) }
  assert.equal((await capability()).backend, 'bridge-jsonl')
  assert.equal((await remove()).status, 200)
  assert.deepEqual(calls, [['companion', 'session-one'], ['companion', 'session-one']])
})

it('never falls back to the known unsafe lifecycle 0.1.0 while its companion is unavailable', async () => {
  let route, companion
  let unsafeCalls = 0
  const inLineage = (_id, operation) => operation()
  const lifecycle = { deleteSession: async () => { unsafeCalls++ } }
  // Exact installed 0.1.0 decorator; its closure swallows workspace failures.
  const deleteSession = (sessionId) => inLineage(sessionId, () => lifecycle.deleteSession(sessionId));
  const controller = { deleteSession }
  registerSessionDeleteRoute({
    inject(_names, callback) { callback(this) },
    get: key => key === 'sessionController' ? controller : {
      fetch: { register(value) { route = value; return () => {} } },
    },
    effect(start) { start() },
  }, () => companion)
  const remove = () => route.fetch(new Request('http://localhost' + route.path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-legacy', confirmed: true }),
  }))
  assert.equal((await (await route.fetch(new Request('http://localhost' + route.path))).json()).supported, false)
  assert.equal((await remove()).status, 501)
  companion = { async deleteSession() { throw new Error('session/delete-cleanup-pending') } }
  const response = await remove()
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'session/delete-cleanup-pending')
  companion = undefined
  assert.equal((await remove()).status, 501)
  assert.equal(unsafeCalls, 0)
})
