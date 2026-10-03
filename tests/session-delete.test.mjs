import assert from 'node:assert/strict'
import { it } from 'node:test'
import { registerSessionDeleteRoute } from '../lib/session-delete-route.js'
import { deletionSessionId } from '../lib/session-delete-wire.js'

it('requires explicit confirmation and never accepts a storage path', () => {
  assert.equal(deletionSessionId({ sessionId: 'session-one', confirmed: true }), 'session-one')
  for (const value of [null, {}, { sessionId: 'one' }, { sessionId: 'one', confirmed: false },
    { sessionId: '/private/tmp/log', confirmed: true }, { sessionId: 'one', confirmed: true, path: '/tmp' }]) {
    assert.throws(() => deletionSessionId(value))
  }
})

it('routes through the Host owner and reports unsupported Hosts without touching private storage', async () => {
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
  assert.deepEqual(await capability(), { supported: false })
  const send = value => route.fetch(new Request('http://localhost' + route.path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  }))
  assert.equal((await send({ sessionId: 'one' })).status, 400)
  const unsupported = await send({ sessionId: 'one', confirmed: true })
  assert.equal(unsupported.status, 501)
  assert.equal((await unsupported.json()).error.code, 'session/delete-unsupported')
  const deleted = []
  controller.deleteArchivedSession = async id => { deleted.push(id) }
  assert.deepEqual(await capability(), { supported: true })
  assert.deepEqual(deleted, [], 'capability lookup must never delete a session')
  assert.equal((await (await send({ sessionId: 'one', confirmed: true })).json()).ok, true)
  assert.deepEqual(deleted, ['one'])
  controller.deleteArchivedSession = async () => { throw new Error('session/delete-active') }
  assert.equal((await (await send({ sessionId: 'one', confirmed: true })).json()).error.code, 'session/delete-active')
  for (const cleanup of cleanups) await cleanup()
  assert.equal(unregistered, true)
  assert.equal((await send({ sessionId: 'one', confirmed: true })).status, 409)
})
