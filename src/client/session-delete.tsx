import { useSyncExternalStore } from 'react'
import { Button, MenuItemButton, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { SESSION_DELETE_PATH } from '../session-delete-wire.js'
import { en } from './locales.js'
import type { SessionBridgeKey } from './locales.js'

/** Host-authoritative archive membership; subscribing never opens a session. */
export interface ArchiveSource {
  getSnapshot(): { readonly archivedSessionIds: readonly string[] }
  subscribe(listener: () => void): () => void
}
interface DeleteState {
  readonly sessionId: string
  readonly pending: boolean
  readonly done: boolean
  readonly error?: SessionBridgeKey
}

/** Deletion is sent only by confirm(), never by the menu's request(). */
export function createSessionDeleteActions(archive: ArchiveSource, send = fetch) {
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
      if (disposed || state?.pending || !archive.getSnapshot().archivedSessionIds.includes(sessionId)) return
      publish({ sessionId, pending: false, done: false })
    },
    dismiss() { if (!state?.pending) publish(null) },
    dispose() { disposed = true; listeners.clear(); state = null },
    async confirm(): Promise<void> {
      if (disposed || state === null || state.pending || state.done) return
      const { sessionId } = state
      if (!archive.getSnapshot().archivedSessionIds.includes(sessionId)) {
        publish({ sessionId, pending: false, done: false, error: 'delete.notArchived' })
        return
      }
      publish({ sessionId, pending: true, done: false })
      try {
        const response = await send(SESSION_DELETE_PATH.slice(1), {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, confirmed: true }),
        })
        const result = await response.json() as { ok?: boolean; value?: { sessionId?: string }; error?: { code?: string } }
        if (!response.ok || result.ok !== true || result.value?.sessionId !== sessionId) {
          const key: SessionBridgeKey = ({
            'session/delete-unsupported': 'delete.unsupported',
            'session/delete-not-archived': 'delete.notArchived',
            'session/delete-active': 'delete.busy',
            'session/delete-owned': 'delete.busy',
            'session/delete-busy': 'delete.busy',
            'session/delete-has-children': 'delete.children',
          } as Record<string, SessionBridgeKey>)[result.error?.code ?? ''] ?? 'delete.failed'
          publish({ sessionId, pending: false, done: false, error: key })
          return
        }
        publish({ sessionId, pending: false, done: true })
      } catch { publish({ sessionId, pending: false, done: false, error: 'delete.failed' }) }
    },
  }
}

type DeleteActions = ReturnType<typeof createSessionDeleteActions>
type Translate = (key: SessionBridgeKey) => string

export function SessionDeleteMenuItem({ sessionId, archive, deleteActions, useMenuOpenState, t }: {
  sessionId: string; archive: ArchiveSource; deleteActions: DeleteActions
  useMenuOpenState: () => readonly [boolean, (open: boolean) => void]; t?: Translate
}) {
  const [, setMenuOpen] = useMenuOpenState()
  const snapshot = useSyncExternalStore(archive.subscribe, archive.getSnapshot)
  if (!snapshot.archivedSessionIds.includes(sessionId)) return null
  return <MenuItemButton danger separatorBefore onSelect={() => {
    setMenuOpen(false)
    deleteActions.request(sessionId)
  }}>{t === undefined ? en['delete.action'] : t('delete.action')}</MenuItemButton>
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
      <Button variant="primary" disabled={state.pending} onClick={() => { void deleteActions.confirm() }}>
        {tr(state.pending ? 'delete.pending' : 'delete.confirm')}
      </Button>
    </>}>
    <code>{state.sessionId}</code>
    {state.error !== undefined && <p role="alert">{tr(state.error)}</p>}
  </Modal>
}
