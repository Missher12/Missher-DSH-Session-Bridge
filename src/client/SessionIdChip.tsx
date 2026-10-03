/**
 * The session-identity chip: a header control that shows this session's id and
 * puts it — or its working directory, or a ready-to-paste `/bridge` prefix — on
 * the clipboard in one click.
 *
 * This is the human half of the bridge. The model already has `session_send`;
 * a person reading a conversation had no way to obtain the id that call takes,
 * so the feature was unusable from the UI. The affordance deliberately mirrors
 * Codex's status panel, where the session id is a first-class copy target
 * rather than text that happens to be on screen.
 *
 * @module dsh-session-bridge/client/SessionIdChip
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
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
  /** Namespace translator injected by the slot registration's `locale`. */
  readonly t?: Translate
}

/** How long a copy acknowledgement stays before the chip resets. */
const ACK_MS = 1_600

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
 * Render the identity chip for one session.
 *
 * The collapsed chip copies the full id on a single press — the common case —
 * and its caret opens the panel holding the id, the working directory, and the
 * `/bridge` prefix. Every field acknowledges its own outcome, so a clipboard
 * refusal is visible instead of silent.
 *
 * @param props - the session id, the session snapshot selector, and the translator.
 * @returns the chip and, when open, its panel.
 */
export function SessionIdChip({ sessionId, useSessions, t }: SessionIdChipProps): ReactNode {
  const cwd = useSessions === undefined
    ? undefined
    : useSessions(snapshot => snapshot?.byId?.[sessionId]?.cwd)
  const [open, setOpen] = useState(false)
  const [ack, setAck] = useState<{ key: CopyPayload['key']; outcome: CopyOutcome } | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<HTMLButtonElement>(null)

  // One acknowledgement at a time, cleared on a timer so the chip returns to
  // its resting state without any further interaction.
  useEffect(() => {
    if (ack === undefined) return
    const timer = setTimeout(() => { setAck(undefined) }, ACK_MS)
    return () => { clearTimeout(timer) }
  }, [ack])

  // Close on an outside press, including one landing in the composer.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [open])

  const copy = async (payload: CopyPayload | undefined): Promise<void> => {
    if (payload === undefined) return
    const outcome = await writeClipboard(payload.text)
    setAck({ key: payload.key, outcome })
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    caretRef.current?.focus()
  }

  const idPayload = copyPayload('id', sessionId, cwd)
  const cwdPayload = copyPayload('cwd', sessionId, cwd)
  const bridgePayload = copyPayload('bridge', sessionId, cwd)
  const chipAck = ack?.key === 'id' ? ack.outcome : undefined
  const chipLabel = chipAck === 'copied'
    ? text(t, 'chip.copied')
    : chipAck === 'failed' ? text(t, 'chip.failed') : text(t, 'chip.copy')

  return (
    <div ref={rootRef} className="dsh-sbc-root" data-session-id={sessionId} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="dsh-sbc-chip"
        data-copy-state={chipAck ?? 'idle'}
        aria-label={chipLabel}
        title={`${text(t, 'chip.copy')} · ${sessionId}`}
        onClick={() => { void copy(idPayload) }}
      >
        <span className="dsh-sbc-chipId">{sessionId}</span>
        <span className="dsh-sbc-chipIcon">{chipAck === 'copied' ? <CheckIcon /> : <CopyIcon />}</span>
      </button>
      <button
        ref={caretRef}
        type="button"
        className="dsh-sbc-caret"
        aria-expanded={open}
        aria-label={text(t, 'chip.open')}
        title={text(t, 'chip.open')}
        onClick={() => { setOpen(current => !current) }}
      >
        <CaretIcon open={open} />
      </button>
      {open
        ? (
          <div className="dsh-sbc-panel" role="dialog" aria-label={text(t, 'panel.title')}>
            <div className="dsh-sbc-panelTitle">{text(t, 'panel.title')}</div>
            <Row
              fieldKey="id"
              label={text(t, 'panel.id')}
              value={sessionId}
              payload={idPayload}
              {...ack?.key === 'id' ? { state: ack.outcome } : {}}
              onCopy={payload => { void copy(payload) }}
              {...t === undefined ? {} : { t }}
            />
            <Row
              fieldKey="cwd"
              label={text(t, 'panel.cwd')}
              value={cwd === undefined || cwd.length === 0 ? text(t, 'panel.cwdUnknown') : cwd}
              payload={cwdPayload}
              {...ack?.key === 'cwd' ? { state: ack.outcome } : {}}
              onCopy={payload => { void copy(payload) }}
              {...t === undefined ? {} : { t }}
            />
            <Row
              fieldKey="bridge"
              label={text(t, 'panel.bridge')}
              value={bridgePayload?.text.trimEnd() ?? ''}
              hint={text(t, 'panel.bridgeHint')}
              payload={bridgePayload}
              {...ack?.key === 'bridge' ? { state: ack.outcome } : {}}
              onCopy={payload => { void copy(payload) }}
              {...t === undefined ? {} : { t }}
            />
          </div>
        )
        : null}
    </div>
  )
}
