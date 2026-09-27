/**
 * Session discovery and transcript reading.
 *
 * Everything the bridge knows about *other* sessions comes from the Host's own
 * read-only surfaces — `ctx.sessionController.list` for the grouped listing
 * (which is the same projection the Web sidebar shows) and
 * `ctx.sessionQuery.readSurface` for a Session's current model-visible
 * conversation. The bridge never resumes a Session to look at it, so listing
 * and reading are side-effect free.
 *
 * @module dsh-session-bridge/catalog
 */

import type {
  AgentLike,
  HostContext,
  SessionHeaderLike,
  SessionSummaryLike,
  SessionSurfaceSnapshotLike,
} from './dsh.ts'
import { sessionControllerOf, sessionQueryOf, sessionsOf } from './dsh.ts'

/** One Session as the bridge presents it to a model or a human. */
export interface SessionRow {
  readonly sessionId: string
  /** Latest title, when one has been generated or set. */
  readonly title?: string
  /** Working directory the Session owns. */
  readonly cwd?: string
  /** Whether a live Agent currently holds the Session in this process. */
  readonly live: boolean
  /** Whether that Agent is inside a turn right now. */
  readonly running: boolean
  /** Last activity timestamp in epoch milliseconds, when known. */
  readonly updatedAt?: number
  /** `subagent` for a delegated child Session; absent for an ordinary one. */
  readonly origin?: string
  /** Parent Session id for a delegated child. */
  readonly parentSessionId?: string
  /** Whether this row is the Session asking. */
  readonly self: boolean
}

/** One projected conversation turn. */
export interface TranscriptTurn {
  readonly role: 'user' | 'assistant' | 'context'
  readonly text: string
  /** `source.kind` of a user-role turn, when the log records one. */
  readonly source?: string
}

/** A bounded read of one Session's current conversation. */
export interface Transcript {
  readonly sessionId: string
  readonly header: SessionHeaderLike
  readonly title?: string
  readonly cwd?: string
  readonly live: boolean
  readonly running: boolean
  /** Oldest-first retained turns. */
  readonly turns: readonly TranscriptTurn[]
  /** Total user/assistant turns observed before retention. */
  readonly totalTurns: number
  /** Whether the oldest turns were dropped to fit `maxTurns`. */
  readonly truncated: boolean
}

/** The `ctx.sessionQuery` slice, extended with the surface reader. */
type SurfaceReader = HostContext['sessionQuery'] & {
  readSurface(sessionId: string): Promise<SessionSurfaceSnapshotLike>
}

/** Read the username-visible title out of one summary's projection hints. */
function summaryTitle(summary: SessionSummaryLike): string | undefined {
  const value = summary.projections?.values?.['title']
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * List every Session the Host knows about, newest activity first.
 *
 * Prefers the Session Controller listing because it is the sidebar's own
 * projection and carries cached titles; falls back to the query engine's
 * live-preferred corpus, which yields every identity but no titles.
 *
 * @param ctx - Host context.
 * @param selfId - the asking Session's id, marked `self` and excluded from `others`.
 * @param limit - maximum rows returned.
 * @returns at most `limit` rows ordered newest first.
 */
export async function listSessionRows(
  ctx: HostContext,
  selfId: string,
  limit: number,
): Promise<SessionRow[]> {
  const controller = sessionControllerOf(ctx)
  const rows: SessionRow[] = []
  if (controller !== undefined) {
    const listed = await controller.list({})
    for (const summary of listed.items) {
      rows.push({
        sessionId: summary.sessionId,
        ...(summaryTitle(summary) === undefined ? {} : { title: summaryTitle(summary) as string }),
        ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
        live: summary.agentAvailable,
        running: summary.running,
        updatedAt: summary.updatedAt,
        ...(summary.origin === undefined ? {} : { origin: summary.origin }),
        ...(summary.parentSessionId === undefined ? {} : { parentSessionId: summary.parentSessionId }),
        self: summary.sessionId === selfId,
      })
    }
  } else {
    const query = sessionQueryOf(ctx)
    if (query === undefined) return rows
    for (const record of await query.listSessions()) {
      rows.push({
        sessionId: record.header.id,
        ...(record.header.cwd === undefined ? {} : { cwd: record.header.cwd }),
        live: record.live || ctx.agents?.get(record.header.id) !== undefined,
        running: false,
        ...(record.header.createdAt === undefined ? {} : { updatedAt: record.header.createdAt }),
        ...(record.header.origin === undefined ? {} : { origin: record.header.origin }),
        ...(record.header.parentSession === undefined ? {} : { parentSessionId: record.header.parentSession }),
        self: record.header.id === selfId,
      })
    }
  }

  const known = new Set(rows.map(row => row.sessionId))
  // A live root Session created outside the listing (a scratch session that has
  // not been persisted yet, for instance) must still be addressable.
  for (const agent of ctx.agents?.list() ?? []) {
    if (known.has(agent.id)) continue
    const header = agent.session?.header
    rows.push({
      sessionId: agent.id,
      ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
      live: true,
      running: true,
      ...(header?.origin === undefined ? {} : { origin: header.origin }),
      self: agent.id === selfId,
    })
  }

  rows.sort((left, right) =>
    Number(right.self) - Number(left.self)
    || (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
    || left.sessionId.localeCompare(right.sessionId))
  return rows.slice(0, limit)
}

/** Join the text blocks of one content array. */
function textContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { readonly type?: unknown; readonly text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
  }
  return parts.join('\n')
}

/**
 * Project one Session's current model-visible conversation into bounded turns.
 *
 * Tool results, reasoning, and injected system/developer context are excluded:
 * a peer Session wants the conversation, not the transcript of someone else's
 * file reads.
 *
 * @param ctx - Host context.
 * @param sessionId - the Session to read.
 * @param maxTurns - maximum retained turns, newest kept.
 * @returns the bounded transcript.
 * @throws when the Session is unknown to the Host.
 */
export async function readTranscript(
  ctx: HostContext,
  sessionId: string,
  maxTurns: number,
): Promise<Transcript> {
  const query = sessionQueryOf(ctx)
  if (query === undefined || typeof query.readSurface !== 'function') {
    throw new Error('session bridge needs the session-query service to read another session')
  }
  const snapshot = await query.readSurface(sessionId)
  const turns: TranscriptTurn[] = []
  for (const event of snapshot.events) {
    if (event.type === 'user/message') {
      const data = event.data as { readonly content?: unknown; readonly source?: { readonly kind?: unknown } } | undefined
      const text = textContent(data?.content)
      if (text.trim() === '') continue
      const kind = data?.source?.kind
      turns.push({ role: 'user', text, ...(typeof kind === 'string' ? { source: kind } : {}) })
    } else if (event.type === 'assistant/message') {
      const data = event.data as { readonly message?: { readonly content?: unknown } } | undefined
      const text = textContent(data?.message?.content)
      if (text.trim() === '') continue
      turns.push({ role: 'assistant', text })
    } else if (event.type === 'compaction/checkpoint' || event.type === 'session/checkpoint') {
      turns.push({ role: 'context', text: '[compaction checkpoint]' })
    }
  }

  const totalTurns = turns.length
  const retained = totalTurns > maxTurns ? turns.slice(totalTurns - maxTurns) : turns
  const liveAgent = ctx.agents?.get(sessionId)
  const summary = await findSummary(ctx, sessionId)
  return {
    sessionId,
    header: snapshot.session,
    ...(summary?.title === undefined ? {} : { title: summary.title }),
    ...(snapshot.session.cwd === undefined ? {} : { cwd: snapshot.session.cwd }),
    live: liveAgent !== undefined,
    running: summary?.running ?? false,
    turns: retained,
    totalTurns,
    truncated: retained.length < totalTurns,
  }
}

/** Resolve one Session's title, liveness, and cwd from the Host listing, when available. */
async function findSummary(
  ctx: HostContext,
  sessionId: string,
): Promise<{ readonly title?: string; readonly running: boolean; readonly cwd?: string } | undefined> {
  const controller = sessionControllerOf(ctx)
  if (controller === undefined) return undefined
  try {
    const listed = await controller.list({})
    const summary = listed.items.find(item => item.sessionId === sessionId)
    if (summary === undefined) return undefined
    const title = summaryTitle(summary)
    return {
      ...(title === undefined ? {} : { title }),
      running: summary.running,
      ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
    }
  } catch {
    return undefined
  }
}

/**
 * Resolve a Session's title without reading its log, for message framing.
 * @param ctx - Host context.
 * @param sessionId - the Session to name.
 * @returns the latest title, or `undefined`.
 */
export async function sessionTitle(ctx: HostContext, sessionId: string): Promise<string | undefined> {
  return (await findSummary(ctx, sessionId))?.title
}

/** One resolved Session reference. */
export type SessionRefResolution =
  | { readonly ok: true; readonly sessionId: string; readonly how: 'id' | 'title' | 'prefix' }
  | { readonly ok: false; readonly reason: string }

/**
 * Resolve what a human or a peer model wrote into an exact Session id.
 *
 * Codex resolves `codex resume`/`codex queue --thread` against "a UUID or a
 * session name, UUIDs taking precedence". DSH session ids are long, so the
 * same affordance matters here: an exact id wins, then an exact
 * case-insensitive title, then a unique id prefix. An ambiguous title or
 * prefix is refused with the candidates rather than guessed at.
 *
 * @param ctx - Host context.
 * @param selfId - the asking Session, excluded from matching.
 * @param reference - an id, a title, or an id prefix.
 * @returns the exact Session id, or the reason no single one was meant.
 */
export async function resolveSessionRef(
  ctx: HostContext,
  selfId: string,
  reference: string,
): Promise<SessionRefResolution> {
  const wanted = reference.trim()
  if (wanted.length === 0) return { ok: false, reason: 'no session reference was given' }

  const rows = await listSessionRows(ctx, selfId, 500)
  const exactId = rows.find(row => row.sessionId === wanted)
  if (exactId !== undefined) return { ok: true, sessionId: exactId.sessionId, how: 'id' }

  const folded = wanted.toLowerCase()
  const byTitle = rows.filter(row => row.title !== undefined && row.title.toLowerCase() === folded)
  if (byTitle.length === 1) {
    const only = byTitle[0] as SessionRow
    return { ok: true, sessionId: only.sessionId, how: 'title' }
  }
  if (byTitle.length > 1) {
    return { ok: false, reason: `"${wanted}" names ${byTitle.length} sessions: ${byTitle.map(row => row.sessionId).join(', ')}` }
  }

  const byPrefix = rows.filter(row => row.sessionId.startsWith(wanted))
  if (byPrefix.length === 1) {
    const only = byPrefix[0] as SessionRow
    return { ok: true, sessionId: only.sessionId, how: 'prefix' }
  }
  if (byPrefix.length > 1) {
    return { ok: false, reason: `"${wanted}" is an ambiguous id prefix matching ${byPrefix.length} sessions: ${byPrefix.slice(0, 5).map(row => row.sessionId).join(', ')}` }
  }
  return { ok: false, reason: `no session id, title, or id prefix matches "${wanted}"` }
}

/**
 * Describe one live-or-durable Session well enough to address a message to it.
 * @param ctx - Host context.
 * @param sessionId - the Session to describe.
 * @returns the Session's cwd and title, or `undefined` when the Host does not know it.
 */
export async function describeSession(
  ctx: HostContext,
  sessionId: string,
): Promise<{ readonly cwd?: string; readonly title?: string } | undefined> {
  const live = ctx.agents?.get(sessionId)
  const attached = sessionsOf(ctx)?.get(sessionId)
  const header = live?.session?.header ?? attached?.header
  const summary = await findSummary(ctx, sessionId)
  if (header === undefined && summary === undefined) return undefined
  const cwd = header?.cwd ?? summary?.cwd
  return {
    ...(cwd === undefined ? {} : { cwd }),
    ...(summary?.title === undefined ? {} : { title: summary.title }),
  }
}

/** Read one live Agent's own header for the asking Session. */
export function selfHeader(agent: AgentLike | undefined): SessionHeaderLike | undefined {
  return agent?.session?.header
}
