/** Browser half: sidebar session actions and the shared scratch workspace picker. */

import { ScratchWorkspacePicker } from './ScratchWorkspacePicker.js'
import type { ScratchPickerInjected } from './ScratchWorkspacePicker.js'
import { en, NS, zh } from './locales.js'
import { SCRATCH_PATH, scratchWorkspace } from '../scratch-wire.js'
import type { ScratchResult } from '../scratch-wire.js'
import { createSessionCopyActions, SessionCopyMenuItem, SessionCopyNotice } from './session-menu.js'
import type { SessionCopyKind, SessionListReader } from './session-menu.js'

import { createSessionDeleteActions, SessionDeleteMenuItem, SessionDeleteDialog } from './session-delete.js'
import { createSessionMoveActions, SessionMoveToast } from './session-move.js'
import { installSessionDrag } from './session-drag.js'
import type { WorkspaceMoveSource } from './session-move.js'
import { trackScratchPlacement } from './scratch-placement.js'
import type { WorkspacePlacementSource } from './scratch-placement.js'

export { createSessionDeleteActions, readSessionDeleteCapability } from './session-delete.js'
export { createSessionMoveActions } from './session-move.js'
export type { MoveWorkspace, WorkspaceMoveSource } from './session-move.js'
export { createSessionCopyActions } from './session-menu.js'

export { copyPayload, shortenSessionId, writeClipboard } from './clipboard.js'
export { ChipPanelOverlay, createChipPanelActions, SessionIdChip } from './SessionIdChip.js'
export type { ChipPanelActions, ChipPanelState, SessionIdChipProps } from './SessionIdChip.js'
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
.dsh-sb-deleteHint {
  box-sizing: border-box; max-inline-size: min(280px, 100%); padding: 4px 12px 8px;
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5;
  white-space: normal; overflow-wrap: anywhere;
}
.dsh-sb-drop-target { outline: 2px solid var(--dsw-alias-brand-primary, #4f7cff); outline-offset: -2px; border-radius: 6px; }
/*
 * One line, never shortened, always reachable.
 *
 * The header band is display flex with flex none on the actions band, the
 * surrounding title cluster is min-width 0, and the active session root clips
 * overflow. A percentage cap would resolve against the band's own content
 * width, not the row's remaining space, so the chip measures the width left for
 * it inside the clipping ancestor and writes that as an inline cap. The rules
 * here are the part of the layout that can be expressed statically:
 *
 * - the id lives in its own scroll region (.dsh-sbc-chipId), so the complete
 *   string stays on one line at every width and is read by scrolling that
 *   region sideways. Only the glyphs move; nothing is wrapped, ellipsised, or
 *   dropped, and no session- prefix is ever removed.
 * - the copy icon and the caret are flex none siblings outside that region, so
 *   a narrow window cannot scroll or shrink the buttons out of reach.
 * - white-space: nowrap stops at the id line. The expanded panel is a separate
 *   subtree with its own wrapping rules, so a long working directory or bridge
 *   reference is readable rather than cut off.
 */
.dsh-sbc-root {
  position: relative; display: inline-flex; align-items: stretch; gap: 0;
  inline-size: max-content; min-inline-size: 0; flex-shrink: 0;
}
.dsh-sbc-chip, .dsh-sbc-caret {
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 22px; padding: 3px 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11px; line-height: 1.35; cursor: pointer;
  transition: color .12s ease, border-color .12s ease, background-color .12s ease;
}
.dsh-sbc-chip { border-radius: 6px 0 0 6px; border-right-width: 0; min-inline-size: 0; }
.dsh-sbc-caret { border-radius: 0 6px 6px 0; padding: 0 4px; flex: none; }
.dsh-sbc-chip:hover, .dsh-sbc-caret:hover {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-sbc-chip:focus-visible, .dsh-sbc-caret:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px;
}
/*
 * The id's own scroll region. It may shrink to nothing so the buttons beside it
 * stay put, and it scrolls sideways rather than wrapping, ellipsising, or
 * cutting the string out of the document. Vertical overflow is hidden on
 * purpose: horizontal scrolling must not create a vertical scrollbar that
 * would change the control's height in the header. The tab stop is set in the
 * component, so the glyphs past the right edge stay reachable by keyboard.
 */
.dsh-sbc-chipId {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  letter-spacing: -.02em; overflow-wrap: normal; white-space: nowrap;
  text-align: left; flex: 1 1 auto; min-inline-size: 0; inline-size: auto;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
  overscroll-behavior-x: contain;
}
.dsh-sbc-chipId:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-sbc-chipId::-webkit-scrollbar { inline-size: 0; block-size: 0; }
.dsh-sbc-chipIcon { display: inline-flex; opacity: .55; flex: none; }
.dsh-sbc-chip:hover .dsh-sbc-chipIcon { opacity: 1; }
.dsh-sbc-chip[data-copy-state="copied"] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsh-sbc-chip[data-copy-state="failed"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsh-sbc-caretGlyph { transition: transform .14s ease; }
.dsh-sbc-caretOpen { transform: rotate(180deg); }
/*
 * The panel renders in shell.overlay, above the frame, so it is positioned in
 * viewport coordinates from the control's rect — see anchoredStyle in
 * SessionIdChip. Only the placement is inline; everything structural is here.
 * The white-space rule below re-establishes ordinary wrapping for the panel's
 * own content, which inherits nothing from the header's id line.
 */
.dsh-sbc-panel {
  box-sizing: border-box; z-index: 60;
  padding: 10px 12px 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 10px 30px rgb(0 0 0 / 18%);
  display: flex; flex-direction: column; gap: 10px;
  overflow-y: auto; overflow-x: hidden;
  white-space: normal; text-align: start;
}
.dsh-sbc-panelTitle {
  font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sbc-row { display: flex; flex-direction: column; gap: 4px; min-inline-size: 0; }
.dsh-sbc-rowHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsh-sbc-rowLabel { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-sbc-rowCopy {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; cursor: pointer; flex: none;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px;
  background: transparent; color: var(--dsw-alias-label-secondary);
}
.dsh-sbc-rowCopy:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dsh-sbc-rowCopy[data-copy-state="copied"] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsh-sbc-rowCopy[data-copy-state="failed"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
/*
 * Panel values wrap. A working directory or a /bridge reference is long and has
 * no natural break opportunity, so the anywhere rule is what keeps it inside the
 * panel instead of widening it or getting cut off.
 */
.dsh-sbc-rowValue {
  display: block; padding: 5px 7px; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11px; color: var(--dsw-alias-label-primary);
  white-space: normal; overflow-wrap: anywhere; word-break: break-word;
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
  readonly uiWorkspace: {
    pickDirectory(): Promise<string | null>
    /** Optional on older Hosts; the picker remains usable without sidebar placement. */
    registerTrailingWorkspace?(workspaceId: string): () => void
  }
  readonly workspaces: {
    readonly list: WorkspaceMoveSource & WorkspacePlacementSource
    create(input: { readonly path: string }): Promise<{ readonly workspaceId: string }>
  }
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
  style.dataset.plugin = '@missher/dsh-session-bridge'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * Client plugin body: register the dictionaries, sidebar session actions,
 * and the extra New-Session row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContextLike): void {
  const picker = scratchPickerInjected(ctx)
  const registerTrailing = typeof ctx.uiWorkspace.registerTrailingWorkspace === 'function'
    ? ctx.uiWorkspace.registerTrailingWorkspace.bind(ctx.uiWorkspace) : undefined
  if (registerTrailing !== undefined) {
    ctx.effect(() => trackScratchPlacement(ctx.workspaces.list, picker.findScratchWorkspace, registerTrailing), 'session-bridge: trailing workspace placement')
  }
  const copyActions = createSessionCopyActions(ctx.sessions)
  const refreshSessions = (): void => {
    try { ctx.sessions.refresh?.() } catch { /* refresh is best-effort */ }
  }
  const deleteActions = createSessionDeleteActions(fetch, refreshSessions)
  const moveActions = createSessionMoveActions(fetch, refreshSessions)
  ctx.effect(() => installSessionDrag(moveActions, ctx.workspaces.list), 'session-bridge: workspace drag move')
  ctx.effect(() => () => { deleteActions.dispose(); moveActions.dispose() }, 'session-bridge: deletion and drag move')
  ctx.effect(() => () => { copyActions.dispose() }, 'session-bridge: sidebar actions')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-bridge: dictionaries')
  ctx.effect(installStyles, 'session-bridge: styles')
  // Replaces the blank-session picker so its menu can carry the one row DSH
  // has no seam for. See ScratchWorkspacePicker's module doc for why this is a
  // replacement rather than a contribution.
  ctx.slots.inject(HERO_PICKER_SLOT, () => ctx.slots.register({
    name: HERO_PICKER_SLOT,
    id: HERO_PICKER_ID,
    priority: HERO_PICKER_PRIORITY,
    locale: NS,
    inject: () => picker,
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
    inject: () => ({ sessions: ctx.sessions, deleteActions }),
  }, SessionDeleteMenuItem))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-session-bridge.delete-dialog', locale: NS,
    inject: () => ({ deleteActions }),
  }, SessionDeleteDialog))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-session-bridge.move-toast', locale: NS,
    inject: () => ({ moveActions }),
  }, SessionMoveToast))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-session-bridge.copy-notice', locale: NS,
    inject: () => ({ copyActions }),
  }, SessionCopyNotice))
}
