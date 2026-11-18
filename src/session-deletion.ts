/**
 * In-package session lifecycle companion for reviewed DSH JSONL compositions.
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
const REVIEWED_PLACEMENT = {
  controllerOwner: '7c5074f7b7c455ec7c0903f43cbb37381190b7bd554bccbff74296a3e329a6e7',
  candidateMatches: 'b5d795301ea6097279d6823691924c40bb491efc042237708199a60da268a375',
  readSessionHeader: '041207d502053392281e4e21775f42b1458acec9cfe2df00667576b92abd53d3',
} as const
// The installed 0.1.0 persistence/workspace pair has native lifecycle locks
// and move overrides. Its controller deletion method is unsafe and is bypassed.
const LEGACY = {
  sessionPersistence: '26d5c499ca2781c8f02604a727cb0f2b376a48a8fd56e5de939f8194592a1063',
  workspaceRegistry: '924f5bcc2e7fe8e71eddf306781a7797aac9b96c4dd4dd59f514548765e6b59c',
  lease: '4299bd33a2590fe367b40e9b0129ce89a402464b2764d14633c59ba88e9acc0c',
  owner: 'c5339e44a6d5930d8d46afb70490c9d842b6de99440ee25131fac4c65ca52126',
  registry: 'c91556bb3126a811df40e319ccb98ffba75a119c79d8c97c33999f4c478da0f2',
  deleteSession: '703ae11c5b1f96b83f379b5c70325a4d7be7a90af627aed8116358fb33de57d5',
  deleteArchivedSession: '1c887f0de84ecab08d155d7a220da542a812ff9b329af3c7f84111307ff271ed',
} as const

interface Header { id: string; cwd?: string; parentSession?: string }
interface Lease { release(): Promise<void> }
interface LeaseClass { acquire(directory: string, id: string, filename: string): Promise<Lease> }
interface Handle { flush(): Promise<void>; close(): Promise<void> }
interface WorkingDirectoryChange { type: 'working-directory/change'; seq: number; time: number; data: { cwd: string } }
interface MoveHandle extends Handle {
  header: Header
  read(): Promise<{ events: readonly { type: string; data?: { cwd?: string } }[] }>
  append(events: readonly WorkingDirectoryChange[]): Promise<void>
}
interface Persistence {
  root: string
  tracker: { claimWrite(id: string): void; releaseClaim(id: string): void }
  coldLogMemo: Map<string, unknown>
  migrationPreparations: Map<string, unknown>
  acquireLease(id: string, cwd: undefined, dir: string): Promise<Lease>
  findLog(id: string, signal?: AbortSignal): Promise<{ currentPath: string } | undefined>
  list(): Promise<{ header: Header }[]>
  stat(id: string): Promise<{ header: Header } | undefined>
  open(id: string, access: 'read' | 'write'): Promise<MoveHandle>
  writeDeletionTombstone?(directory: string, id: string): Promise<void>
}
interface WorkspaceEntity {
  id: string
  path: string
  sessionIds: readonly string[]
  attachSession(id: string): Promise<void>
  detachSession(id: string): Promise<void>
}
interface Workspace {
  headers: Map<string, Header>
  sessionPaths: Map<string, string>
  missingSessionPaths: Set<string>
  invalidSessionPaths: Map<string, string>
  list(): WorkspaceEntity[]
  get(id: string): WorkspaceEntity | undefined
  requireTable(): { get(id: string): { sessionIds: readonly string[] } | undefined }
  host: {
    candidateMatches(id: string, path: string): boolean
    readSessionHeader(id: string): Promise<Header>
  }
  enqueueOperation<T>(operation: () => Promise<T>): Promise<T>
  requireState(): { archivedSessionIds: string[]; pinnedSessionIds: string[] }
  setState(state: ReturnType<Workspace['requireState']>): Promise<void>
  detachSession?(id: string): Promise<void>
}
interface Query {
  config: { path: string }
  observeSession(id: string): Promise<{
    events: readonly { type: string }[]
    projections?: { values: { inbox?: { 'next-turn': readonly unknown[]; 'next-step': readonly unknown[] } } }
    [Symbol.dispose](): void
  }>
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
interface MoveJournal { version: 1; id: string; target: string; previous?: string; done: boolean }
interface Ownership { active: boolean; movedClaim?: { original: string; target: string } }
export interface SessionDeletion { deleteSession(id: string): Promise<void> }

/** Refusals are stable across HTTP and the native adapter verification. */
function refuse(reason: string): never { throw new Error(`session/delete-${reason}`) }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Do not advertise the known 0.1.0 controller while the safe adapter is absent. */
export function hasLegacyDeletion(controller: object): boolean {
  return (['deleteSession', 'deleteArchivedSession'] as const).some(key => {
    const value: unknown = Object.getOwnPropertyDescriptor(controller, key)?.value
    return typeof value === 'function' && digest(value.toString()) === LEGACY[key]
  })
}

/** Install for a reviewed composition, including the old lifecycle decorator. */
export function registerSessionDeletion(ctx: HostContext): () => JsonlDeletion | undefined {
  let available: JsonlDeletion | undefined
  ctx.inject(['sessionPersistence', 'workspaceRegistry', 'sessionProjectionCache', 'sessionQuery', 'sessionController', 'agents', 'sessions'], scope => {
    const controller = scope.get('sessionController') as { deleteSession?: unknown; deleteArchivedSession?: unknown }
    if (!hasLegacyDeletion(controller)
      && (typeof controller.deleteSession === 'function' || typeof controller.deleteArchivedSession === 'function')) return
    scope.effect(() => {
      let adapter: JsonlDeletion | undefined
      let closing = false
      const ready = (async () => {
        try {
          adapter = new JsonlDeletion(scope)
          await adapter.initialize()
          if (!closing) available = adapter
        } catch (error) {
          await adapter?.dispose()
          adapter = undefined
          warn(scope, `session-bridge: deletion companion unavailable: ${String(error)}`)
        }
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
  private readonly legacy: boolean
  private leaseClass?: LeaseClass
  private root = ''
  private records = ''
  private movesDirectory?: string
  private openWriter?: (id: string) => Promise<MoveHandle>
  private lockDirectory = ''
  private closing = false
  private tail: Promise<unknown> = Promise.resolve()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly mutating = new Set<string>()
  private readonly moveRecords = new Map<string, MoveJournal>()
  private readonly placements = new Map<string, string>()
  private readonly handles = new Map<string, AgentHandle>()
  private readonly ownership = new AsyncLocalStorage<Ownership>()
  private readonly restore: (() => void)[] = []

  constructor(private readonly ctx: HostContext) {
    const storage = ctx.get('sessionPersistence')
    this.legacy = storage !== undefined
      && digest(Object.getPrototypeOf(storage).constructor.toString()) === LEGACY.sessionPersistence
    for (const [name, fingerprint] of Object.entries(REVIEWED)) {
      const service = ctx.get(name)
      if (name === 'sessionProjectionCache' && service === undefined) continue
      const expected = this.legacy && (name === 'sessionPersistence' || name === 'workspaceRegistry') ? LEGACY[name] : fingerprint
      if (service === undefined || digest(Object.getPrototypeOf(service).constructor.toString()) !== expected) {
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
    const rc4 = host.version === '0.2.2-rc.4'
    if (host.version !== '0.2.2-rc.3' && !rc4) refuse('unsupported')
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
      if (rc4 && !this.legacy && this.ctx.get('workingDirectory') !== undefined) await this.mountMovement(directory)
      for (const name of await readdir(this.records)) {
        if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue
        const record = await this.readRecord(join(this.records, name))
        if (digest(record.id) + '.json' !== name) refuse('unsupported')
        if (!record.done) {
          try { await this.complete(record) } catch (error) {
            if (!(error instanceof Error) || error.message !== 'session/delete-cleanup-pending') throw error
            // Keep the route available for an explicit retry after an owner recovers.
            warn(this.ctx, `session-bridge: cleanup pending for ${record.id}`)
          }
        }
      }
      for (const record of this.moveRecords.values()) {
        if (record.done || await this.record(record.id)) continue
        try { await this.completeMove(record.id, record.target) }
        catch (error) { warn(this.ctx, `session-bridge: move pending for ${record.id}: ${String(error)}`) }
      }
    })
  }

  deleteSession(id: string): Promise<void> {
    return this.mutate(id, 'delete', async () => {
      const existing = await this.record(id)
      if (existing !== undefined) { if (!existing.done) await this.complete(existing); return }
      await this.releaseIdle(id, 'delete', () => this.assertNoChildren(id))
      this.persistence.tracker.claimWrite(id)
      let lease: Lease | undefined
      let lifecycle: Lease | undefined
      try {
        const found = await this.persistence.findLog(id)
        if (found === undefined) refuse('not-found')
        const directory = await this.sessionDirectory(relative(resolve(this.persistence.root), dirname(found.currentPath)))
        if (this.legacy) {
          lifecycle = await this.leaseClass!.acquire(directory, id, 'session.lifecycle.lock')
          // Older writers coordinate parent/child creation with this native lock.
          await this.assertNoChildren(id)
        }
        lease = await this.persistence.acquireLease(id, undefined, directory)
        await this.assertStoredIdle(id, 'delete')
        await this.artifacts(directory) // reject unfamiliar files before committing intent
        const record: Journal = { version: 1, id, directory: relative(this.root, directory), done: false }
        await this.writeRecord(this.records, record)
        await this.cleanup(record, directory)
      } finally {
        try { await lease?.release() } finally {
          try { await lifecycle?.release() } finally { this.persistence.tracker.releaseClaim(id) }
        }
      }
    })
  }

  get canMove(): boolean { return this.movesDirectory !== undefined }

  moveSession(id: string, target: string): Promise<void> {
    return this.mutate(id, 'move', async () => {
      if (!this.canMove) throw new Error('session/move-unsupported')
      if (await this.record(id)) throw new Error('session/move-not-found')
      const workspace = this.workspace.get(target)
      if (workspace === undefined) throw new Error('session/move-target-missing')
      if (workspace.sessionIds.includes(id) && this.moveRecords.get(id)?.done !== false) return
      await this.releaseIdle(id, 'move')
      await this.completeMove(id, target)
    })
  }

  private async mutate(id: string, kind: 'delete' | 'move', action: () => Promise<void>): Promise<void> {
    if (this.closing || this.mutating.has(id)) throw new Error(`session/${kind}-busy`)
    this.mutating.add(id)
    const operation = this.inLineage(action)
    this.pending.add(operation)
    try { await operation } finally { this.pending.delete(operation); this.mutating.delete(id) }
  }

  /** Refuse queued or background work before releasing the API controller's writer. */
  private async releaseIdle(id: string, kind: 'delete' | 'move', beforeRelease?: () => Promise<void>): Promise<void> {
    const active = (agent: Agent): boolean => agent.status === 'running' || !!(agent.inbox.nextTurn.length || agent.inbox.nextStep.length)
    const agent = this.agents.get(id)
    const handle = this.handles.get(id)
    const owned = () => new Error(kind === 'delete' ? 'session/delete-owned' : 'session/move-busy')
    if (agent !== undefined) {
      if (active(agent)) throw new Error(`session/${kind}-active`)
      if (handle?.agent !== agent) throw owned()
    }
    const ctx = this.ctx as HostContext & {
      waterfall(name: string, request: { sessionId: string }, fallback: () => Promise<unknown[]>): Promise<unknown[]>
    }
    if ((await ctx.waterfall('workspace/session-activity', { sessionId: id }, async () => [])).length) {
      throw new Error(`session/${kind}-active`)
    }
    await beforeRelease?.()
    if (agent !== undefined && this.agents.get(id) === agent && handle !== undefined) {
      if (active(agent)) throw new Error(`session/${kind}-active`)
      await handle.dispose()
      this.handles.delete(id)
    }
    const sessions = this.ctx.get('sessions') as { get(id: string): unknown }
    if (this.agents.get(id) !== undefined || sessions.get(id) !== undefined) throw owned()
  }

  private async mountMovement(directory: string): Promise<void> {
    const controller = this.ctx.get('sessionController') as { agents?: object }
    if (controller.agents === undefined
      || digest(Object.getPrototypeOf(controller.agents).constructor.toString()) !== REVIEWED_PLACEMENT.controllerOwner) return
    const moves = join(directory, 'moves')
    await mkdir(moves, { recursive: true, mode: 0o700 })
    if (!(await lstat(moves)).isDirectory()) refuse('unsupported')
    await this.syncDirectory(directory)
    for (const name of await readdir(moves)) {
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue
      const path = join(moves, name)
      if (!(await lstat(path)).isFile()) refuse('unsupported')
      const record = JSON.parse(await readFile(path, 'utf8')) as Partial<MoveJournal>
      if (record.version !== 1 || typeof record.id !== 'string' || digest(record.id) + '.json' !== name
        || typeof record.target !== 'string' || typeof record.done !== 'boolean'
        || (record.previous !== undefined && typeof record.previous !== 'string')) refuse('unsupported')
      // A crash may have landed after attach but before the completion receipt.
      const attached = this.workspace.requireTable().get(record.target)?.sessionIds.includes(record.id)
      const placement = record.done || attached ? record.target : record.previous
      if (placement !== undefined) this.placements.set(record.id, placement)
      this.moveRecords.set(record.id, record as MoveJournal)
    }
    // Native workspace records anchor placement to immutable header.cwd. Only
    // the registry sees the explicit binding; the stored header stays intact.
    const host = this.workspace.host
    this.wrap(host, 'candidateMatches', original => (id: string, path: string) => {
      const placement = this.placements.get(id)
      return placement === undefined ? Reflect.apply(original, host, [id, path]) : this.workspace.get(placement)?.path === path
    }, REVIEWED_PLACEMENT.candidateMatches)
    this.wrap(host, 'readSessionHeader', original => async (id: string) => {
      const header = await Reflect.apply(original, host, [id]) as Header
      const placement = this.placements.get(id)
      const cwd = placement === undefined ? undefined : this.workspace.get(placement)?.path
      return cwd === undefined ? header : { ...header, cwd }
    }, REVIEWED_PLACEMENT.readSessionHeader)
    this.movesDirectory = moves
  }

  private async completeMove(id: string, targetId: string): Promise<void> {
    const handle = await this.openWriter!(id).catch(error => {
      if (error instanceof Error && error.name === 'SessionPersistenceNotFoundError') throw new Error('session/move-not-found')
      throw error
    })
    try {
      await this.assertStoredIdle(id, 'move')
      await this.workspace.enqueueOperation(async () => {
        const target = this.workspace.get(targetId)
        const valid = target && await realpath(target.path)
          .then(async path => path === target.path && (await lstat(path)).isDirectory()).catch(() => false)
        if (!target || !valid) throw new Error('session/move-target-missing')
        const previous = this.placements.get(id)
        const record: MoveJournal = { version: 1, id, target: targetId, previous, done: false }
        try {
          await this.writeRecord(this.movesDirectory!, record)
          this.moveRecords.set(id, record)
          const { events } = await handle.read()
          const change = events.findLast(event => event.type === 'working-directory/change')
          if ((change?.data?.cwd ?? handle.header.cwd) !== target.path) {
            await handle.append([{ type: 'working-directory/change', seq: events.length, time: Date.now(), data: { cwd: target.path } }])
            await handle.flush()
          }
          const source = this.workspace.list().find(entity => this.workspace.requireTable().get(entity.id)?.sessionIds.includes(id))
          if (source?.id !== targetId) await source?.detachSession(id)
          this.placements.set(id, targetId)
          try { await target.attachSession(id) } catch (error) {
            if (!this.workspace.requireTable().get(targetId)?.sessionIds.includes(id)) {
              if (previous === undefined) this.placements.delete(id)
              else this.placements.set(id, previous)
              // Preserve the old sidebar row when target accounting fails. The
              // durable intent lets a retry finish without duplicating events.
              await source?.attachSession(id)
            }
            throw error
          }
          const completed = { ...record, done: true }
          await this.writeRecord(this.movesDirectory!, completed)
          this.moveRecords.set(id, completed)
        } catch (error) {
          throw new Error('session/move-cleanup-pending', { cause: error })
        }
      })
    } finally { await handle.close() }
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
    wrap: (original: (...args: never[]) => unknown) => (...args: never[]) => unknown, reviewedWrapper?: string): void {
    const previous = Object.getOwnPropertyDescriptor(target, key)
    // Only the exact reviewed lifecycle wrappers may be layered. Unknown
    // extensions and another Bridge adapter still refuse, without replacing them.
    if (previous !== undefined && (reviewedWrapper === undefined || typeof previous.value !== 'function'
      || digest(previous.value.toString()) !== reviewedWrapper)) refuse('unsupported')
    let owner: object | null = target
    let descriptor: PropertyDescriptor | undefined = previous
    while (descriptor === undefined && (owner = Object.getPrototypeOf(owner)) !== null) {
      descriptor = Object.getOwnPropertyDescriptor(owner, key)
    }
    if (typeof descriptor?.value !== 'function') refuse('unsupported')
    const value = wrap(descriptor.value as (...args: never[]) => unknown)
    Object.defineProperty(target, key, { configurable: true, writable: true, enumerable: previous?.enumerable ?? false, value })
    this.restore.push(() => {
      if (Object.getOwnPropertyDescriptor(target, key)?.value !== value) return
      if (previous !== undefined) Object.defineProperty(target, key, previous)
      else Reflect.deleteProperty(target, key)
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
      listArtifacts(signal?: AbortSignal): Promise<{ header: Header }[]>
    }
    this.wrap(backend, 'listArtifacts', original => async function (this: Persistence, ...args: never[]) {
      const rows = await Reflect.apply(original, this, args) as { header: Header }[]
      const kept = await Promise.all(rows.map(async row => await adapter.record(row.header.id) ? undefined : row))
      return kept.filter(row => row !== undefined)
    })
    this.wrap(backend, 'open', original => {
      this.openWriter = id => Reflect.apply(original, backend, [id, 'write']) as Promise<MoveHandle>
      return async function (this: Persistence, id: string, ...args: never[]) {
        // Cold queue validation uses the Host's ordinary read-only observation
        // under the acquired writer lease. Once intent is recorded, hide it.
        if ((args[0] === 'write' && adapter.mutating.has(id)) || await adapter.record(id)) refuse('busy')
        if (args[0] === 'write' && adapter.moveRecords.get(id)?.done === false) throw new Error('session/move-cleanup-pending')
        return Reflect.apply(original, this, [id, ...args])
      }
    })
    this.wrap(backend, 'create', original => function (this: Persistence, header: Header, ...args: never[]) {
      const receiver = this
      return adapter.inLineage(async () => {
        if (adapter.closing || adapter.mutating.has(header.id) || await adapter.record(header.id)) refuse('busy')
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
        if ((key === 'resolve' || key === 'claim') && adapter.mutating.has(args[0]!)) refuse('busy')
        const claim = adapter.ownership.getStore()
        const movedClaim = claim?.active ? claim.movedClaim : undefined
        if (key === 'createMinted' && movedClaim && movedClaim.original === args[0]) {
          // The native claim may decline reuse. Its fresh Session must still
          // be created in the requested target, not at the old header path.
          return Reflect.apply(original, this, [movedClaim.target, ...args.slice(1)])
        }
        const token: Ownership = { active: true }
        return adapter.ownership.run(token, async () => {
          try {
            if (key === 'claim' && adapter.canMove) {
              const id: string = args[0]!
              const request = args[1]! as { cwd: string }
              const record = adapter.moveRecords.get(id)
              const workspace = record?.done ? adapter.workspace.get(record.target) : undefined
              if (workspace?.path === request.cwd && workspace.sessionIds.includes(id)) {
                const header = adapter.agents.get(id)?.session.header ?? (await adapter.persistence.stat(id))?.header
                if (header?.cwd !== undefined && header.cwd !== request.cwd) {
                  // Restoring an existing blank Session checks immutable cwd.
                  // Only a matching, durable target membership authorizes reuse.
                  token.movedClaim = { original: header.cwd, target: request.cwd }
                  return await Reflect.apply(original, this, [id, { ...request, cwd: header.cwd }])
                }
              }
            }
            return await Reflect.apply(original, this, args)
          } finally { token.active = false }
        })
      }, this.legacy && key !== 'fork' ? LEGACY.owner : undefined)
    }
    for (const key of ['create', 'resume'] as const) {
      this.wrap(this.agents as Agents & Record<typeof key, unknown>, key, original => async function (this: object, ...args: never[]) {
        const handle = await Reflect.apply(original, this, args) as AgentHandle
        if (adapter.ownership.getStore()?.active) adapter.handles.set(handle.agent.id, handle)
        return handle
      }, this.legacy ? LEGACY.registry : undefined)
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
      try {
        if (this.legacy && this.leaseClass === undefined) {
          const constructor = Object.getPrototypeOf(lease).constructor as LeaseClass
          if (digest(constructor.toString()) !== LEGACY.lease) refuse('unsupported')
          this.leaseClass = constructor
        }
        return await operation()
      } finally { await lease.release() }
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

  private async writeRecord(directory: string, record: Journal | MoveJournal): Promise<void> {
    const path = join(directory, digest(record.id) + '.json')
    const temporary = `${path}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(record)); await file.sync() } finally { await file.close() }
    try { await rename(temporary, path); await this.syncDirectory(directory) }
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
      if (this.legacy && entry.isFile() && ['session.lifecycle.lock', 'session.deleted'].includes(entry.name)) continue
      if (!entry.isFile() || (!/^session\.(?:v\d+\.jsonl(?:\.zstd)?|migration\.[\w-]+\.jsonl(?:\.zstd)?\.tmp)$/u.test(entry.name)
        && !(this.legacy && /^session\.deleted\.\d+\.[a-f0-9]{12}$/u.test(entry.name)))) {
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
    let lifecycle: Lease | undefined
    try {
      if (this.legacy) {
        lifecycle = await this.leaseClass!.acquire(directory, record.id, 'session.lifecycle.lock')
        await this.assertNoChildren(record.id)
      }
      lease = await this.persistence.acquireLease(record.id, undefined, directory)
      await this.cleanup(record, directory)
    } finally {
      try { await lease?.release() } finally {
        try { await lifecycle?.release() } finally { this.persistence.tracker.releaseClaim(record.id) }
      }
    }
  }

  private async cleanup(record: Journal, directory: string): Promise<void> {
    try {
      if (this.legacy) await this.persistence.writeDeletionTombstone!(directory, record.id)
      for (const path of await this.artifacts(directory)) await unlink(path)
      await this.syncDirectory(directory)
      this.persistence.coldLogMemo.delete(record.id)
      this.persistence.migrationPreparations.delete(record.id)
      if (this.legacy) {
        this.forgetHeader(record.id)
        // The legacy owner also clears durable move overrides and its journal.
        await this.workspace.detachSession!(record.id)
      } else await this.workspace.enqueueOperation(async () => {
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
      if (this.movesDirectory !== undefined && this.moveRecords.has(record.id)) {
        await unlink(join(this.movesDirectory, digest(record.id) + '.json')).catch(error => { if (!missing(error)) throw error })
        await this.syncDirectory(this.movesDirectory)
        this.moveRecords.delete(record.id)
        this.placements.delete(record.id)
      }
      await this.writeRecord(this.records, { ...record, done: true })
    } catch (error) {
      throw new Error('session/delete-cleanup-pending', { cause: error })
    }
  }

  private async assertNoChildren(id: string): Promise<void> {
    if ((await this.persistence.list()).some(row => row.header.parentSession === id)
      || this.agents.list().some(item => item.session.header.parentSession === id)) refuse('has-children')
  }

  /** The Host can retain a queue after its Agent goes cold. Never wake it here. */
  private async assertStoredIdle(id: string, kind: 'delete' | 'move'): Promise<void> {
    const observation = await this.query.observeSession(id)
    try {
      const inbox = observation.projections?.values.inbox
      if (inbox) {
        if (inbox['next-turn'].length || inbox['next-step'].length) throw new Error(`session/${kind}-active`)
      } else if (observation.events.some(event => event.type === 'agent/inbox/spliced')) {
        throw new Error(`session/${kind}-unsupported`)
      }
    } finally { observation[Symbol.dispose]() }
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
