import { useSyncExternalStore } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { SESSION_MOVE_PATH } from '../session-move-wire.js'
import { en } from './locales.js'
import type { SessionBridgeKey } from './locales.js'

/** One Workspace as the client store exposes it for drag targeting. */
export interface MoveWorkspace {
  readonly workspaceId: string
  readonly title: string
  readonly path?: string
  readonly sessionIds?: readonly string[]
}

/** The client workspace store slice a drag move needs. */
export interface WorkspaceMoveSource {
  getSnapshot(): { readonly items: readonly MoveWorkspace[] }
  subscribe(listener: () => void): () => void
}

type MovePhase = 'pending' | 'done' | 'error'

interface MoveState {
  readonly sessionId: string
  readonly targetWorkspaceId: string
  readonly phase: MovePhase
  readonly error?: SessionBridgeKey
}

/** Map a Host refusal code to the one localized reason the toast shows. */
function moveErrorKey(code: string | undefined): SessionBridgeKey {
  return ({
    'session/move-unsupported': 'move.unsupported',
    'session/move-active': 'move.active',
    'session/move-busy': 'move.busy',
    'session/move-same-workspace': 'move.same',
    'session/move-target-missing': 'move.targetMissing',
    'session/move-not-found': 'move.failed',
  } as Record<string, SessionBridgeKey>)[code ?? ''] ?? 'move.failed'
}

/**
 * One drag move at a time. The drag installer calls `moveTo` only after a
 * target Workspace row accepted the drop; dismissal/refusal never retries.
 * @param send - fetch-compatible transport.
 * @param onMoved - optional refresh hook run after the Host confirms the move.
 */
export function createSessionMoveActions(send: typeof fetch = fetch, onMoved?: () => void) {
  const listeners = new Set<() => void>()
  let state: MoveState | null = null
  let disposed = false
  const publish = (next: MoveState | null): void => {
    if (disposed) return
    state = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dismiss() { if (state?.phase !== 'pending') publish(null) },
    dispose() { disposed = true; listeners.clear(); state = null },
    async moveTo(sessionId: string, targetWorkspaceId: string): Promise<void> {
      if (disposed || state?.phase === 'pending' || sessionId.length === 0 || targetWorkspaceId.length === 0) return
      publish({ sessionId, targetWorkspaceId, phase: 'pending' })
      try {
        const response = await send(SESSION_MOVE_PATH.slice(1), {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, targetWorkspaceId, confirmed: true }),
        })
        if (response.status === 501) {
          publish({ sessionId, targetWorkspaceId, phase: 'error', error: 'move.unsupported' })
          return
        }
        const result = await response.json() as {
          ok?: boolean
          value?: { sessionId?: string; targetWorkspaceId?: string }
          error?: { code?: string }
        }
        if (!response.ok || result.ok !== true || result.value?.sessionId !== sessionId
          || result.value.targetWorkspaceId !== targetWorkspaceId) {
          publish({ sessionId, targetWorkspaceId, phase: 'error', error: moveErrorKey(result.error?.code) })
          return
        }
        publish({ sessionId, targetWorkspaceId, phase: 'done' })
        try { onMoved?.() } catch { /* a refresh failure must not undo a committed move */ }
      } catch {
        publish({ sessionId, targetWorkspaceId, phase: 'error', error: 'move.failed' })
      }
    },
  }
}

type MoveActions = ReturnType<typeof createSessionMoveActions>
type Translate = (key: SessionBridgeKey) => string

/** Success/refusal feedback for a drag move; pending is transient. */
export function SessionMoveToast({ moveActions, t }: { moveActions: MoveActions, t?: Translate }) {
  const state = useSyncExternalStore(moveActions.subscribe, moveActions.getSnapshot)
  const tr = t ?? ((key: SessionBridgeKey) => en[key])
  if (state === null) return null
  const key = `${state.phase}-${state.sessionId}-${state.targetWorkspaceId}`
  if (state.phase === 'pending') {
    return <Toast key={key} text={tr('move.pending')} holdMs={6000} onDone={() => {}} />
  }
  if (state.phase === 'done') {
    return <Toast key={key} text={tr('move.done')} tone="success" onDone={moveActions.dismiss} />
  }
  return <Toast key={key} text={tr(state.error ?? 'move.failed')} holdMs={6000} onDone={moveActions.dismiss} />
}
