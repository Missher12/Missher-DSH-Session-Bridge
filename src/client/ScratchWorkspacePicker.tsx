/**
 * A drop-in replacement for the blank-session workspace picker that adds one
 * row: **not in a workspace**.
 *
 * DSH's New Session screen offers exactly one route — pick a registered
 * Workspace, or adopt a host directory *as* a Workspace (`添加工作区…`). There
 * is no way to say "put me somewhere throwaway and don't make it a project",
 * which is why scratch folders created by the host half's `session_scratch`
 * end up littering that very list.
 *
 * ## Why this is a replacement and not a contribution
 *
 * `conversation.hero.workspace` is a `single` slot: occupancy is per priority,
 * and a different priority *shadows* rather than composes. There is no list
 * seat anywhere in the hero — `conversation.hero.workspace`,
 * `.directoryFlow`, `.agentPreset`, and `.brand.mark` are all `single`, and the
 * only free one is the whale logo. So the row cannot be added beside the
 * shipped one; the only way in is to take the cell.
 *
 * The shipped implementation could not be wrapped either: its `renderSlot` for
 * the `conversation.hero.workspace.directoryFlow` child is synthesized by the
 * render machinery from the entry's own `children` declaration, and
 * re-declaring that slot name throws (`slot "…" is already declared`) because
 * shadowing does not unregister the shadowed entry.
 *
 * So this component reproduces the shipped picker — same primitives, same
 * states, same error surface — from
 * `@deepseek-ai/dsh-client-ui-workspace/src/client/WorkspacePicker.tsx`, and
 * replaces only the directory-flow indirection with a direct call to the same
 * host chooser the native occupant used (`uiWorkspace.pickDirectory()`). Every
 * host interaction sits behind a `try`/`catch` that reports through this
 * component's own error dialog, so a changed Host contract degrades into a
 * visible message instead of taking the New Session screen down.
 *
 * @module dsh-session-bridge/client/ScratchWorkspacePicker
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Button, IconFolderCloseRegular, IconPlusOutlineRegular, IconSparkleRegular, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { en } from './locales.js'
import type { SessionBridgeKey } from './locales.js'

/** Menu row id of the shipped "adopt a host directory" action. */
const ADD_WORKSPACE = '::add-workspace'

/** Menu row id of this plugin's "not in a workspace" action. */
const SCRATCH = '::scratch-session'

/** One Workspace as the picker lists it. */
interface WorkspaceRow {
  readonly workspaceId: string
  readonly title: string
}

/** Minimal structural view of the client workspace snapshot. */
interface WorkspaceSnapshotLike {
  readonly items: readonly WorkspaceRow[]
  readonly phase?: string
}

/** Translator shape the slot composes from this plugin's namespace. */
type Translate = (key: SessionBridgeKey, params?: Record<string, string | number>) => string

/** The business face this entry injects. */
export interface ScratchPickerInjected {
  /** Adopt a host directory as a real Workspace (the shipped `添加工作区…` path). */
  readonly createWorkspace: (input: { readonly path: string }) => Promise<{ readonly workspaceId: string }>
  /** Run the host's own directory chooser; resolves the chosen absolute path. */
  readonly pickDirectory: () => Promise<string | null>
  /** Read the configured scratch identity; opening the menu must not create a workspace. */
  readonly findScratchWorkspace: (signal: AbortSignal) => Promise<string | null>
  /**
   * Point the New Session flow at the one stable scratch Workspace, creating
   * it on first use.
   *
   * It has to be a Workspace: DSH leaves a blank Session with no owning
   * Workspace inert, so the New Session screen would ask for a workspace
   * instead of accepting a first message. There is exactly one, named by the
   * caller, so repeated use never grows the sidebar.
   *
   * @param title - human-readable name for the scratch Workspace.
   * @returns the Workspace the caller should hand to the owner's `onPick`.
   */
  readonly startScratchSession: (title: string) => Promise<{ readonly workspaceId: string }>
}

/** Props this entry receives as the occupant of the blank-session picker. */
export interface ScratchWorkspacePickerProps extends ScratchPickerInjected {
  readonly open: boolean
  readonly anchorRef?: RefObject<HTMLElement | null> | undefined
  readonly selectedId?: string | undefined
  readonly onPick: (workspaceId: string) => void
  readonly onClose: () => void
  readonly useWorkspaces: <S>(select: (snapshot: WorkspaceSnapshotLike) => S) => S
  readonly t?: Translate
}

/** Resolve one key through the injected translator, or the built-in fallback. */
function text(t: Translate | undefined, key: SessionBridgeKey, params?: Record<string, string | number>): string {
  if (t !== undefined) return t(key, params)
  const pattern = en[key]
  if (params === undefined) return pattern
  return pattern.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]))
}

/** Render one thrown value as a single diagnostic line. */
function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Render the blank-session picker with the extra "not in a workspace" row.
 * @param props - owner share, the injected host callbacks, and the translator.
 * @returns the menu and its error dialog.
 */
export function ScratchWorkspacePicker({
  open,
  anchorRef,
  selectedId,
  onPick,
  onClose,
  useWorkspaces,
  createWorkspace,
  pickDirectory,
  findScratchWorkspace,
  startScratchSession,
  t,
}: ScratchWorkspacePickerProps): ReactNode {
  const snapshot = useWorkspaces(state => state)
  const workspaces = snapshot.items
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scratchWorkspaceId, setScratchWorkspaceId] = useState<string | null>(null)
  const [lookingUpScratch, setLookingUpScratch] = useState(true)
  const workspaceIds = workspaces.map(workspace => workspace.workspaceId).join('\0')

  // The normal list already contains a registered scratch workspace. Resolve
  // its identity from the Host, so a rename or a same-named real project does
  // not cause a second entry or hide the wrong action.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLookingUpScratch(true)
    void findScratchWorkspace(controller.signal).then((id) => {
      if (!controller.signal.aborted) setScratchWorkspaceId(id)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setScratchWorkspaceId(null)
        setError(messageOf(reason))
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLookingUpScratch(false)
    })
    return () => { controller.abort() }
  }, [open, workspaceIds, findScratchWorkspace])

  const getAnchorRect = useCallback(
    () => anchorRef?.current?.getBoundingClientRect() ?? null,
    [anchorRef],
  )

  /** Adopt a host directory as a Workspace, exactly as the shipped row does. */
  const adopt = async (path: string): Promise<void> => {
    const workspace = await createWorkspace({ path })
    onPick(workspace.workspaceId)
  }

  /** Run the host chooser, then adopt whatever came back. */
  const chooseDirectory = (): void => {
    onClose()
    setBusy(true)
    void (async () => {
      try {
        const path = await pickDirectory()
        if (path !== null && path.length > 0) await adopt(path)
      } catch (reason: unknown) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    })()
  }

  /** Ensure the shared directory, then take the ordinary workspace-pick path. */
  const startScratch = (): void => {
    onClose()
    setBusy(true)
    void (async () => {
      try {
        const { workspaceId } = await startScratchSession(text(t, 'picker.scratchTitle'))
        onPick(workspaceId)
      } catch (reason: unknown) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    })()
  }

  const handleSelect = (id: string): void => {
    if (id === ADD_WORKSPACE) {
      chooseDirectory()
      return
    }
    if (id === SCRATCH) {
      startScratch()
      return
    }
    onPick(id)
  }

  const scratch = workspaces.find(workspace => workspace.workspaceId === scratchWorkspaceId)
  const workspaceItems: MenuEntry[] = workspaces.filter(workspace => workspace.workspaceId !== scratchWorkspaceId).map(workspace => ({
    id: workspace.workspaceId,
    label: workspace.title,
    icon: <IconFolderCloseRegular size={16} />,
    disabled: busy,
  }))

  // The fixed-directory identity is last in the same scrolling list. Reuse
  // its real id and saved title; a same-named project stays in the main list.
  const addEntries: MenuEntry[] = [
    {
      id: ADD_WORKSPACE,
      label: text(t, 'picker.addWorkspace'),
      icon: <IconPlusOutlineRegular size={16} />,
      disabled: busy,
    },
  ]
  const scratchEntries: MenuEntry[] = !lookingUpScratch ? [{
      id: scratch?.workspaceId ?? SCRATCH,
      label: scratch?.title ?? (busy ? text(t, 'picker.starting') : text(t, 'picker.scratch')),
      icon: <IconSparkleRegular size={16} />,
      disabled: busy,
    }] : []
  const items: MenuEntry[] = [...workspaceItems, ...addEntries, ...scratchEntries]

  const closeModal = (): void => { setError(null) }

  return (
    <>
      <Menu
        open={open}
        anchor={null}
        items={items}
        selectedId={selectedId}
        onSelect={handleSelect}
        onClose={onClose}
        side="bottom"
        portal
        getAnchorRect={getAnchorRect}
      />
      {open && (snapshot.phase === 'pending' || lookingUpScratch) && (
        <div className="dsh-sbp-status" role="status">{text(t, 'picker.loading')}</div>
      )}
      <Modal
        open={error !== null}
        onClose={closeModal}
        closeLabel={text(t, 'panel.close')}
        title={text(t, 'picker.errorTitle')}
        footer={<Button variant="outline" onClick={closeModal}>{text(t, 'picker.cancel')}</Button>}
      >
        <div role="alert">{error}</div>
      </Modal>
      {/* The scratch row's own explanation, surfaced while it is the only entry
          (no Workspaces yet) so the choice is legible before it is made. */}
      {open && workspaces.length === 0 && (
        <div className="dsh-sbp-hint" role="note">
          {text(t, 'picker.scratchHint')}
        </div>
      )}
    </>
  )
}
