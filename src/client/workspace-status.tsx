import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorkspaceMoveSource } from './session-move.js'

/** One session's live status facts, as published by the installed `uiSession` service. */
export interface WorkspaceSessionStatus {
  readonly running?: boolean
  readonly pendingInteraction?: unknown
  readonly completionUnread?: boolean
}

/** Subagent catalog row used to fold child activity into its owning Session once. */
interface SubagentRow {
  readonly id: string
}

/** The slice of the installed Session list snapshot this badge reads. */
export interface WorkspaceStatusList {
  readonly phase?: 'pending' | 'ready' | 'error'
  readonly byId?: Readonly<Record<string, { readonly running?: boolean }>>
  readonly ids?: readonly string[]
  readonly projectionsBySession?: Readonly<Record<string, {
    readonly values?: { readonly subagentCatalog?: readonly SubagentRow[] }
  }>>
}

/** Aggregate facts for one Workspace. `unknown` is never rendered as idle/zero. */
export interface WorkspaceStatusCounts {
  readonly unknown?: true
  readonly pending: number
  readonly running: number
  readonly completed: number
}

/** Only these interaction kinds count as a user-visible wait in the native tree. */
const PENDING_KINDS = new Set(['approval', 'plan-review', 'question'])

function pendingValue(status: WorkspaceSessionStatus | undefined): boolean {
  const kind = (status?.pendingInteraction as { kind?: unknown } | undefined)?.kind
  return typeof kind === 'string' && PENDING_KINDS.has(kind)
}

function childIdsOf(id: string, list: WorkspaceStatusList): readonly string[] {
  return list.projectionsBySession?.[id]?.values?.subagentCatalog?.map(child => child.id) ?? []
}

function hasPending(id: string, status: WorkspaceSessionStatus | undefined, list: WorkspaceStatusList, statuses: ReadonlyMap<string, WorkspaceSessionStatus>): boolean {
  if (pendingValue(status)) return true
  return childIdsOf(id, list).some(child => pendingValue(statuses.get(child)))
}

function hasRunning(
  id: string,
  status: WorkspaceSessionStatus | undefined,
  summary: { readonly running?: boolean } | undefined,
  list: WorkspaceStatusList,
  statuses: ReadonlyMap<string, WorkspaceSessionStatus>,
): boolean {
  const self = status?.running ?? summary?.running ?? false
  const childRunning = childIdsOf(id, list).some(child => {
    const childStatus = statuses.get(child)
    return !hasPending(child, childStatus, list, statuses)
      && (childStatus?.running ?? list.byId?.[child]?.running) === true
  })
  if (childRunning) return true
  return self
}

/**
 * Aggregate all Workspace members, not only rendered/expanded rows.
 *
 * A child Session that is also a member is folded into its in-workspace parent
 * once. A member with a waiting interaction is not also counted as running for
 * its own status, but a running child keeps a working count; other members run
 * independently. `completedIds` is the event-validated successful subset of
 * the Host's `completionUnread` set, never an inference from `running=false`.
 * @param memberIds - every Session id accounted to the Workspace.
 * @param statuses - installed `uiSession` status snapshot.
 * @param list - installed Session list snapshot.
 * @param completedIds - sessions whose last turn ended with `completed`.
 * @param connected - connection generation is present and the list is ready.
 * @returns counts, or unknown when the connection or list is not synchronized.
 */
export function aggregateWorkspaceStatus(
  memberIds: readonly string[],
  statuses: ReadonlyMap<string, WorkspaceSessionStatus>,
  list: WorkspaceStatusList,
  completedIds: ReadonlySet<string> = new Set(),
  connected = true,
): WorkspaceStatusCounts {
  if (!connected || list.phase !== 'ready') return { unknown: true, pending: 0, running: 0, completed: 0 }
  const members = new Set(memberIds)
  const childOwner = new Map<string, string>()
  for (const id of memberIds) for (const child of childIdsOf(id, list)) childOwner.set(child, id)
  let pending = 0
  let running = 0
  let completed = 0
  for (const id of memberIds) {
    if (childOwner.has(id) && members.has(childOwner.get(id) as string)) continue
    const summary = list.byId?.[id]
    if (summary === undefined) return { unknown: true, pending: 0, running: 0, completed: 0 }
    const status = statuses.get(id)
    const memberPending = hasPending(id, status, list, statuses)
    const memberRunning = hasRunning(id, status, summary, list, statuses)
    if (memberPending) pending += 1
    if (memberRunning && !(memberPending && !childIdsOf(id, list).some(child => {
      const childStatus = statuses.get(child)
      return !hasPending(child, childStatus, list, statuses)
        && (childStatus?.running ?? list.byId?.[child]?.running) === true
    }))) running += 1
    if (!memberPending && !memberRunning && status?.completionUnread === true
      && completedIds.has(id)) completed += 1
  }
  return { pending, running, completed }
}

type StatusSource = {
  getSnapshot(): ReadonlyMap<string, WorkspaceSessionStatus>
  subscribe(listener: () => void): () => void
}

type ConnectionSource = {
  readonly generation: {
    getSnapshot(): unknown
    subscribe(listener: () => void): () => void
  }
}

type RemoteEventSource = {
  readonly session?: {
    events(request: {
      readonly address: { readonly kind: 'session', readonly sessionId: string }
      readonly maxMessages?: number
    }, signal?: AbortSignal): Promise<{
      readonly ok: true
      readonly value: {
        readonly records?: readonly { readonly type?: string, readonly event?: { readonly type?: string, readonly data?: { readonly reason?: { readonly kind?: string } } } }[]
      }
    } | { readonly ok: false, readonly error?: unknown }>
  }
}

/** Everything the workspace badge renderer needs from the installed client root. */
export interface WorkspaceStatusInjected {
  readonly sessions: { readonly list: { getSnapshot(): WorkspaceStatusList, subscribe(listener: () => void): () => void } }
  readonly workspaces: WorkspaceMoveSource
  readonly uiSession: { readonly sessionStatus: StatusSource }
  readonly connection: ConnectionSource
  readonly remote?: RemoteEventSource
}

const PILLS = {
  pending: ['dsh-sb-ws-item dsh-sb-ws-pending', '等你处理'],
  running: ['dsh-sb-ws-item dsh-sb-ws-running', '工作中'],
  completed: ['dsh-sb-ws-item dsh-sb-ws-completed', '已完成'],
  idle: ['dsh-sb-ws-item dsh-sb-ws-idle', '空闲'],
  unknown: ['dsh-sb-ws-item dsh-sb-ws-unknown', '状态未知'],
} as const

function pills(counts: WorkspaceStatusCounts): ReadonlyArray<readonly [string, string]> {
  if (counts.unknown === true) return [PILLS.unknown]
  const result: Array<readonly [string, string]> = []
  if (counts.pending > 0) result.push([PILLS.pending[0], `${PILLS.pending[1]} · ${counts.pending}`])
  if (counts.running > 0) result.push([PILLS.running[0], `${PILLS.running[1]} · ${counts.running}`])
  if (result.length === 0 && counts.completed > 0) result.push(PILLS.completed)
  return result.length === 0 ? [PILLS.idle] : result
}

function findStatusNode(row: HTMLElement): HTMLElement | undefined {
  return [...row.children].find(child => child.classList?.contains('dsh-sb-ws-status')) as HTMLElement | undefined
}

function renderNode(row: HTMLElement, label: ReadonlyArray<readonly [string, string]>): void {
  const signature = label.map(([tone, text]) => `${tone}:${text}`).join('|')
  const existing = findStatusNode(row)
  if (existing?.dataset.signature === signature) return
  const node = existing ?? document.createElement('span')
  node.className = 'dsh-sb-ws-status'
  node.dataset.signature = signature
  node.setAttribute('role', 'status')
  node.setAttribute('aria-live', 'polite')
  node.replaceChildren(...label.map(([tone, text]) => {
    const item = document.createElement('span')
    item.className = tone
    const dot = document.createElement('span')
    dot.className = 'dsh-sb-ws-dot'
    dot.setAttribute('aria-hidden', 'true')
    item.append(dot, document.createTextNode(text))
    return item
  }))
  if (existing === undefined) row.append(node)
}

type HistoryRecord = { readonly type?: string, readonly event?: { readonly type?: string, readonly data?: { readonly reason?: { readonly kind?: string } } } }

/**
 * A completion candidate is green only when the durable last turn ended with
 * reason `completed`; aborted/error/blocked/interrupted/forked/max-tokens are
 * not successful completion.
 * @param records - one Session history page.
 * @returns whether the latest turn/end reason is completed.
 */
export function completionSucceeded(records: readonly HistoryRecord[]): boolean {
  const end = records.findLast(record => (record.event?.type ?? record.type) === 'turn/end')
  return end?.event?.data?.reason?.kind === 'completed'
}

/** Validate one completion candidate against the durable `turn/end` reason. */
async function successfulTurn(remote: RemoteEventSource | undefined, sessionId: string, signal: AbortSignal): Promise<boolean> {
  if (remote?.session?.events === undefined) return false
  try {
    const result = await remote.session.events({ address: { kind: 'session', sessionId }, maxMessages: 8 }, signal)
    if (!result.ok) return false
    return completionSucceeded(result.value.records ?? [])
  } catch {
    return false
  }
}

/**
 * Render the workspace activity badge into the native Workspace headers.
 *
 * The sidebar has no workspace-row decoration slot, so this keeps the native
 * tree untouched and owns only one extra span per row. A MutationObserver
 * restores that span after a native re-render; status updates still come from
 * the installed stores, never from expanded/visible rows.
 * @param props - installed client stores, connection generation and error/event channel.
 * @returns null; the owned DOM spans are the visible output.
 */
export function WorkspaceStatusOverlay({ sessions, workspaces, uiSession, connection, remote }: WorkspaceStatusInjected) {
  const list = useSyncExternalStore(
    useCallback(listener => sessions.list.subscribe(listener), [sessions]),
    useCallback(() => sessions.list.getSnapshot(), [sessions]),
  )
  const statuses = useSyncExternalStore(
    useCallback(listener => uiSession.sessionStatus.subscribe(listener), [uiSession]),
    useCallback(() => uiSession.sessionStatus.getSnapshot(), [uiSession]),
  )
  // Some Host store snapshots are rebuilt per read; subscribe manually so the
  // badge does not trip React's getSnapshot stability check.
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState(() => workspaces.getSnapshot())
  useEffect(() => {
    setWorkspaceSnapshot(workspaces.getSnapshot())
    return workspaces.subscribe(() => setWorkspaceSnapshot(workspaces.getSnapshot()))
  }, [workspaces])
  const generation = useSyncExternalStore(
    useCallback(listener => connection.generation.subscribe(listener), [connection]),
    useCallback(() => connection.generation.getSnapshot(), [connection]),
  )
  const connected = generation !== undefined
  const attempted = useRef(new Map<string, { token: object, controller: AbortController }>())
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set())

  // A connection generation change invalidates every in-flight validation.
  useEffect(() => {
    for (const { controller } of attempted.current.values()) controller.abort()
    attempted.current.clear()
    setCompleted(new Set())
  }, [generation])

  // Prune only candidates that are no longer unread/running. Other sessions'
  // status updates must not cancel an in-flight candidate.
  useEffect(() => {
    for (const [id, entry] of attempted.current) {
      const status = statuses.get(id)
      if (status?.completionUnread !== true || status?.running === true) {
        entry.controller.abort()
        attempted.current.delete(id)
      }
    }
    setCompleted(previous => {
      let changed = false
      const next = new Set(previous)
      for (const id of previous) {
        const status = statuses.get(id)
        if (status?.completionUnread !== true || status?.running === true) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [statuses])

  useEffect(() => {
    if (!connected) return
    for (const [id, status] of statuses) {
      if (status.completionUnread !== true || status.running === true || attempted.current.has(id)) continue
      const token = {}
      const controller = new AbortController()
      attempted.current.set(id, { token, controller })
      void successfulTurn(remote, id, controller.signal).then(ok => {
        const current = attempted.current.get(id)
        const latest = statusesRef.current.get(id)
        if (current?.token !== token || latest?.completionUnread !== true || latest?.running === true) return
        if (ok) setCompleted(previous => previous.has(id) ? previous : new Set([...previous, id]))
      })
    }
  }, [statuses, connected, remote, generation])

  useEffect(() => () => {
    for (const { controller } of attempted.current.values()) controller.abort()
    attempted.current.clear()
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const accounted = new Set(workspaceSnapshot.items.flatMap(workspace => workspace.sessionIds ?? []))
    const rows = new Map<string, readonly string[]>()
    for (const workspace of workspaceSnapshot.items) rows.set(workspace.workspaceId, workspace.sessionIds ?? [])
    const stray = (list.ids ?? []).filter(id => !accounted.has(id))
    if (stray.length > 0) rows.set('', stray)

    const update = (): void => {
      for (const row of document.querySelectorAll<HTMLElement>('[data-row-key^="workspace:"]')) {
        const id = row.getAttribute('data-row-key')?.slice('workspace:'.length) ?? ''
        const members = rows.get(id)
        if (members === undefined) {
          findStatusNode(row)?.remove()
          continue
        }
        renderNode(row, pills(aggregateWorkspaceStatus(members, statuses, list, completed, connected)))
      }
      for (const node of document.querySelectorAll<HTMLElement>('.dsh-sb-ws-status')) {
        const row = node.parentElement
        const id = row?.getAttribute('data-row-key')?.slice('workspace:'.length) ?? ''
        if (row === null || !row.hasAttribute('data-row-key') || !rows.has(id)) node.remove()
      }
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const node of document.querySelectorAll<HTMLElement>('.dsh-sb-ws-status')) node.remove()
    }
  }, [list, statuses, workspaceSnapshot, completed, connected])

  return null
}
