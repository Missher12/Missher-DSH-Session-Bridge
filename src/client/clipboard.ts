/**
 * Pure helpers behind the session-identity chip.
 *
 * Kept free of React and of the DOM so they can be unit-tested under Node and
 * reasoned about on their own: how an id is shortened for display, exactly
 * what each copy affordance puts on the clipboard, and how a clipboard write
 * degrades when the async Clipboard API is unavailable.
 *
 * @module dsh-session-bridge/client/clipboard
 */

/** How many leading characters of the id stay visible in the collapsed chip. */
const SHORT_HEAD = 8

/** How many trailing characters stay visible, so two similar ids still differ. */
const SHORT_TAIL = 4

/**
 * Shorten one session id for the collapsed chip while keeping it recognizable.
 *
 * A DSH session id is `session-<uuid>`. Dropping the constant prefix and the
 * middle of the uuid leaves `af569227…791a`, which fits the header band beside
 * the agent-preset label and the job counter.
 *
 * @param sessionId - the full durable session id.
 * @returns the shortened display form; the input itself when it is already short.
 */
export function shortenSessionId(sessionId: string): string {
  const body = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId
  if (body.length <= SHORT_HEAD + SHORT_TAIL + 1) return body
  return `${body.slice(0, SHORT_HEAD)}…${body.slice(-SHORT_TAIL)}`
}

/** One thing the chip can put on the clipboard. */
export interface CopyPayload {
  /** Stable identity of the field, used for the per-field "copied" acknowledgement. */
  readonly key: 'id' | 'cwd' | 'bridge'
  /** Exact text written to the clipboard. */
  readonly text: string
}

/**
 * Build the exact clipboard text for one field.
 *
 * The `bridge` payload is the whole point of the panel: it is the literal
 * prefix a human pastes into another session's composer, which is the manual
 * form of what `session_send` does for the model. A trailing space is kept so
 * the caret lands ready for the message.
 *
 * @param key - which field to render.
 * @param sessionId - the full session id.
 * @param cwd - the session working directory, when the client knows it.
 * @returns the payload, or `undefined` when the field has nothing to copy.
 */
export function copyPayload(
  key: CopyPayload['key'],
  sessionId: string,
  cwd: string | undefined,
): CopyPayload | undefined {
  switch (key) {
    case 'id':
      return { key, text: sessionId }
    case 'cwd':
      return cwd === undefined || cwd.length === 0 ? undefined : { key, text: cwd }
    case 'bridge':
      // Slash-command form: it needs no quoting even when the id contains
      // characters a shell would treat specially, because the composer parses
      // the first whitespace-delimited token as the target.
      return { key, text: `/bridge ${sessionId} ` }
  }
}

/** Copy result the chip renders an acknowledgement for. */
export type CopyOutcome = 'copied' | 'failed'

/** The clipboard surface this module needs, structurally. */
interface ClipboardHost {
  readonly navigator?: { readonly clipboard?: { writeText(text: string): Promise<void> } }
  readonly document?: Document
}

/**
 * Write one string to the system clipboard.
 *
 * Prefers the async Clipboard API. The GUI is served from loopback, which is a
 * secure context, so that path is normally available; the `execCommand`
 * fallback exists because a page embedded in a webview or opened over a
 * non-secure origin would otherwise fail silently, and a copy button that
 * quietly does nothing is worse than one that reports failure.
 *
 * @param text - exact text to place on the clipboard.
 * @param host - injectable globals, defaulting to the real ones; tests pass a stub.
 * @returns whether the text reached the clipboard.
 */
export async function writeClipboard(text: string, host: ClipboardHost = globalThis): Promise<CopyOutcome> {
  const clipboard = host.navigator?.clipboard
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text)
      return 'copied'
    } catch {
      // Permission denial or an unfocused document: fall through to the legacy path.
    }
  }
  const doc = host.document
  if (doc === undefined || typeof doc.execCommand !== 'function') return 'failed'
  try {
    const scratch = doc.createElement('textarea')
    scratch.value = text
    // Keep the scratch node invisible and non-scrolling without letting it
    // take focus away from the composer: `position: fixed` plus zero opacity
    // is the combination that survives every browser's copy heuristics.
    scratch.setAttribute('readonly', '')
    scratch.style.position = 'fixed'
    scratch.style.top = '0'
    scratch.style.left = '0'
    scratch.style.opacity = '0'
    scratch.style.pointerEvents = 'none'
    doc.body.appendChild(scratch)
    scratch.select()
    const ok = doc.execCommand('copy')
    scratch.remove()
    return ok ? 'copied' : 'failed'
  } catch {
    return 'failed'
  }
}
