/** Browser half: the session ID control and the shared scratch workspace picker. */

import { SessionIdChip } from './SessionIdChip.js'
import { ScratchWorkspacePicker } from './ScratchWorkspacePicker.js'
import type { ScratchPickerInjected } from './ScratchWorkspacePicker.js'
import { en, NS, zh } from './locales.js'
import { SCRATCH_PATH, scratchWorkspace } from '../scratch-wire.js'
import type { ScratchResult } from '../scratch-wire.js'
import { createSessionCopyActions, SessionCopyMenuItem, SessionCopyNotice } from './session-menu.js'
import type { SessionCopyKind, SessionListReader } from './session-menu.js'

import { createSessionDeleteActions, SessionDeleteMenuItem, SessionDeleteDialog } from './session-delete.js'
import type { ArchiveSource } from './session-delete.js'

export { createSessionDeleteActions } from './session-delete.js'
export { createSessionCopyActions } from './session-menu.js'

export { shortenSessionId, copyPayload, writeClipboard } from './clipboard.js'
export { SessionIdChip } from './SessionIdChip.js'
export type { SessionIdChipProps } from './SessionIdChip.js'
export { ScratchWorkspacePicker } from './ScratchWorkspacePicker.js'
export type { ScratchWorkspacePickerProps, ScratchPickerInjected } from './ScratchWorkspacePicker.js'

/**
 * Required client services.
 *
 * `slots` is the registry this half contributes to, `locale` owns the
 * dictionaries, and `uiWorkspace` is the client-side workspace service whose
 * native chooser the New-Session row uses. `workspaces` adopts the returned registry record.
 */
export const inject = ['slots', 'locale', 'uiWorkspace', 'workspaces', 'sessions']

/** The slot this half occupies: the session header's title-adjacent action band. */
const SLOT = 'conversation.session.header.actions'

/** This entry's cell id inside that band. */
const ENTRY_ID = 'session-identity'

/** The blank-session picker cell this half replaces, to add the scratch row. */
const HERO_PICKER_SLOT = 'conversation.hero.workspace'

/** This entry's identity inside that cell. */
const HERO_PICKER_ID = 'session-bridge-picker'

/**
 * Priority for the picker replacement.
 *
 * A `single` cell's winner is its first entry after an ascending priority
 * sort, so the *lowest* priority number renders. The shipped picker sits at
 * the default 0, so anything below zero shadows it.
 */
const HERO_PICKER_PRIORITY = -1

/**
 * Where the chip sits among its neighbours.
 *
 * The band currently holds the subagent lineage (-30), the agent-preset label
 * (-10), and the background-job counter (20). Session identity belongs with the
 * other facts about *this* session, so it lands between the preset label and
 * the job counter rather than at the far edge.
 */
const ENTRY_ORDER = 0

/** Style element id, so a hot reload replaces its own sheet instead of stacking copies. */
const STYLE_ID = 'dsh-session-bridge-styles'

/**
 * The chip's stylesheet.
 *
 * Every color comes from a DSH theme token, so the control inherits the active
 * light/dark theme instead of hardcoding a palette. Class names are prefixed
 * `dsh-sbc-` to keep them out of the app's own namespace.
 */
const STYLES = `
.dsh-sbc-root { position: relative; display: inline-flex; align-items: stretch; gap: 0; }
.dsh-sbc-chip, .dsh-sbc-caret {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11px; line-height: 1; cursor: pointer;
  transition: color .12s ease, border-color .12s ease, background-color .12s ease;
}
.dsh-sbc-chip { border-radius: 6px 0 0 6px; border-right-width: 0; max-width: 132px; }
.dsh-sbc-caret { border-radius: 0 6px 6px 0; padding: 0 4px; }
.dsh-sbc-chip:hover, .dsh-sbc-caret:hover {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-sbc-chip:focus-visible, .dsh-sbc-caret:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px;
}
.dsh-sbc-chipId {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  letter-spacing: -.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-sbc-chipIcon { display: inline-flex; opacity: .55; }
.dsh-sbc-chip:hover .dsh-sbc-chipIcon { opacity: 1; }
.dsh-sbc-chip[data-copy-state="copied"] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsh-sbc-chip[data-copy-state="failed"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsh-sbc-caretGlyph { transition: transform .14s ease; }
.dsh-sbc-caretOpen { transform: rotate(180deg); }
.dsh-sbc-panel {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 60;
  width: 384px; max-width: calc(100vw - 32px);
  padding: 10px 12px 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 10px 30px rgb(0 0 0 / 18%);
  display: flex; flex-direction: column; gap: 10px;
}
.dsh-sbc-panelTitle {
  font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sbc-row { display: flex; flex-direction: column; gap: 4px; }
.dsh-sbc-rowHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsh-sbc-rowLabel { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-sbc-rowCopy {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px;
  background: transparent; color: var(--dsw-alias-label-secondary);
}
.dsh-sbc-rowCopy:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dsh-sbc-rowCopy[data-copy-state="copied"] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsh-sbc-rowCopy[data-copy-state="failed"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsh-sbc-rowValue {
  display: block; padding: 5px 7px; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11px; color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}
.dsh-sbc-rowHint { margin: 0; font-size: 11px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }
.dsh-sbp-status {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-secondary);
  font-size: 12px; z-index: 60;
}
.dsh-sbp-hint {
  max-width: 420px; margin: 8px auto 0; padding: 0 12px;
  font-size: 12px; line-height: 1.5; text-align: center;
  color: var(--dsw-alias-label-secondary);
}
`

/** The client services used by this plugin in DSH 0.1.7-rc.2. */
export interface ClientContextLike {
  readonly locale: { register(namespace: string, dictionaries: Record<string, unknown>): unknown }
  readonly slots: {
    inject(slot: string, register: () => unknown): unknown
    register<Injected extends object>(options: {
      readonly name: string
      readonly id?: string
      readonly order?: number
      readonly priority?: number
      readonly locale?: string
      readonly inject?: () => Injected
    }, component: unknown): () => void
  }
  readonly uiWorkspace: { pickDirectory(): Promise<string | null> }
  readonly workspaces: { readonly list: ArchiveSource; create(input: { readonly path: string }): Promise<{ readonly workspaceId: string }> }
  readonly sessions: SessionListReader
  effect(disposer: () => unknown, label?: string): void
}

/** Call the plugin's browser JSON route through the authenticated /api carrier. */
export function scratchPickerInjected(ctx: ClientContextLike): ScratchPickerInjected {
  return {
    createWorkspace: input => ctx.workspaces.create(input),
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    findScratchWorkspace: async (signal) => {
      const response = await fetch(SCRATCH_PATH.slice(1), { credentials: 'same-origin', cache: 'no-store', signal })
      if (!response.ok) throw new Error(`scratch lookup failed: HTTP ${response.status}`)
      const result: ScratchResult<unknown> = await response.json()
      if (!result.ok) throw new Error(result.error.message)
      return result.value === null ? null : scratchWorkspace(result.value).workspaceId
    },
    startScratchSession: async (title) => {
      const response = await fetch(SCRATCH_PATH.slice(1), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }),
      })
      if (!response.ok) throw new Error(`scratch request failed: HTTP ${response.status}`)
      const result: ScratchResult<unknown> = await response.json()
      if (!result.ok) throw new Error(result.error.message)
      const workspace = scratchWorkspace(result.value)
      // The store's idempotent create adopts the canonical registration and
      // commits its local projection before the owner's onPick reads it.
      return await ctx.workspaces.create({ path: workspace.path })
    },
  }
}

/** Install the chip's stylesheet, replacing any sheet a previous generation left. */
function installStyles(): () => void {
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) existing.remove()
  const style = document.createElement('style')
  style.id = STYLE_ID
  // Effects run after factory materialization; declare ownership before a
  // later plugin can claim this sheet and delete it during its own unload.
  style.dataset.plugin = 'dsh-session-bridge'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * Client plugin body: register the dictionaries, the header chip, and the
 * extra New-Session row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContextLike): void {
  const copyActions = createSessionCopyActions(ctx.sessions)
  const deleteActions = createSessionDeleteActions(ctx.workspaces.list)
  ctx.effect(() => () => { deleteActions.dispose() }, 'session-bridge: deletion confirmation')
  ctx.effect(() => () => { copyActions.dispose() }, 'session-bridge: sidebar actions')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-bridge: dictionaries')
  ctx.effect(installStyles, 'session-bridge: styles')
  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: ENTRY_ID,
    order: ENTRY_ORDER,
    locale: NS,
  }, SessionIdChip))
  // Replaces the blank-session picker so its menu can carry the one row DSH
  // has no seam for. See ScratchWorkspacePicker's module doc for why this is a
  // replacement rather than a contribution.
  ctx.slots.inject(HERO_PICKER_SLOT, () => ctx.slots.register({
    name: HERO_PICKER_SLOT,
    id: HERO_PICKER_ID,
    priority: HERO_PICKER_PRIORITY,
    locale: NS,
    inject: () => scratchPickerInjected(ctx),
  }, ScratchWorkspacePicker))
  const menu = 'sidebar.workspaces.session.menu.item'
  for (const [index, kind] of (['id', 'cwd', 'bridge'] as const).entries()) {
    ctx.slots.inject(menu, () => ctx.slots.register({
      name: menu, id: `dsh-session-bridge.copy-${kind}`, order: 500 + index * 10, locale: NS,
      inject: (): { kind: SessionCopyKind; copyReference: typeof copyActions.copy } => ({ kind, copyReference: copyActions.copy }),
    }, SessionCopyMenuItem))
  }
  ctx.slots.inject(menu, () => ctx.slots.register({
    name: menu, id: 'dsh-session-bridge.delete', order: 600, locale: NS,
    inject: () => ({ archive: ctx.workspaces.list, deleteActions }),
  }, SessionDeleteMenuItem))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-session-bridge.delete-dialog', locale: NS,
    inject: () => ({ deleteActions }),
  }, SessionDeleteDialog))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-session-bridge.copy-notice', locale: NS,
    inject: () => ({ copyActions }),
  }, SessionCopyNotice))
}
