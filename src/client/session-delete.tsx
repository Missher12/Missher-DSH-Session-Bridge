import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, MenuItemButton, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { SESSION_DELETE_PATH } from '../session-delete-wire.js'
import { en } from './locales.js'
import type { SessionBridgeKey } from './locales.js'
import type { SessionListReader } from './session-menu.js'

interface DeleteState {
  readonly sessionId: string
  readonly pending: boolean
  readonly done: boolean
  readonly error?: SessionBridgeKey
}

/** A failed probe is not evidence that the Host lacks the capability. */
export type SessionDeleteCapability = 'supported' | 'unsupported' | 'error'

/**
 * Ask the Host whether it exposes a permanent deletion transaction.
 * @param signal - menu-generation cancellation.
 * @param send - fetch-compatible transport.
 * @returns capability, or `error` when the probe itself failed.
 */
export async function readSessionDeleteCapability(signal: AbortSignal, send = fetch): Promise<SessionDeleteCapability> {
  const response = await send(SESSION_DELETE_PATH.slice(1), {
    credentials: 'same-origin', cache: 'no-store', signal,
  })
  if (response.status === 501) return 'unsupported'
  if (!response.ok) return 'error'
  const result: unknown = await response.json()
  if (result === null || typeof result !== 'object' || !('supported' in result)) return 'error'
  return result.supported === true ? 'supported' : result.supported === false ? 'unsupported' : 'error'
}

/**
 * Deletion is sent only by `confirm()`, never by the menu's `request()`.
 * @param send - fetch-compatible transport.
 * @param onDeleted - optional refresh hook run after the Host confirms deletion.
 */
export function createSessionDeleteActions(send: typeof fetch = fetch, onDeleted?: () => void) {
  const listeners = new Set<() => void>()
  let state: DeleteState | null = null
  let disposed = false
  const publish = (next: DeleteState | null): void => {
    if (disposed) return
    state = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    request(sessionId: string) {
      if (disposed || state?.pending || sessionId.length === 0) return
      publish({ sessionId, pending: false, done: false })
    },
    dismiss() { if (!state?.pending) publish(null) },
    dispose() { disposed = true; listeners.clear(); state = null },
    async confirm(): Promise<void> {
      if (disposed || state === null || state.pending || state.done || state.error === 'delete.unsupported') return
      const { sessionId } = state
      publish({ sessionId, pending: true, done: false })
      try {
        const response = await send(SESSION_DELETE_PATH.slice(1), {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, confirmed: true }),
        })
        // Capability can disappear between opening the menu and confirming.
        // A 501 remains explicit even when an older Host returns a text body.
        if (response.status === 501) {
          publish({ sessionId, pending: false, done: false, error: 'delete.unsupported' })
          return
        }
        const result = await response.json() as { ok?: boolean; value?: { sessionId?: string }; error?: { code?: string } }
        if (!response.ok || result.ok !== true || result.value?.sessionId !== sessionId) {
          const key: SessionBridgeKey = (result.error?.code === 'session/delete-not-archived'
            ? 'delete.notArchived'
            : ({
              'session/delete-unsupported': 'delete.unsupported',
              'session/delete-active': 'delete.busy',
              'session/delete-owned': 'delete.busy',
              'session/delete-busy': 'delete.busy',
              'session/delete-has-children': 'delete.children',
              'session/delete-not-found': 'delete.notFound',
            } as Record<string, SessionBridgeKey>)[result.error?.code ?? '']) ?? 'delete.failed'
          publish({ sessionId, pending: false, done: false, error: key })
          return
        }
        publish({ sessionId, pending: false, done: true })
        try { onDeleted?.() } catch { /* a refresh failure must not undo a committed deletion */ }
      } catch { publish({ sessionId, pending: false, done: false, error: 'delete.failed' }) }
    },
  }
}

type DeleteActions = ReturnType<typeof createSessionDeleteActions>
type Translate = (key: SessionBridgeKey) => string

/** One menu occurrence: any Session, including archived and ordinary rows. */
export function SessionDeleteMenuItem({ sessionId, sessions, deleteActions, useMenuOpenState, t }: {
  sessionId: string; sessions: SessionListReader; deleteActions: DeleteActions
  useMenuOpenState: () => readonly [boolean, (open: boolean) => void]; t?: Translate
}) {
  const [menuOpen, setMenuOpen] = useMenuOpenState()
  const [capability, setCapability] = useState<{
    sessionId: string; status: SessionDeleteCapability | 'checking'
  }>({ sessionId, status: 'checking' })
  useEffect(() => {
    setCapability({ sessionId, status: 'checking' })
    if (!menuOpen) return
    const abort = new AbortController()
    const timeout = setTimeout(() => {
      setCapability({ sessionId, status: 'error' })
      abort.abort()
    }, 10_000)
    void readSessionDeleteCapability(abort.signal)
      .then(status => { if (!abort.signal.aborted) setCapability({ sessionId, status }) })
      .catch(() => { if (!abort.signal.aborted) setCapability({ sessionId, status: 'error' }) })
      .finally(() => { clearTimeout(timeout) })
    return () => { clearTimeout(timeout); abort.abort() }
  }, [menuOpen, sessionId])
  const status = capability.sessionId === sessionId ? capability.status : 'checking'
  const running = sessions.list.getSnapshot().byId[sessionId]?.running === true
  const tr = t ?? ((key: SessionBridgeKey) => en[key])
  const supported = status === 'supported'
  const reason: SessionBridgeKey = running ? 'delete.running'
    : status === 'unsupported' ? 'delete.unsupported'
      : status === 'error' ? 'delete.checkFailed' : 'delete.checking'
  const blocked = running || !supported
  return <>
    <MenuItemButton danger separatorBefore disabled={blocked} onSelect={() => {
      setMenuOpen(false)
      deleteActions.request(sessionId)
    }}>{tr('delete.action')}</MenuItemButton>
    {blocked && <div className="dsh-sb-deleteHint" role="note">{tr(reason)}</div>}
  </>
}

export function SessionDeleteDialog({ deleteActions, t }: { deleteActions: DeleteActions; t?: Translate }) {
  const state = useSyncExternalStore(deleteActions.subscribe, deleteActions.getSnapshot)
  const tr = t ?? ((key: SessionBridgeKey) => en[key])
  if (state === null) return null
  if (state.done) return <Toast text={tr('delete.done')} tone="success" onDone={deleteActions.dismiss} />
  return <Modal open title={tr('delete.title')} closeLabel={tr('panel.close')}
    description={tr('delete.description')} onClose={deleteActions.dismiss}
    footer={<>
      <Button variant="outline" disabled={state.pending} data-modal-autofocus onClick={deleteActions.dismiss}>{tr('picker.cancel')}</Button>
      <Button variant="primary" disabled={state.pending || state.error === 'delete.unsupported'} onClick={() => { void deleteActions.confirm() }}>
        {tr(state.pending ? 'delete.pending' : 'delete.confirm')}
      </Button>
    </>}>
    <code>{state.sessionId}</code>
    {state.error !== undefined && <p role="alert">{tr(state.error)}</p>}
  </Modal>
}
