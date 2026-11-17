/** Run with the Host's own Node/Electron and runtime; never opens a daily profile. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile, copyFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { registerSessionDeleteRoute } from '../lib/session-delete-route.js'
import { JsonlDeletion } from '../lib/session-deletion.js'

const runtime = process.argv[2]
if (!runtime) throw new Error('Pass the original Host runtime directory')
const require = createRequire(join(runtime, 'package.json'))
const load = async name => import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href)
const { Context } = await load('cordis')
const root = await mkdtemp(join(tmpdir(), 'sb-delete-host-'))
const compression = process.argv[3] ?? 'none'
const legacy = process.argv[4] === 'legacy'
async function loadLegacy(name) {
  // Same checked-in 0.1.0 bytes as the daily components; only resolve their
  // external imports to the original runtime. No daily profile is loaded.
  const source = await readFile(new URL(`../host-patches/runtime/${name}/lib/index.js`, import.meta.url), 'utf8')
  const resolved = source.replace(/from "([^"\n]+)"/gu, (match, specifier) => specifier.startsWith('node:')
    ? match : 'from ' + JSON.stringify(pathToFileURL(require.resolve(specifier)).href))
  const file = join(root, name + '.mjs')
  await writeFile(file, resolved)
  return import(pathToFileURL(file).href)
}
const ctx = new Context()
let route
let queryFiber
const liveAgents = new Map()
let disposals = 0
class ControlledAgents {
  get(id) { return liveAgents.get(id) }
  list() { return [...liveAgents.values()] }
  async create(id) {
    const writer = await ctx.get('sessionPersistence').open(id, 'write')
    const agent = { id, status: 'idle', inbox: { nextTurn: [], nextStep: [] }, session: { header: { id } } }
    liveAgents.set(id, agent)
    return { agent, async dispose() { await writer.close(); disposals++; liveAgents.delete(id) } }
  }
  async resume(id) { return this.create(id) }
}
class ControlledOwner {
  async createMinted(id) { return (await ctx.get('agents').create(id)).agent }
  async resolve(id) { return (await ctx.get('agents').resume(id)).agent }
  async claim(id) { return this.resolve(id) }
}
ctx.provide('profileContext', {installAnchor:join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')})
ctx.provide('connection', { fetch: { register(value) { route = value; return () => {} } } })
ctx.provide('sessionController', legacy ? { agents: new ControlledOwner(), async fork() {} } : {})
ctx.provide('agents', legacy ? new ControlledAgents() : { get(id) { return liveAgents.get(id) }, list() { return [...liveAgents.values()] } })
for (const [name, config] of [
  ['dsh-session'], ['dsh-session-persistence-jsonl', { root: join(root, 'sessions'), compression }],
  ['dsh-storage'], ['dsh-storage-json', { root: join(root, 'data') }], ['dsh-storage-domain', { backend: 'json' }],
  ['dsh-workspace'], ['dsh-session-projection'],
  ['dsh-session-projection-cache', { writeEveryEvents: 100, writeIntervalMs: 1000 }],
  ['dsh-session-query-sqlite', { path: join(root, 'search.sqlite') }],
]) {
  const module = legacy && name === 'dsh-session-persistence-jsonl' ? await loadLegacy('jsonl')
    : legacy && name === 'dsh-workspace' ? await loadLegacy('workspace') : await load(name)
  const fiber = ctx.plugin(module.default ?? module, config)
  await fiber.await()
  if (name === 'dsh-session-query-sqlite') queryFiber = fiber
}
const persistence = ctx.get('sessionPersistence')
const workspace = ctx.get('workspaceRegistry')
const project = await workspace.create(root, 'Isolated deletion verification')
const seed = async (id, extra = {}) => {
  const handle = await persistence.create({ id, version: 4, createdAt: Date.now(), cwd: root,
    isSeeded: false, delegationDepth: 0, ...extra })
  await handle.flush(); await handle.close()
  return id
}
const target = await seed('session-delete-target')
await project.attachSession(target)
let movedProject
if (legacy) {
  await ctx.plugin(await loadLegacy('lifecycle')).await()
  await mkdir(join(root, 'moved'))
  movedProject = await workspace.create(join(root, 'moved'), 'Move override verification')
  await workspace.moveSession(target, movedProject.id)
  assert.equal(workspace.sessionOverrides.get(target), movedProject.id)
}
await workspace.archiveSession(target)
await writeFile(join(root, 'user-file.txt'), 'preserve workspace files')
// The old package must expose the concrete failure before a fallback is added.
let adapter = new JsonlDeletion(ctx)
await adapter.initialize()
await ctx.plugin({ apply(ctx) { registerSessionDeleteRoute(ctx, () => adapter) } }).await()
const remove = id => route.fetch(new Request('http://localhost' + route.path, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: id, confirmed: true }),
}))
const capability = await (await route.fetch(new Request('http://localhost' + route.path))).json()
assert.equal(capability.supported, true, 'installing Bridge alone must provide deletion on the reviewed clean Host')
assert.equal(capability.backend, 'bridge-jsonl', 'the actual menu route must bypass the old controller')
if (legacy) {
  const id = await seed('session-controller-owned')
  const agent = await ctx.get('sessionController').agents.createMinted(id)
  for (const queue of ['nextTurn', 'nextStep']) {
    agent.inbox[queue].push({ content: 'synthetic work; never submitted to a model' })
    const result = await remove(id)
    assert.equal(result.status, 409)
    assert.equal((await result.json()).error.code, 'session/delete-active')
    assert.equal(disposals, 0, 'queued work must be rejected before releasing its owner')
    agent.inbox[queue].length = 0
  }
  const stopActivity = ctx.on('workspace/session-activity', (request, next) => request.sessionId === id
    ? Promise.resolve([{ kind: 'synthetic-background-job' }]) : next())
  assert.equal((await (await remove(id)).json()).error.code, 'session/delete-active')
  assert.equal(disposals, 0)
  stopActivity()
  assert.equal((await remove(id)).status, 200)
  assert.equal(disposals, 1, 'a known idle controller owner can still be released')
  assert.equal(await persistence.stat(id), undefined)
}
const query = ctx.get('sessionQuery')
const cache = ctx.get('sessionProjectionCache')
await query._serialized(undefined, async () => { await query._ensureReady(); await query._reconcile() })
assert.equal(query._db.prepare('SELECT id FROM persisted_sessions WHERE id = ?').get(target).id, target)
await cache.requireTable().put(target, { identity: {}, rows: [] })
const location = (await persistence.findLog(target)).currentPath
const lock = join(dirname(location), 'session.lock')
const lockIdentity = await stat(lock)
// Retained historical artifacts must also disappear, not reappear on restart.
await copyFile(location, join(dirname(location), 'session.v3.jsonl' + (compression === 'zstd' ? '.zstd' : '')))
const response = await route.fetch(new Request('http://localhost' + route.path, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: target, confirmed: true }),
}))
assert.equal(response.status, 200, JSON.stringify(await response.json()))
assert.equal(await persistence.stat(target), undefined)
assert.ok(!(await persistence.list()).some(row => row.header.id === target))
assert.ok(!project.sessionIds.includes(target))
assert.ok(!workspace.archivedSessionIds.includes(target))
assert.ok(!workspace.requireTable().get(project.id).sessionIds.includes(target), 'durable membership must be removed')
if (legacy) {
  assert.ok(!workspace.requireTable().get(movedProject.id).sessionIds.includes(target))
  assert.equal(workspace.sessionOverrides.get(target), undefined, 'move override must be durably detached')
  assert.ok(!workspace.requireState().sessionWorkspaceOverrides.some(row => row.sessionId === target))
}
assert.equal(query._db.prepare('SELECT id FROM persisted_sessions WHERE id = ?').get(target), undefined)
assert.equal(cache.requireTable().get(target), undefined)
await cache.put(target, {}, [])
assert.equal(cache.requireTable().get(target), undefined, 'late projection writebacks cannot resurrect a deleted row')
assert.equal((await stat(lock)).ino, lockIdentity.ino, 'the stable native writer-lock inode must survive')
assert.deepEqual((await readdir(dirname(location))).sort(), legacy
  ? ['session.deleted', 'session.lifecycle.lock', 'session.lock'] : ['session.lock'])
assert.equal(await readFile(join(root, 'user-file.txt'), 'utf8'), 'preserve workspace files')
const writerId = await seed('session-held-writer')
const writer = await persistence.open(writerId, 'write')
await assert.rejects(adapter.deleteSession(writerId), { name: 'SessionAlreadyOwnedError' })
assert.ok(await persistence.stat(writerId))
await writer.close()
await adapter.deleteSession(writerId)

const activeId = await seed('session-active')
const active = {id:activeId,status:'running',inbox:{nextTurn:[],nextStep:[]},session:{header:{id:activeId}}}
liveAgents.set(activeId, active)
await assert.rejects(adapter.deleteSession(activeId), /session\/delete-active/u)
active.status = 'idle'; active.inbox.nextTurn.push({content:'synthetic queued work; never executed'})
await assert.rejects(adapter.deleteSession(activeId), /session\/delete-active/u)
active.inbox.nextTurn.length = 0
await assert.rejects(adapter.deleteSession(activeId), /session\/delete-owned/u)
assert.ok(await persistence.stat(activeId))
liveAgents.delete(activeId)
await adapter.deleteSession(activeId)

const foreignId = await seed('session-foreign-writer')
const childProcess = spawn(process.execPath, ['--expose-internals', '--input-type=module', '--eval', `
  import {createRequire} from 'node:module'; import {pathToFileURL} from 'node:url';
  const req=createRequire(${JSON.stringify(join(runtime, 'package.json'))});
  const load=async name=>import(pathToFileURL(req.resolve('@deepseek-ai/'+name)).href);
  const {Context}=await load('cordis'); const ctx=new Context();
  await ctx.plugin((await load('dsh-session')).default).await();
  await ctx.plugin(await load('dsh-session-persistence-jsonl'),${JSON.stringify({root:join(root,'sessions'),compression})}).await();
  const handle=await ctx.get('sessionPersistence').open(${JSON.stringify(foreignId)},'write');
  process.stdout.write('writer-owned\\n');
  await new Promise(resolve=>process.stdin.once('data',resolve));
  await handle.close(); await ctx.fiber.dispose(); process.exit(0);
`], {env: {...process.env, ELECTRON_RUN_AS_NODE:'1'}, stdio:['pipe','pipe','pipe']})
let childOutput = ''
let childErrors = ''
childProcess.stderr.on('data', chunk => {childErrors += chunk})
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {childProcess.kill();reject(new Error('foreign writer did not start: '+childErrors))}, 10000)
  childProcess.on('exit', code => {if (!childOutput.includes('writer-owned')) {clearTimeout(timeout);reject(new Error('foreign writer exited '+code+': '+childErrors))}})
  childProcess.stdout.on('data', chunk => {childOutput += chunk; if (childOutput.includes('writer-owned')) {clearTimeout(timeout);resolve()}})
})
try {
  await assert.rejects(adapter.deleteSession(foreignId), {name:'SessionAlreadyOwnedError'})
  assert.ok(await persistence.stat(foreignId), 'a foreign writer must keep its transcript')
} finally {
  const exited = once(childProcess, 'exit')
  childProcess.stdin.end('release')
  assert.equal((await exited)[0], 0, childErrors)
}
await adapter.deleteSession(foreignId)

const parent = await seed('session-parent')
if (legacy) {
  const directory = dirname((await persistence.findLog(parent)).currentPath)
  const writer = await persistence.acquireLease(parent, undefined, directory)
  const Lease = Object.getPrototypeOf(writer).constructor
  await writer.release()
  const lifecycle = await Lease.acquire(directory, parent, 'session.lifecycle.lock')
  const inode = (await stat(join(directory, 'session.lifecycle.lock'))).ino
  await assert.rejects(adapter.deleteSession(parent), { name: 'SessionAlreadyOwnedError' })
  assert.ok(await persistence.stat(parent), 'an older parent/child lease must block the new transaction')
  await lifecycle.release()
  assert.equal((await stat(join(directory, 'session.lifecycle.lock'))).ino, inode)
}
const child = await seed('session-child', { parentSession: parent, delegationDepth: 1 })
await assert.rejects(adapter.deleteSession(parent), /session\/delete-has-children/u)
assert.ok(await persistence.stat(parent))
await adapter.deleteSession(child)
await adapter.deleteSession(parent)
await assert.rejects(seed('session-late-child', { parentSession: parent, delegationDepth: 1 }), /session\/delete-not-found/u)
await assert.rejects(seed(parent), /session\/delete-busy/u)

for (const deleteFirst of [false, true]) {
  const id = await seed('session-race-' + deleteFirst)
  const createChild = () => seed(id + '-child', {parentSession:id,delegationDepth:1})
  const results = await Promise.allSettled(deleteFirst
    ? [adapter.deleteSession(id), createChild()] : [createChild(), adapter.deleteSession(id)])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected', 'child creation and parent deletion must not both commit')
  if (!deleteFirst) {await adapter.deleteSession(id+'-child');await adapter.deleteSession(id)}
}

const recovery = await seed('session-recovery')
await project.attachSession(recovery)
await workspace.pinSession(recovery)
const previous = Object.getOwnPropertyDescriptor(workspace, 'setState')
Object.defineProperty(workspace, 'setState', { configurable: true, value: async () => { throw new Error('synthetic owner failure') } })
for (let retry = 0; retry < 2; retry++) {
  const response = await remove(recovery)
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'session/delete-cleanup-pending')
}
assert.equal(await persistence.stat(recovery), undefined, 'intent remains hidden after a cleanup interruption')
await adapter.dispose()
adapter = new JsonlDeletion(ctx)
await adapter.initialize()
assert.equal((await (await remove(recovery)).json()).error.code, 'session/delete-cleanup-pending',
  'a failed startup recovery must keep explicit retry available')
if (previous) Object.defineProperty(workspace, 'setState', previous)
else Reflect.deleteProperty(workspace, 'setState')
assert.equal((await remove(recovery)).status, 200, 'retry completes the retained cleanup intent')
assert.ok(!workspace.pinnedSessionIds.includes(recovery))
await adapter.deleteSession(recovery) // idempotent retry of a committed deletion
const coldIndexId = await seed('session-cold-index')
await query._serialized(undefined, () => query._reconcile())
assert.ok(query._db.prepare('SELECT id FROM persisted_sessions WHERE id = ?').get(coldIndexId))
await adapter.dispose()
await queryFiber.dispose()
await ctx.plugin((await load('dsh-session-query-sqlite')).default, {path:join(root,'search.sqlite'),openAt:'first-search'}).await()
const coldQuery = ctx.get('sessionQuery')
assert.equal(coldQuery._db, undefined)
adapter = new JsonlDeletion(ctx)
await adapter.initialize()
await adapter.deleteSession(coldIndexId)
assert.equal(coldQuery._db.prepare('SELECT id FROM persisted_sessions WHERE id = ?').get(coldIndexId), undefined,
  'deletion also removes rows from an unopened persistent index')
await adapter.dispose()
assert.equal(await persistence.stat(target), undefined, 'no generation survives after companion unload')
assert.equal(await persistence.stat(recovery), undefined)
console.log(JSON.stringify({ root, compression, legacy, backend: capability.backend,
  checks: ['delete', 'workspace-files', 'archive', 'pin', 'durable-membership', 'writer-lock', 'foreign-writer-lock', 'lineage-races',
    'running-queued-owned', 'derived-sessions', 'old-generations', 'sqlite', 'unopened-sqlite', 'projection-cache', 'late-writeback', 'recovery', 'unload'] }))
await ctx.fiber.dispose()
