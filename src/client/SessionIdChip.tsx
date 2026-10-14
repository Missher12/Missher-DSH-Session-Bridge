/**
 * The session-identity chip: a header control that shows this session's id in
 * full and puts it — or its working directory, or a ready-to-paste `/bridge`
 * prefix — on the clipboard in one click.
 *
 * This is the human half of the bridge. The model already has `session_send`;
 * a person reading a conversation had no way to obtain the id that call takes,
 * so the feature was unusable from the UI. The affordance deliberately mirrors
 * Codex's status panel, where the session id is a first-class copy target
 * rather than text that happens to be on screen.
 *
 * Three Host layout facts shape everything below, and a plugin cannot change
 * any of them:
 *
 * 1. The header action band is `flex: none` inside a title row whose cluster is
 *    `min-width: 0`, and the active session root has `overflow: hidden`. A
 *    control that claims its content width there is clipped, never shrunk, and
 *    a percentage cap resolves against the band's own content width rather than
 *    the row's remaining space. So the chip measures the width actually left
 *    for it inside the ancestor that would clip it, and caps itself to that.
 * 2. The id is never wrapped, elided, or prefix-stripped: an id you cannot read
 *    back is not an id. When the cap bites, the id scrolls inside its own
 *    region, which is its own tab stop so the glyphs past the edge stay
 *    keyboard-reachable. The copy affordance and the caret are siblings outside
 *    that region, so narrowness cannot take them away.
 * 3. The expanded panel is absolutely positioned chrome. Inside the header it
 *    would still be clipped by that `overflow: hidden`, so it renders through
 *    the plugin's own `shell.overlay` cell and is positioned in viewport
 *    coordinates against the control's rect.
 *
 * @module dsh-session-bridge/client/SessionIdChip
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode, RefObject } from 'react'
import { copyPayload, writeClipboard } from './clipboard.js'
import type { CopyOutcome, CopyPayload } from './clipboard.js'
import { en } from './locales.js'
import type { SessionBridgeKey } from './locales.js'

/** Minimal structural view of the composer's session snapshot. */
interface SessionSnapshotLike {
  readonly byId: Readonly<Record<string, { readonly cwd?: string } | undefined>>
}

/** Translator shape the slot composes from the registered namespace. */
type Translate = (key: SessionBridgeKey, params?: Record<string, string | number>) => string

/** Props this entry receives from the conversation session header. */
export interface SessionIdChipProps {
  /** Durable id of the session this header belongs to. */
  readonly sessionId: string
  /** Session snapshot selector; used only to surface the working directory. */
  readonly useSessions?: <T>(select: (snapshot: SessionSnapshotLike) => T) => T
  /** Shared panel store, created once by the client entry. */
  readonly chip?: ChipPanelActions
  /** Namespace translator injected by the slot registration's `locale`. */
  readonly t?: Translate
}

/**
 * Everything the header chip and its overlay panel share.
 *
 * The two render in different slots, so neither can hold the other's props:
 * the chip publishes where it is, what id it is showing, and whether its panel
 * is open, and the overlay reads that. Keeping it in one store also means the
 * panel survives a hot reload of either cell.
 */
export interface ChipPanelState {
  /** The chip's root element; `null` until it mounts. */
  readonly anchor: HTMLElement | null
  /** Inline size the header row leaves for the chip, in CSS pixels. */
  readonly available: number | null
  /** The id the chip is currently showing. */
  readonly sessionId: string
  /** The session's working directory, when the client knows it. */
  readonly cwd?: string
  readonly open: boolean
}

/** Store behind the chip and its overlay cell. */
export interface ChipPanelActions {
  getSnapshot(): ChipPanelState
  subscribe(listener: () => void): () => void
  /** Publish a new measurement from the header chip. */
  measure(next: { readonly anchor: HTMLElement | null; readonly available: number | null; readonly sessionId: string; readonly cwd?: string }): void
  /**
   * Retract this chip's identity on unmount.
   *
   * Scoped to the element that published it: a chip that unmounts while a new
   * one has already taken over must not clear the successor's id, cwd, or
   * anchor. A different element is left exactly as it is.
   */
  release(anchor: HTMLElement | null): void
  setOpen(open: boolean): void
  dispose(): void
}

/** How long a copy acknowledgement stays before the chip resets. */
const ACK_MS = 1_600

/** Gap kept between the panel and every viewport edge. */
const PANEL_MARGIN = 12

/** Vertical gap between the control and its panel. */
const PANEL_GAP = 6

/** Design width of the panel; narrowed on a narrow viewport, never widened. */
const PANEL_WIDTH = 384

/** Panel height budget; internal rows scroll past this. */
const PANEL_MAX_HEIGHT = 420

/** Pixels one arrow-key press moves the scrollable id region. */
const ID_SCROLL_STEP = 24

/** The initial, not-yet-measured state. */
const IDLE: ChipPanelState = { anchor: null, available: null, sessionId: '', open: false }

/**
 * Create the shared chip store.
 *
 * @returns the store the header cell and the overlay cell both read.
 */
export function createChipPanelActions(): ChipPanelActions {
  const listeners = new Set<() => void>()
  let state: ChipPanelState = IDLE
  let disposed = false
  const publish = (next: ChipPanelState): void => {
    if (disposed || next === state) return
    state = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    measure(next) {
      if (disposed) return
      const anchorChanged = next.anchor !== state.anchor
      const cwd = next.cwd
      const same = !anchorChanged && next.available === state.available
        && next.sessionId === state.sessionId && cwd === state.cwd
      if (same) return
      publish({
        anchor: next.anchor, available: next.available, sessionId: next.sessionId,
        ...cwd === undefined ? {} : { cwd }, open: state.open,
      })
    },
    setOpen(open) { publish({ ...state, open }) },
    release(anchor) {
      if (disposed || state.anchor === null || state.anchor !== anchor) return
      // Only this chip's own registration is retracted, and the panel closes
      // with it: there is nothing left to anchor an open panel to.
      publish({ ...IDLE })
    },
    dispose() { disposed = true; listeners.clear(); state = IDLE },
  }
}

/** Resolve one key through the injected translator, or the built-in fallback. */
function text(t: Translate | undefined, key: SessionBridgeKey, params?: Record<string, string | number>): string {
  if (t === undefined) {
    const pattern = en[key]
    if (params === undefined) return pattern
    return pattern.replace(/\{(\w+)\}/g, (match, name: string) =>
      params[name] === undefined ? match : String(params[name]))
  }
  return t(key, params)
}

/** One copy target row: label, exact value, and its own press state. */
interface RowProps {
  readonly fieldKey: CopyPayload['key']
  readonly label: string
  readonly value: string
  /** Optional explanatory line under the value. */
  readonly hint?: string
  /** `undefined` renders the row as un-copyable (an unknown cwd). */
  readonly payload?: CopyPayload
  readonly state?: CopyOutcome
  readonly onCopy: (payload: CopyPayload) => void
  readonly t?: Translate
}

/** Icon: the two-sheet copy glyph used by the copy affordances. */
function CopyIcon(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.75" y="5.75" width="8.5" height="8.5" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.25 3.75A2 2 0 0 0 8.25 1.75h-4.5a2 2 0 0 0-2 2v4.5a2 2 0 0 0 2 2"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Icon: the confirmation check shown in place of the copy glyph. */
function CheckIcon(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 5" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Icon: the caret that opens the identity panel. */
function CaretIcon({ open }: { readonly open: boolean }): ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"
      className={open ? 'dsh-sbc-caretGlyph dsh-sbc-caretOpen' : 'dsh-sbc-caretGlyph'}>
      <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** What one key press does to the id region, or `null` when the key is not ours. */
function scrollTarget(key: string, scrollLeft: number): number | null {
  switch (key) {
    case 'ArrowRight': return scrollLeft + ID_SCROLL_STEP
    case 'ArrowLeft': return scrollLeft - ID_SCROLL_STEP
    // Absolute bounds rather than deltas: the browser clamps these to the
    // scrollable range, so they land on the true ends from any position.
    case 'End': return Number.MAX_SAFE_INTEGER
    case 'Home': return 0
    // Enter and Space are deliberately absent: they belong to the enclosing
    // copy button, and the id region must not swallow them.
    default: return null
  }
}

/**
 * The scrollable id region.
 *
 * The complete id is rendered, always: nothing here truncates, elides, or hides
 * part of the string from assistive technology. The region is its own tab stop
 * because a horizontally scrolled line is otherwise reachable by pointer only;
 * the arrow keys and Home/End scroll it. Enter and Space are deliberately not
 * handled, so the enclosing copy button keeps them.
 *
 * @param props - the exact id and the translator for its accessible name.
 * @returns the id region.
 */
function ChipId({ sessionId, t }: { readonly sessionId: string; readonly t?: Translate }): ReactNode {
  const regionRef = useRef<HTMLSpanElement>(null)
  const onKeyDown = (event: { key: string; preventDefault(): void; stopPropagation(): void }): void => {
    const region = regionRef.current
    if (region === null) return
    const target = scrollTarget(event.key, region.scrollLeft)
    if (target === null) return
    event.preventDefault()
    event.stopPropagation()
    region.scrollLeft = target
  }
  return (
    <span
      ref={regionRef}
      className="dsh-sbc-chipId"
      role="group"
      tabIndex={0}
      aria-label={text(t, 'chip.idRegion', { id: sessionId })}
      title={sessionId}
      onKeyDown={onKeyDown}
    >{sessionId}</span>
  )
}

/** One copyable row inside the identity panel. */
function Row({ fieldKey, label, value, hint, payload, state, onCopy, t }: RowProps): ReactNode {
  const copyable = payload !== undefined
  return (
    <div className="dsh-sbc-row" data-field={fieldKey}>
      <div className="dsh-sbc-rowHead">
        <span className="dsh-sbc-rowLabel">{label}</span>
        {copyable
          ? (
            <button
              type="button"
              className="dsh-sbc-rowCopy"
              data-copy-state={state ?? 'idle'}
              aria-label={text(t, 'panel.copyField', { field: label })}
              title={state === 'copied' ? text(t, 'chip.copied') : text(t, 'panel.copyField', { field: label })}
              onClick={() => { onCopy(payload) }}
            >
              {state === 'copied' ? <CheckIcon /> : <CopyIcon />}
            </button>
          )
          : null}
      </div>
      <code className="dsh-sbc-rowValue" title={value}>{value}</code>
      {hint !== undefined ? <p className="dsh-sbc-rowHint">{hint}</p> : null}
    </div>
  )
}

/**
 * The right edge of an element's content box, in viewport coordinates.
 *
 * `getBoundingClientRect` always returns the border box, whatever `boxSizing`
 * says, so the content edge is the rect minus this element's own trailing
 * border and padding.
 *
 * @param element - the element to measure.
 * @returns the content-box right edge in CSS pixels.
 */
function contentRight(element: HTMLElement): number {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return rect.right
    - (Number.parseFloat(style.borderInlineEndWidth) || 0)
    - (Number.parseFloat(style.paddingInlineEnd) || 0)
}

/**
 * The boxes whose size decides how much room this control has.
 *
 * Both kinds move when the window or the sidebar changes, and neither is
 * guaranteed to fire a window resize: a sidebar toggle only re-lays-out these
 * ancestors. Observing them is what keeps a cap — and a panel's position —
 * honest after such a toggle.
 *
 * @param element - the control to walk up from, or `null`.
 * @returns each budget ancestor, in parent order.
 */
function budgetAncestors(element: HTMLElement | null): readonly HTMLElement[] {
  const found: HTMLElement[] = []
  let ancestor = element?.parentElement ?? null
  let sawFlexGrow = false
  while (ancestor !== null) {
    const style = getComputedStyle(ancestor)
    if (!sawFlexGrow && Number.parseFloat(style.flexGrow) > 0) {
      found.push(ancestor)
      sawFlexGrow = true
    }
    if (style.overflowX === 'hidden' || style.overflowX === 'clip') found.push(ancestor)
    ancestor = ancestor.parentElement
  }
  return found
}

/**
 * The rightmost x this control may occupy.
 *
 * Two different boxes bound it, and the tighter one wins:
 *
 * - the nearest ancestor that hides horizontal overflow, which is where the
 *   control would be clipped;
 * - the nearest ancestor that shares out free space (`flex-grow > 0`, which is
 *   the title cluster in the shipped header). That box is the budget left after
 *   the trailing header utilities have taken their share, so it is the one that
 *   actually predicts where the row runs out — measuring only the clipping
 *   ancestor happily hands the control the space the buttons beside it occupy.
 *
 * The boxes are found by walking `parentElement`, so a `display: contents` slot
 * wrapper — no box, and never in an `offsetParent` chain — cannot hide either
 * one. No Host class name and no assumed sidebar width is involved.
 *
 * @param element - the control to measure for.
 * @returns the effective content-box right edge in CSS pixels.
 */
function usableRight(element: HTMLElement): number {
  const found = budgetAncestors(element).map(contentRight)
  return found.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...found)
}

/**
 * The width the header leaves for this control.
 *
 * Clears the cap, reads where the control actually starts, and reports the room
 * up to {@link usableRight}. Clear-then-measure is what makes a wider window
 * restore the natural width: nothing is derived from the previous cap, so a cap
 * can never become permanent. At a wide viewport the result exceeds the natural
 * width, and a `max-inline-size` larger than the content simply does not bind.
 *
 * @param element - the control's root element.
 * @returns the room in CSS pixels, or `null` when no ancestor bounds it.
 */
function measureRoom(element: HTMLElement): number | null {
  element.style.maxInlineSize = 'none'
  const right = usableRight(element)
  if (!Number.isFinite(right)) return null
  return Math.max(0, right - element.getBoundingClientRect().left - 1)
}

/**
 * Keep the chip inside the room the header actually leaves for it.
 *
 * A single measure writes the cap; a wider window produces a larger cap, which
 * simply does not bind, so the control returns to its natural width without any
 * relearning. The bound is re-derived whenever the control's own size changes
 * or the window does.
 *
 * @returns the ref to attach, and the latest measured room or `null`.
 */
function useCappedWidth(): {
  readonly ref: RefObject<HTMLDivElement>
  readonly available: number | null
} {
  const ref = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState<number | null>(null)
  const last = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    let frame: number | undefined
    const measure = (): void => {
      const element = ref.current
      if (cancelled || element === null) return
      const next = measureRoom(element)
      if (next === null) return
      element.style.maxInlineSize = `${next}px`
      if (next === last.current) return
      last.current = next
      setAvailable(next)
    }
    const schedule = (): void => {
      if (cancelled || frame !== undefined) return
      frame = requestAnimationFrame(() => { frame = undefined; measure() })
    }

    measure()
    // A second pass after layout: the first cap can change how much room the row
    // gives the band, and the row is still settling on first paint.
    schedule()

    // Observe the control itself, plus every budget ancestor: a sidebar toggle
    // resizes those boxes without firing a window resize, so listening to the
    // window alone would leave a stale cap. `window.resize` stays for the
    // browser's own size changes.
    const observer = new ResizeObserver(schedule)
    if (ref.current !== null) observer.observe(ref.current)
    for (const ancestor of budgetAncestors(ref.current)) observer.observe(ancestor)
    window.addEventListener('resize', schedule)
    return () => {
      cancelled = true
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return { ref, available }
}

/**
 * Render the identity chip for one session.
 *
 * The collapsed chip copies the full id on a single press — the common case —
 * and its caret opens the panel holding the id, the working directory, and the
 * `/bridge` prefix. Every field acknowledges its own outcome, so a clipboard
 * refusal is visible instead of silent.
 *
 * @param props - the session id, the session snapshot selector, the shared
 * panel store, and the translator.
 * @returns the chip. Its panel renders from the overlay cell.
 */
export function SessionIdChip({ sessionId, useSessions, chip, t }: SessionIdChipProps): ReactNode {
  const cwd = useSessions === undefined
    ? undefined
    : useSessions(snapshot => snapshot?.byId?.[sessionId]?.cwd)
  const [ack, setAck] = useState<{ key: CopyPayload['key']; outcome: CopyOutcome } | undefined>(undefined)
  const { ref, available } = useCappedWidth()
  const state = usePanelState(chip)
  const open = state?.open ?? false

  // The chip is the only writer of its own geometry, so the overlay never has
  // to guess where the control is or how wide it may be.
  useEffect(() => {
    chip?.measure({
      anchor: ref.current, available, sessionId,
      ...cwd === undefined ? {} : { cwd },
    })
  }, [chip, ref, available, sessionId, cwd])

  // Retract exactly this element's registration. The anchor is captured when the
  // effect runs because React clears the ref before running cleanup. Scoped by
  // identity, so a chip that unmounts after a replacement mounted cannot clear
  // the successor's id, cwd, or anchor.
  useEffect(() => {
    const anchor = ref.current
    return () => { chip?.release(anchor) }
  }, [chip, ref])

  // One acknowledgement at a time, cleared on a timer so the chip returns to
  // its resting state without any further interaction.
  useEffect(() => {
    if (ack === undefined) return
    const timer = setTimeout(() => { setAck(undefined) }, ACK_MS)
    return () => { clearTimeout(timer) }
  }, [ack])

  const copy = async (payload: CopyPayload | undefined): Promise<void> => {
    if (payload === undefined) return
    const outcome = await writeClipboard(payload.text)
    setAck({ key: payload.key, outcome })
  }

  const idPayload = copyPayload('id', sessionId, cwd)
  const chipAck = ack?.key === 'id' ? ack.outcome : undefined
  const chipLabel = chipAck === 'copied'
    ? text(t, 'chip.copied')
    : chipAck === 'failed' ? text(t, 'chip.failed') : text(t, 'chip.copy')

  return (
    <div ref={ref} className="dsh-sbc-root" data-session-id={sessionId}>
      <button
        type="button"
        className="dsh-sbc-chip"
        data-copy-state={chipAck ?? 'idle'}
        aria-label={chipLabel}
        title={`${text(t, 'chip.copy')} · ${sessionId}`}
        onClick={() => { void copy(idPayload) }}
      >
        <ChipId sessionId={sessionId} {...t === undefined ? {} : { t }} />
        <span className="dsh-sbc-chipIcon">{chipAck === 'copied' ? <CheckIcon /> : <CopyIcon />}</span>
      </button>
      <button
        type="button"
        className="dsh-sbc-caret"
        aria-expanded={open}
        aria-label={text(t, 'chip.open')}
        title={text(t, 'chip.open')}
        onClick={() => { chip?.setOpen(!open) }}
      >
        <CaretIcon open={open} />
      </button>
    </div>
  )
}

/**
 * Render the chip's identity panel into the shell's overlay layer.
 *
 * The panel is a fixed overlay clamped against the viewport, so it is never
 * clipped by the header's `overflow: hidden`. Only the id line stays on one
 * line; the working directory and `/bridge` rows wrap normally, so a long path
 * is readable instead of cut off. Escape closes the panel and returns focus to
 * the control that opened it, and an outside pointer press dismisses it.
 *
 * @param props - the shared panel store and the translator.
 * @returns the panel, or `null` while it is closed.
 */
export function ChipPanelOverlay({ chip, t }: { readonly chip: ChipPanelActions; readonly t?: Translate }): ReactNode {
  const state = usePanelState(chip)
  // A callback ref, not a ref object: the dismissal effect has to re-run when
  // the panel element actually arrives, and a ref object does not re-render.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const [ack, setAck] = useState<{ key: CopyPayload['key']; outcome: CopyOutcome } | undefined>(undefined)
  const anchor = state?.anchor ?? null
  // A detached anchor is not an anchor: the panel stays closed rather than
  // floating at the last coordinates of an element that no longer exists.
  const open = state?.open === true && anchor !== null && anchor.isConnected
  const style = useAnchoredStyle(anchor, panel, open)

  const dismiss = useCallback(() => { chip.setOpen(false) }, [chip])
  // The panel is portaled, so it is named alongside the trigger; a press inside
  // either one is not an outside press.
  useCloseOnOutsidePointer(anchor, panel, open, dismiss)

  // Escape is handled here rather than by a modal layer: this is a non-modal
  // popover, so the page behind it keeps working while it is open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      chip.setOpen(false)
      // Return focus to the control that opened the panel, so the keyboard path
      // is not stranded on a dismissed surface.
      const caret = anchor?.querySelector<HTMLElement>('.dsh-sbc-caret')
      caret?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [open, chip, anchor])

  useEffect(() => {
    if (ack === undefined) return
    const timer = setTimeout(() => { setAck(undefined) }, ACK_MS)
    return () => { clearTimeout(timer) }
  }, [ack])

  const copy = async (payload: CopyPayload | undefined): Promise<void> => {
    if (payload === undefined) return
    const outcome = await writeClipboard(payload.text)
    setAck({ key: payload.key, outcome })
  }

  if (!open || state === null || style === null) return null
  const sessionId = state.sessionId
  const cwd = state.cwd
  const idPayload = copyPayload('id', sessionId, cwd)
  const cwdPayload = copyPayload('cwd', sessionId, cwd)
  const bridgePayload = copyPayload('bridge', sessionId, cwd)

  return (
    <div ref={setPanel} className="dsh-sbc-panel" style={style} role="dialog" aria-label={text(t, 'panel.title')}>
      <div className="dsh-sbc-panelTitle">{text(t, 'panel.title')}</div>
      <Row
        fieldKey="id"
        label={text(t, 'panel.id')}
        value={sessionId}
        {...idPayload === undefined ? {} : { payload: idPayload }}
        {...ack?.key === 'id' ? { state: ack.outcome } : {}}
        onCopy={payload => { void copy(payload) }}
        {...t === undefined ? {} : { t }}
      />
      <Row
        fieldKey="cwd"
        label={text(t, 'panel.cwd')}
        value={cwd === undefined || cwd.length === 0 ? text(t, 'panel.cwdUnknown') : cwd}
        {...cwdPayload === undefined ? {} : { payload: cwdPayload }}
        {...ack?.key === 'cwd' ? { state: ack.outcome } : {}}
        onCopy={payload => { void copy(payload) }}
        {...t === undefined ? {} : { t }}
      />
      <Row
        fieldKey="bridge"
        label={text(t, 'panel.bridge')}
        value={bridgePayload?.text.trimEnd() ?? ''}
        hint={text(t, 'panel.bridgeHint')}
        {...bridgePayload === undefined ? {} : { payload: bridgePayload }}
        {...ack?.key === 'bridge' ? { state: ack.outcome } : {}}
        onCopy={payload => { void copy(payload) }}
        {...t === undefined ? {} : { t }}
      />
    </div>
  )
}

/** Subscribe one component to the shared panel state. */
function usePanelState(chip: ChipPanelActions | undefined): ChipPanelState | null {
  const subscribe = useCallback((listener: () => void) => chip?.subscribe(listener) ?? (() => {}), [chip])
  const getSnapshot = useCallback(() => chip?.getSnapshot() ?? null, [chip])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Close a popover when a pointerdown lands outside the elements that own it.
 *
 * Written here rather than taken from the primitives package: this plugin's
 * browser half links against exactly three module ids, and the runtime import
 * surface is part of its compatibility contract with the Host. The behaviour is
 * the same one the shell's own popovers use — a capture-free document listener
 * that detaches as soon as the surface closes.
 *
 * @param root - the trigger's element; `null` while the trigger is unmounted.
 * @param surface - the portaled panel's element; `null` while it is closed.
 * @param open - whether the surface is showing.
 * @param close - invoked when the press landed outside both elements.
 */
function useCloseOnOutsidePointer(
  root: HTMLElement | null,
  surface: HTMLElement | null,
  open: boolean,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (root?.contains(target) === true || surface?.contains(target) === true) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [root, surface, open, close])
}

/**
 * The fixed-position geometry for a panel anchored to one control.
 *
 * @param anchor - the chip element the panel belongs to.
 * @param panel - the mounted panel, so its own height can be bounded.
 * @returns the inline style to apply.
 */
function anchoredStyle(anchor: HTMLElement, panel: HTMLElement | null): {
  readonly position: 'fixed'
  readonly top: number
  readonly left: number
  readonly width: number
  readonly maxHeight: number
  readonly pointerEvents: 'auto'
} {
  const rect = anchor.getBoundingClientRect()
  const width = Math.max(0, Math.min(PANEL_WIDTH, window.innerWidth - PANEL_MARGIN * 2))
  const left = Math.max(PANEL_MARGIN, Math.min(rect.right - width, window.innerWidth - PANEL_MARGIN - width))
  const below = window.innerHeight - rect.bottom - PANEL_GAP - PANEL_MARGIN
  // No forced minimum: a viewport too short for the panel simply gets a short
  // panel, and the panel's own rows scroll. A floor here would push the panel
  // past the bottom edge on exactly the windows that have least room.
  const maxHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(0, below))
  const top = below >= 0 ? rect.bottom + PANEL_GAP : Math.max(PANEL_MARGIN, rect.top - PANEL_GAP - maxHeight)
  return { position: 'fixed', top, left, width, maxHeight, pointerEvents: 'auto' }
}

/**
 * Track an anchor's viewport rect and hand back the panel's fixed geometry.
 *
 * The panel is portaled, so nothing about it follows the control by itself.
 * This observes the events that can move the control — window resize, any
 * scroll in the page (capture, so nested scrollers count), and the anchor's own
 * size changes — and re-derives the placement from a fresh rect each time. It
 * deliberately does not depend on the chip's measured width: a control can move
 * without its width changing, and a panel that only re-anchored on width would
 * be left behind.
 *
 * @param anchor - the control to anchor to, or `null` while unknown.
 * @param panel - the mounted panel, or `null` before its first render.
 * @param active - whether the panel is open at all.
 * @returns the style to apply, or `null` when there is nothing to anchor to.
 */
function useAnchoredStyle(anchor: HTMLElement | null, panel: HTMLElement | null, active: boolean): ReturnType<typeof anchoredStyle> | null {
  const [style, setStyle] = useState<ReturnType<typeof anchoredStyle> | null>(null)

  useEffect(() => {
    if (!active || anchor === null) {
      setStyle(null)
      return
    }
    const update = (): void => {
      if (!anchor.isConnected) return
      const next = anchoredStyle(anchor, panel)
      setStyle(current => current !== null && current.top === next.top && current.left === next.left
        && current.width === next.width && current.maxHeight === next.maxHeight ? current : next)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = new ResizeObserver(update)
    observer.observe(anchor)
    if (panel !== null) observer.observe(panel)
    // A sidebar toggle moves the anchor by resizing a budget ancestor without
    // scrolling or resizing the window, so those boxes are watched directly.
    for (const ancestor of budgetAncestors(anchor)) observer.observe(ancestor)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer.disconnect()
    }
  }, [anchor, panel, active])

  return style
}
