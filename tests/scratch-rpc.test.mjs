import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { ensureScratchWorkspace, findScratchWorkspace, registerScratchRoute } from '../lib/scratch-route.js'
import { service } from '../lib/dsh.js'
import { scratchTitle, scratchWorkspace } from '../lib/scratch-wire.js'

const signal = () => new AbortController().signal

it('optional service lookup never reads an uninjected property or hides a lookup failure', () => {
  const ctx = new Proxy({ get: () => undefined }, { get(target, key) {
    if (key === 'get') return target.get
    throw new Error('cannot get property without inject')
  } })
  assert.equal(service(ctx, 'commands'), undefined)
  assert.throws(() => service({ get() { throw new Error('lookup failed') } }, 'commands'), /lookup failed/)
})

it('creates one canonical titled workspace with no Session creation, including symlinked temp roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-rpc-'))
  try {
    const owned = join(root, 'owned')
    const alias = join(root, 'alias')
    await mkdir(owned)
    await symlink(owned, alias)
    const records = new Map()
    const registry = { async resolveByPath(path) { return records.get(path) }, async create(path, title) {
      assert.equal(path, await realpath(join(owned, 'dsh-scratch')))
      if (!records.has(path)) records.set(path, { id: 'workspace-shared', path, title })
      return records.get(path)
    } }
    assert.equal(await findScratchWorkspace(registry, alias, signal()), null)
    assert.equal(records.size, 0, 'opening the menu must not create a workspace')
    const first = await ensureScratchWorkspace(registry, alias, '不在工作区', signal())
    assert.deepEqual(await findScratchWorkspace(registry, alias, signal()), first)
    const second = await ensureScratchWorkspace(registry, alias, 'Another locale', signal())
    assert.equal(first.title, '不在工作区')
    assert.deepEqual(second, first)
    assert.equal(records.size, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('refuses a pre-existing scratch symlink and a cancelled request before registration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-rpc-refuse-'))
  try {
    const target = join(root, 'other-project')
    await mkdir(target)
    await writeFile(join(target, 'keep.txt'), 'keep')
    await symlink(target, join(root, 'dsh-scratch'))
    const registry = { create() { throw new Error('must not register') } }
    await assert.rejects(findScratchWorkspace(registry, root, signal()), /owned directory/)
    await assert.rejects(ensureScratchWorkspace(registry, root, 'Scratch', signal()), /owned directory/)
    const cancelled = new AbortController()
    cancelled.abort()
    await assert.rejects(ensureScratchWorkspace(registry, root, 'Scratch', cancelled.signal), /abort/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('validates the plugin wire request and response without accepting arbitrary paths', () => {
  assert.equal(scratchTitle({ title: ' 不在工作区 ' }), '不在工作区')
  for (const payload of [null, {}, { title: '' }, { title: 'ok', path: '/etc' }, { title: 'x'.repeat(81) }]) {
    assert.throws(() => scratchTitle(payload))
  }
  assert.throws(() => scratchWorkspace({ sessionId: 'wrong-return-type' }))
})

it('registers a scoped Fetch route behind Connection authentication and retries a failed operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-rpc-dispose-'))
  const cleanups = []
  let route
  let disposed = false
  let attempts = 0
  const values = {
    connection: { fetch: { register(value) {
      assert.equal(value.path, '/api/session-bridge/ensure-workspace')
      assert.deepEqual(value.methods, ['GET', 'POST'])
      assert.equal(value.requestBody, 'buffered')
      route = value
      return async () => { disposed = true }
    } } },
    workspaceRegistry: { async resolveByPath(path) {
      return attempts < 2 ? undefined : { id: 'workspace-shared', path, title: 'Renamed scratch' }
    }, async create(path, title) {
      if (++attempts === 1) throw new Error('disk failure')
      return { id: 'workspace-shared', path, title }
    } },
  }
  const ctx = {
    get: key => values[key],
    inject(names, callback) { assert.deepEqual(names, ['connection', 'workspaceRegistry']); callback(this) },
    effect(start) { cleanups.push(start()) },
  }
  try {
    registerScratchRoute(ctx, root)
    const lookup = async () => (await route.fetch(new Request('http://localhost' + route.path))).json()
    assert.deepEqual(await lookup(), { ok: true, value: null })
    assert.equal(attempts, 0)
    const handler = async (_endpoint, payload, abortSignal) => (await route.fetch(new Request('http://localhost' + route.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: abortSignal }))).json()
    assert.equal((await handler('ensure-workspace', { title: 'Scratch', path: '/etc' }, signal())).ok, false)
    assert.equal(attempts, 0)
    assert.equal((await handler('ensure-workspace', { title: 'Scratch' }, signal())).ok, false)
    const replies = await Promise.all([handler('ensure-workspace', { title: 'Scratch' }, signal()), handler('ensure-workspace', { title: 'Scratch' }, signal())])
    assert.ok(replies.every(reply => reply.ok && reply.value.workspaceId === 'workspace-shared'))
    assert.equal(attempts, 2)
    const existing = await lookup()
    assert.equal(existing.value.workspaceId, 'workspace-shared')
    assert.equal(existing.value.title, 'Renamed scratch')
    assert.equal(attempts, 2, 'lookup must not create or rename the registered workspace')
    for (const cleanup of cleanups) await cleanup()
    assert.equal(disposed, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
