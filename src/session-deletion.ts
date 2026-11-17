/**
 * In-package deletion companion for the reviewed 0.2.2-rc.3 JSONL composition.
 * No Host code or native addon is copied. The existing owners supply writer
 * leases, write queues and index reconciliation. Unknown implementations refuse.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { HostContext } from './dsh.ts'
import { warn } from './dsh.ts'

// These private seams are deliberately narrower than Bridge's other features.
// Compare the raw prototype, not Cordis's traced `service.constructor` wrapper.
const REVIEWED = {
  sessionPersistence: '3b266ac3f592216e5967eedce615630e07024c68637fe9f86ba152419805c3f7',
  workspaceRegistry: '0f77c69b0ba7304ca545382ff28a54223b676ae3b11dd7f98931be92fd070c09',
  sessionProjectionCache: 'd2be1d374a7320e09e837ea912a40aadf4e34e532f7b3e7826ab994948b5a83b',
  sessionQuery: '442848396e7bcd64362ce13ee0322bb2c38ca8153d73ead968c806c67c98eb58',
} as const

interface Header { id: string; parentSession?: string }
interface Lease { release(): Promise<void> }
interface Handle { flush(): Promise<void>; close(): Promise<void> }
interface Persistence {
  root: string
  tracker: { claimWrite(id: string): void; releaseClaim(id: string): void }
  coldLogMemo: Map<string, unknown>
  migrationPreparations: Map<string, unknown>
  acquireLease(id: string, cwd: undefined, dir: string): Promise<Lease>
  findLog(id: string, signal?: AbortSignal): Promise<{ currentPath: string } | undefined>
  list(): Promise<{ header: Header }[]>
  stat(id: string): Promise<unknown>
}
interface Workspace {
  headers: Map<string, Header>
  sessionPaths: Map<string, string>
  missingSessionPaths: Set<string>
  invalidSessionPaths: Map<string, string>
  list(): { sessionIds: readonly string[]; detachSession(id: string): Promise<void> }[]
  enqueueOperation<T>(operation: () => Promise<T>): Promise<T>
  requireState(): { archivedSessionIds: string[]; pinnedSessionIds: string[] }
  setState(state: ReturnType<Workspace['requireState']>): Promise<void>
}
interface Query {
  config: { path: string }
  _db?: unknown
  _observations: { cache: Map<string, unknown> }
  _serialized<T>(signal: undefined, operation: () => Promise<T>): Promise<T>
  _ensureReady(signal?: AbortSignal): Promise<void>
  _reconcile(signal?: AbortSignal): Promise<void>
}
interface Cache { requireTable(): { delete(id: string): Promise<unknown> } }
interface Agent {
  id: string
  status: string
  inbox: { nextTurn: readonly unknown[]; nextStep: readonly unknown[] }
  session: { header: Header }
}
interface AgentHandle { agent: Agent; dispose(): Promise<void> }
interface Agents { get(id: string): Agent | undefined; list(): Agent[] }
interface Journal { version: 1; id: string; directory: string; done: boolean }
export interface SessionDeletion { deleteSession(id: string): Promise<void> }

/** Refusals are stable across HTTP and the native adapter verification. */
function refuse(reason: string): never { throw new Error(`session/delete-${reason}`) }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Install only for a known composition that has no Host-owned deletion API. */
export function registerSessionDeletion(ctx: HostContext): () => SessionDeletion | undefined {
  let available: SessionDeletion | undefined
  ctx.inject(['sessionPersistence', 'workspaceRegistry', 'sessionProjectionCache', 'sessionQuery', 'sessionController', 'agents', 'sessions'], scope => {
    const controller = scope.get('sessionController') as { deleteSession?: unknown; deleteArchivedSession?: unknown }
    if (typeof controller.deleteSession === 'function' || typeof controller.deleteArchivedSession === 'function') return
    scope.effect(() => {
      let adapter: JsonlDeletion | undefined
      let closing = false
      const ready = (async () => {
        try {
          adapter = new JsonlDeletion(scope)
          await adapter.initialize()
          if (!closing) available = adapter
        } catch (error) { warn(scope, `session-bridge: deletion companion unavailable: ${String(error)}`) }
      })()
      return async () => {
        closing = true
        available = undefined
        await ready
        await adapter?.dispose()
      }
    }, 'session-bridge: deletion companion')
  })
  return () => available
}

/** One reviewed service instance; exported for genuine Host integration checks. */
export class JsonlDeletion implements SessionDeletion {
  private readonly persistence: Persistence
  private readonly workspace: Workspace
  private readonly query: Query
  private readonly cache: Cache | undefined
  private readonly agents: Agents
  private root = ''
  private records = ''
  private lockDirectory = ''
  private closing = false
  private tail: Promise<unknown> = Promise.resolve()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly deleting = new Set<string>()
  private readonly handles = new Map<string, AgentHandle>()
  private readonly ownership = new AsyncLocalStorage<{ active: boolean }>()
  private readonly restore: (() => void)[] = []

  constructor(private readonly ctx: HostContext) {
    for (const [name, fingerprint] of Object.entries(REVIEWED)) {
      const service = ctx.get(name)
      if (name === 'sessionProjectionCache' && service === undefined) continue
      if (service === undefined || digest(Object.getPrototypeOf(service).constructor.toString()) !== fingerprint) {
        refuse('unsupported')
      }
    }
    this.persistence = ctx.get('sessionPersistence') as Persistence
    this.workspace = ctx.get('workspaceRegistry') as Workspace
    this.query = ctx.get('sessionQuery') as Query
    this.cache = ctx.get('sessionProjectionCache') as Cache | undefined
    this.agents = ctx.get('agents') as Agents
  }

  async initialize(): Promise<void> {
    const profile = this.ctx.get('profileContext') as { installAnchor?: unknown } | undefined
    if (typeof profile?.installAnchor !== 'string') refuse('unsupported')
    const host = JSON.parse(await readFile(profile.installAnchor, 'utf8')) as { version?: string }
    if (host.version !== '0.2.2-rc.3') refuse('unsupported')
    await mkdir(this.persistence.root, { recursive: true })
    this.root = await realpath(this.persistence.root)
    const directory = join(this.root, '.session-bridge-deletion')
    for (const path of [directory, join(directory, 'records'), join(directory, 'lock')]) {
      await mkdir(path, { recursive: true, mode: 0o700 })
      if (!(await lstat(path)).isDirectory()) refuse('unsupported')
    }
    this.records = join(directory, 'records')
    this.lockDirectory = join(directory, 'lock')
    await this.syncDirectory(directory)
    await this.syncDirectory(this.root)
    this.guardStorage()
    this.captureOwnership()
    // Recovery runs through the same locks and owner queues as a new request.
    await this.inLineage(async () => {
      for (const name of await readdir(this.records)) {
        if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue
        const record = await this.readRecord(join(this.records, name))
        if (digest(record.id) + '.json' !== name) refuse('unsupported')
        if (!record.done) await this.complete(record)
      }
    })
  }

  async deleteSession(id: string): Promise<void> {
    if (this.closing || this.deleting.has(id)) refuse('busy')
    this.deleting.add(id)
    const operation = this.inLineage(async () => {
      const existing = await this.record(id)
      if (existing !== undefined) { if (!existing.done) await this.complete(existing); return }
      // Refuse queued/background work before releasing a controller-owned Agent.
      const agent = this.agents.get(id)
      if (agent !== undefined) {
        if (agent.status === 'running' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) refuse('active')
        if (this.handles.get(id)?.agent !== agent) refuse('owned')
      }
      const ctx = this.ctx as HostContext & {
        waterfall(name: string, request: { sessionId: string }, fallback: () => Promise<unknown[]>): Promise<unknown[]>
      }
      if ((await ctx.waterfall('workspace/session-activity', { sessionId: id }, async () => [])).length) refuse('active')
      if ((await this.persistence.list()).some(row => row.header.parentSession === id)
        || this.agents.list().some(item => item.session.header.parentSession === id)) refuse('has-children')
      if (agent !== undefined) {
        if (agent.status === 'running' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) refuse('active')
        await this.handles.get(id)!.dispose()
        this.handles.delete(id)
      }
      const sessions = this.ctx.get('sessions') as { get(id: string): unknown }
      if (this.agents.get(id) !== undefined || sessions.get(id) !== undefined) refuse('owned')
      this.persistence.tracker.claimWrite(id)
      let lease: Lease | undefined
      try {
        const found = await this.persistence.findLog(id)
        if (found === undefined) refuse('not-found')
        const directory = await this.sessionDirectory(relative(resolve(this.persistence.root), dirname(found.currentPath)))
        lease = await this.persistence.acquireLease(id, undefined, directory)
        await this.artifacts(directory) // reject unfamiliar files before committing intent
        const record: Journal = { version: 1, id, directory: relative(this.root, directory), done: false }
        await this.writeRecord(record)
        await this.cleanup(record, directory)
      } finally {
        try { await lease?.release() } finally { this.persistence.tracker.releaseClaim(id) }
      }
    })
    this.pending.add(operation)
    try { await operation } finally { this.pending.delete(operation); this.deleting.delete(id) }
  }

  async dispose(): Promise<void> {
    this.closing = true
    await Promise.allSettled([...this.pending, this.tail])
    for (const restore of this.restore.reverse()) restore()
    this.restore.length = 0
    this.handles.clear()
  }

  /** Preserve the caller's traced `this`; never bind registry methods to our scope. */
  private wrap<T extends object, K extends keyof T>(target: T, key: K,
    wrap: (original: (...args: never[]) => unknown) => (...args: never[]) => unknown): void {
    const previous = Object.getOwnPropertyDescriptor(target, key)
    // A different extension already replacing this seam is not the reviewed
    // composition. In particular, never stack two deletion companions.
    if (previous !== undefined) refuse('unsupported')
    let owner: object | null = target
    let descriptor: PropertyDescriptor | undefined = previous
    while (descriptor === undefined && (owner = Object.getPrototypeOf(owner)) !== null) {
      descriptor = Object.getOwnPropertyDescriptor(owner, key)
    }
    if (typeof descriptor?.value !== 'function') refuse('unsupported')
    const value = wrap(descriptor.value as (...args: never[]) => unknown)
    Object.defineProperty(target, key, { configurable: true, writable: true, value })
    this.restore.push(() => {
      if (Object.getOwnPropertyDescriptor(target, key)?.value !== value) return
      Reflect.deleteProperty(target, key)
    })
  }

  private guardStorage(): void {
    const adapter = this
    // The journal hides every historical/compressed generation during recovery.
    this.wrap(this.persistence, 'findLog', original => async function (this: Persistence, id: string, ...args: never[]) {
      if (await adapter.record(id)) return undefined
      return Reflect.apply(original, this, [id, ...args])
    })
    const backend = this.persistence as Persistence & {
      create(header: Header, options?: unknown): Promise<Handle>
      open(id: string, access: string, options?: unknown): Promise<Handle>
      listArtifacts(signal?: AbortSignal): Promise<{ header: Header }[]>
    }
    this.wrap(backend, 'listArtifacts', original => async function (this: Persistence, ...args: never[]) {
      const rows = await Reflect.apply(original, this, args) as { header: Header }[]
      const kept = await Promise.all(rows.map(async row => await adapter.record(row.header.id) ? undefined : row))
      return kept.filter(row => row !== undefined)
    })
    this.wrap(backend, 'open', original => async function (this: Persistence, id: string, ...args: never[]) {
      if (adapter.deleting.has(id) || await adapter.record(id)) refuse('busy')
      return Reflect.apply(original, this, [id, ...args])
    })
    this.wrap(backend, 'create', original => function (this: Persistence, header: Header, ...args: never[]) {
      const receiver = this
      return adapter.inLineage(async () => {
        if (adapter.closing || adapter.deleting.has(header.id) || await adapter.record(header.id)) refuse('busy')
        if (header.parentSession !== undefined && (await adapter.record(header.parentSession)
          || await adapter.persistence.stat(header.parentSession) === undefined)) refuse('not-found')
        const handle = await Reflect.apply(original, receiver, [header, ...args]) as Handle
        // A child must be visible to another process before releasing the lineage lock.
        if (header.parentSession !== undefined) {
          try { await handle.flush() } catch (error) { await handle.close(); throw error }
        }
        return handle
      })
    })
    const workspace = this.workspace as Workspace & { indexHeader(header: Header): Promise<void> }
    this.wrap(workspace, 'indexHeader', original => async function (this: Workspace, header: Header) {
      if (!await adapter.record(header.id)) await Reflect.apply(original, this, [header])
      // indexHeader has an async realpath: do not reinsert a concurrently deleted header.
      if (await adapter.record(header.id)) adapter.forgetHeader(header.id)
    })
    if (this.cache !== undefined) {
      const cache = this.cache as Cache & { put(id: string, ...args: never[]): Promise<void> }
      this.wrap(cache, 'put', original => async function (this: Cache, id: string, ...args: never[]) {
        if (!await adapter.record(id)) return Reflect.apply(original, this, [id, ...args])
      })
    }
  }

  private captureOwnership(): void {
    const adapter = this
    const controller = this.ctx.get('sessionController') as { agents?: object; commands?: object }
    // Minimal non-Agent compositions can delete only cold Sessions. Real API
    // controllers expose these exact owners; other owners remain non-disposable.
    if (controller.agents === undefined) return
    const owners: [object, string][] = ['resolve', 'claim', 'createMinted'].map(key => [controller.agents!, key])
    if (controller.commands !== undefined) owners.push([controller.commands, 'fork'])
    for (const [owner, key] of owners) {
      this.wrap(owner as Record<string, unknown>, key, original => function (this: object, ...args: never[]) {
        if ((key === 'resolve' || key === 'claim') && adapter.deleting.has(args[0]!)) refuse('busy')
        const token = { active: true }
        return adapter.ownership.run(token, async () => {
          try { return await Reflect.apply(original, this, args) } finally { token.active = false }
        })
      })
    }
    for (const key of ['create', 'resume'] as const) {
      this.wrap(this.agents as Agents & Record<typeof key, unknown>, key, original => async function (this: object, ...args: never[]) {
        const handle = await Reflect.apply(original, this, args) as AgentHandle
        if (adapter.ownership.getStore()?.active) adapter.handles.set(handle.agent.id, handle)
        return handle
      })
    }
    this.restore.push(this.ctx.on('agent/disposed', ((event: { agent: Agent }) => {
      if (this.handles.get(event.agent.id)?.agent === event.agent) this.handles.delete(event.agent.id)
    }) as never))
  }

  private inLineage<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      let lease: Lease | undefined
      for (let attempt = 0; lease === undefined; attempt++) {
        try { lease = await this.persistence.acquireLease('session-bridge-lineage', undefined, this.lockDirectory) }
        catch (error) {
          if (!(error instanceof Error) || error.name !== 'SessionAlreadyOwnedError' || attempt >= 99) throw error
          await delay(50)
        }
      }
      try { return await operation() } finally { await lease.release() }
    })
    this.tail = result.catch(() => {})
    return result
  }

  private async record(id: string): Promise<Journal | undefined> {
    try { return await this.readRecord(join(this.records, digest(id) + '.json'), id) }
    catch (error) { if (missing(error)) return undefined; throw error }
  }

  private async readRecord(path: string, expectedId?: string): Promise<Journal> {
    if (!(await lstat(path)).isFile()) refuse('unsupported')
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<Journal>
    if (value.version !== 1 || typeof value.id !== 'string' || typeof value.directory !== 'string'
      || typeof value.done !== 'boolean' || (expectedId !== undefined && value.id !== expectedId)) refuse('unsupported')
    return value as Journal
  }

  private async writeRecord(record: Journal): Promise<void> {
    const path = join(this.records, digest(record.id) + '.json')
    const temporary = `${path}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(record)); await file.sync() } finally { await file.close() }
    try { await rename(temporary, path); await this.syncDirectory(this.records) }
    finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error }) }
  }

  private async sessionDirectory(path: string): Promise<string> {
    const parts = path.split(sep)
    if (parts.length !== 2 || parts.some(part => !part || part === '.' || part === '..')
      || parts[0] === '.session-bridge-deletion') refuse('unsupported')
    const absolute = resolve(this.root, path)
    if (relative(this.root, absolute) !== path) refuse('unsupported')
    for (const directory of [dirname(absolute), absolute]) {
      if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory) refuse('unsupported')
    }
    return absolute
  }

  private async artifacts(directory: string): Promise<string[]> {
    const files = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'session.lock' && entry.isFile()) continue
      if (!entry.isFile() || !/^session\.(?:v\d+\.jsonl(?:\.zstd)?|migration\.[\w-]+\.jsonl(?:\.zstd)?\.tmp)$/u.test(entry.name)) {
        refuse('unsupported')
      }
      files.push(join(directory, entry.name))
    }
    return files
  }

  private async complete(record: Journal): Promise<void> {
    const directory = await this.sessionDirectory(record.directory)
    this.persistence.tracker.claimWrite(record.id)
    let lease: Lease | undefined
    try {
      lease = await this.persistence.acquireLease(record.id, undefined, directory)
      await this.cleanup(record, directory)
    } finally {
      try { await lease?.release() } finally { this.persistence.tracker.releaseClaim(record.id) }
    }
  }

  private async cleanup(record: Journal, directory: string): Promise<void> {
    try {
      for (const path of await this.artifacts(directory)) await unlink(path)
      await this.syncDirectory(directory)
      this.persistence.coldLogMemo.delete(record.id)
      this.persistence.migrationPreparations.delete(record.id)
      await this.workspace.enqueueOperation(async () => {
        this.forgetHeader(record.id)
        for (const workspace of this.workspace.list()) await workspace.detachSession(record.id)
        const state = this.workspace.requireState()
        if (state.archivedSessionIds.includes(record.id) || state.pinnedSessionIds.includes(record.id)) {
          await this.workspace.setState({ ...state,
            archivedSessionIds: state.archivedSessionIds.filter(id => id !== record.id),
            pinnedSessionIds: state.pinnedSessionIds.filter(id => id !== record.id) })
        }
      })
      await this.cache?.requireTable().delete(record.id)
      this.query._observations.cache.delete(record.id)
      // An unopened in-memory/disabled search index contains nothing to erase.
      const storedIndex = this.query.config.path !== ':memory:'
        && await lstat(this.query.config.path).then(() => true, error => { if (missing(error)) return false; throw error })
      if (this.query._db !== undefined || storedIndex) await this.query._serialized(undefined, async () => {
        await this.query._ensureReady()
        await this.query._reconcile()
      })
      await this.writeRecord({ ...record, done: true })
    } catch (error) {
      throw new Error('session/delete-cleanup-pending', { cause: error })
    }
  }

  private forgetHeader(id: string): void {
    this.workspace.headers.delete(id)
    this.workspace.sessionPaths.delete(id)
    this.workspace.missingSessionPaths.delete(id)
    this.workspace.invalidSessionPaths.delete(id)
  }

  private async syncDirectory(path: string): Promise<void> {
    if (process.platform === 'win32') return // Windows does not expose directory fsync through Node.
    const handle = await open(path, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }
}
