/** Sidebar copy actions and a notice that survives the row menu closing. */
import { useSyncExternalStore } from 'react'
import { IconCopyOutlineRegular, IconFolderCloseRegular, IconLinkOutlineRegular, MenuItemButton, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { copyPayload, writeClipboard } from './clipboard.js'
import type { CopyOutcome, CopyPayload } from './clipboard.js'
import { en } from './locales.js'
import type { SessionBridgeKey } from './locales.js'

export type SessionCopyKind = CopyPayload['key']

/** The global summary list reads metadata without activating a Session. */
export interface SessionListReader {
  readonly list: {
    getSnapshot(): {
      readonly byId: Readonly<Record<string, {
        readonly cwd?: string
        readonly projectionValues?: { readonly workingDirectory?: string }
        readonly running?: boolean
      } | undefined>>
    }
  }
  /** Refresh the Host-backed summaries; optional on older Hosts. */
  refresh?(): void
}

/** The Host's read-only session projection RPC, when mounted. */
export interface SessionProjectionReader {
  projections?(request: { sessionId: string }, signal: AbortSignal): Promise<{
    readonly ok: boolean
    readonly value?: { readonly kind: string; readonly values: { readonly workingDirectory?: string } } | null
  }>
}

async function currentDirectory(sessions: SessionListReader, sessionId: string, remote?: SessionProjectionReader) {
  const row = sessions.list.getSnapshot().byId[sessionId]
  if (typeof remote?.projections !== 'function') return row?.projectionValues?.workingDirectory || row?.cwd
  const result = await remote.projections({ sessionId }, AbortSignal.timeout(10_000))
  if (!result.ok || result.value?.kind !== 'sequenced') return undefined
  return result.value.values.workingDirectory || row?.cwd
}

interface CopyNotice {
  readonly sequence: number
  readonly key: SessionBridgeKey
  readonly success: boolean
}

/** One plugin lifetime's copy actions and notification subscriptions. */
export function createSessionCopyActions(
  sessions: SessionListReader,
  write: (value: string) => Promise<CopyOutcome> = writeClipboard,
  getRemote?: () => SessionProjectionReader | undefined,
) {
  const listeners = new Set<() => void>()
  let notice: CopyNotice | null = null
  let sequence = 0
  let disposed = false
  const publish = (value: CopyNotice | null): void => {
    if (disposed) return
    notice = value
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => notice,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dismiss: () => { publish(null) },
    dispose() { disposed = true; listeners.clear(); notice = null },
    async copy(kind: SessionCopyKind, sessionId: string): Promise<void> {
      if (disposed) return
      const request = ++sequence
      let cwd: string | undefined
      if (kind === 'cwd') {
        try { cwd = await currentDirectory(sessions, sessionId, getRemote?.()) }
        catch { /* A failed current lookup must not copy a stale path. */ }
        if (disposed || request !== sequence) return
      }
      const payload = copyPayload(kind, sessionId, cwd)
      if (payload === undefined) {
        publish({ sequence: request, key: 'menu.cwdUnavailable', success: false })
        return
      }
      const success = await write(payload.text).then(outcome => outcome === 'copied', () => false)
      if (request === sequence) publish({ sequence: request, key: success ? 'chip.copied' : 'chip.failed', success })
    },
  }
}

type CopyActions = ReturnType<typeof createSessionCopyActions>
type Translate = (key: SessionBridgeKey) => string

/** Separate all copy actions, including the Host's preferred ID entry. */
export function SessionCopyMenuSeparator() {
  return <div className="dsh-sb-menuSeparator" role="separator" />
}

/** Each occurrence copies its own row identity, including archived rows. */
export function SessionCopyMenuItem({ sessionId, kind, copyReference, useMenuOpenState, t }: {
  readonly sessionId: string
  readonly kind: SessionCopyKind
  readonly copyReference: CopyActions['copy']
  readonly useMenuOpenState: () => readonly [boolean, (open: boolean) => void]
  readonly t?: Translate
}) {
  const [, setMenuOpen] = useMenuOpenState()
  const key = ({ id: 'chip.copy', cwd: 'menu.copyCwd', bridge: 'menu.copyBridge' } as const)[kind]
  const Icon = { id: IconCopyOutlineRegular, cwd: IconFolderCloseRegular, bridge: IconLinkOutlineRegular }[kind]
  return (
    <MenuItemButton icon={<Icon />} onSelect={() => {
      // Start within the click's clipboard activation before dismissing the menu.
      void copyReference(kind, sessionId)
      setMenuOpen(false)
    }}>
      {t === undefined ? en[key] : t(key)}
    </MenuItemButton>
  )
}

/** Frame-wide feedback remains visible after a menu action unmounts. */
export function SessionCopyNotice({ copyActions, t }: {
  readonly copyActions: CopyActions
  readonly t?: Translate
}) {
  const notice = useSyncExternalStore(copyActions.subscribe, copyActions.getSnapshot)
  if (notice === null) return null
  return <Toast key={notice.sequence} text={t === undefined ? en[notice.key] : t(notice.key)}
    tone={notice.success ? 'success' : undefined} onDone={copyActions.dismiss} />
}
