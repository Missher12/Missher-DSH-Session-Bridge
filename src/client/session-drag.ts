import type { MoveWorkspace, WorkspaceMoveSource } from './session-move.js'
import type { createSessionMoveActions } from './session-move.js'

type MoveActions = ReturnType<typeof createSessionMoveActions>
type DropTarget = { readonly id: string, readonly row: HTMLElement, readonly kind: 'workspace' | 'session' }

const SESSION_ROW = '[data-row-key^="session:"]'
const WORKSPACE_ROW = '[data-row-key^="workspace:"]'
const DROP_CLASS = 'dsh-sb-drop-target'

function rowKey(element: Element | null, prefix: string): string | undefined {
  const key = element?.closest(`[data-row-key^="${prefix}"]`)?.getAttribute('data-row-key')
  return key?.startsWith(prefix) === true ? key.slice(prefix.length) : undefined
}

/**
 * Add cross-workspace Session drag on top of the native sidebar.
 *
 * Native rows keep their own dragover/drop/reorder state. A cross-workspace
 * drop is intercepted before that state can commit, and the native hover target
 * is reset to the dragged row itself so the following native `dragend` clears
 * its state without committing a stale same-group order. Same-workspace session
 * drops are left entirely to the native reorder path.
 * @param actions - the one move transaction shared by all drops.
 * @param workspaces - live Workspace membership used to classify targets.
 * @returns disposer removing every listener and highlight.
 */
export function installSessionDrag(actions: MoveActions, workspaces: WorkspaceMoveSource): () => void {
  // Unit harnesses may mount the client without a DOM; production always has one.
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
  let dragged: { sessionId: string, sourceWorkspaceId?: string, element: HTMLElement } | null = null
  let highlighted: HTMLElement | null = null

  const items = (): readonly MoveWorkspace[] => workspaces.getSnapshot().items
  const clearHighlight = (): void => {
    highlighted?.classList.remove(DROP_CLASS)
    highlighted = null
  }
  const target = (event: Event): DropTarget | undefined => {
    const element = event.target instanceof Element ? event.target : null
    const workspaceRow = element?.closest(WORKSPACE_ROW) as HTMLElement | null
    if (workspaceRow !== null) {
      const id = rowKey(workspaceRow, 'workspace:')
      if (id !== undefined && items().some(workspace => workspace.workspaceId === id)) {
        return { id, row: workspaceRow, kind: 'workspace' }
      }
    }
    const sessionRow = element?.closest(SESSION_ROW) as HTMLElement | null
    const sessionId = rowKey(sessionRow, 'session:')
    const owner = sessionId === undefined ? undefined : items().find(w => w.sessionIds?.includes(sessionId))
    return sessionRow !== null && owner !== undefined
      ? { id: owner.workspaceId, row: sessionRow, kind: 'session' }
      : undefined
  }
  const resetNativeHover = (active: NonNullable<typeof dragged>, event: Event): void => {
    const transfer = (event as DragEvent).dataTransfer
    if (transfer === null || !active.element.isConnected) return
    const rect = active.element.getBoundingClientRect()
    const synthetic = active.element.ownerDocument.createEvent('Event')
    synthetic.initEvent('dragover', true, true)
    Object.defineProperty(synthetic, 'dataTransfer', { value: transfer })
    Object.defineProperty(synthetic, 'clientY', { value: rect.top + 1 })
    Object.defineProperty(synthetic, 'clientX', { value: rect.left + 1 })
    active.element.dispatchEvent(synthetic)
  }
  const onDragStart = (event: Event): void => {
    const element = event.target instanceof Element ? event.target : null
    const sessionId = rowKey(element, 'session:')
    const row = element?.closest(SESSION_ROW) as HTMLElement | null
    if (sessionId === undefined || row === null) return
    const sourceWorkspaceId = items().find(workspace => workspace.sessionIds?.includes(sessionId))?.workspaceId
    dragged = { sessionId, sourceWorkspaceId, element: row }
  }
  const onDragOver = (event: Event): void => {
    if (dragged === null) return
    const found = target(event)
    if (found === undefined || found.id === dragged.sourceWorkspaceId) {
      clearHighlight()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const transfer = (event as DragEvent).dataTransfer
    if (transfer !== null) transfer.dropEffect = 'move'
    if (highlighted !== found.row) {
      clearHighlight()
      highlighted = found.row
      highlighted.classList.add(DROP_CLASS)
    }
  }
  const onDrop = (event: Event): void => {
    if (dragged === null) return
    const found = target(event)
    const active = dragged
    dragged = null
    clearHighlight()
    if (found === undefined) return
    if (found.id === active.sourceWorkspaceId) {
      // Dropping on the same Workspace header is not a native reorder gesture;
      // reset the native hover so dragend clears instead of committing it.
      if (found.kind === 'workspace') resetNativeHover(active, event)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    resetNativeHover(active, event)
    void actions.moveTo(active.sessionId, found.id)
  }
  const onDragEnd = (): void => {
    dragged = null
    clearHighlight()
  }
  document.addEventListener('dragstart', onDragStart, true)
  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('drop', onDrop, true)
  document.addEventListener('dragend', onDragEnd, true)
  return () => {
    document.removeEventListener('dragstart', onDragStart, true)
    document.removeEventListener('dragover', onDragOver, true)
    document.removeEventListener('drop', onDrop, true)
    document.removeEventListener('dragend', onDragEnd, true)
    onDragEnd()
  }
}
