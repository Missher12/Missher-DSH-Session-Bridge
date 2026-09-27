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
import type { AgentLike, HostContext, SessionHeaderLike } from './dsh.ts';
/** One Session as the bridge presents it to a model or a human. */
export interface SessionRow {
    readonly sessionId: string;
    /** Latest title, when one has been generated or set. */
    readonly title?: string;
    /** Working directory the Session owns. */
    readonly cwd?: string;
    /** Whether a live Agent currently holds the Session in this process. */
    readonly live: boolean;
    /** Whether that Agent is inside a turn right now. */
    readonly running: boolean;
    /** Last activity timestamp in epoch milliseconds, when known. */
    readonly updatedAt?: number;
    /** `subagent` for a delegated child Session; absent for an ordinary one. */
    readonly origin?: string;
    /** Parent Session id for a delegated child. */
    readonly parentSessionId?: string;
    /** Whether this row is the Session asking. */
    readonly self: boolean;
}
/** One projected conversation turn. */
export interface TranscriptTurn {
    readonly role: 'user' | 'assistant' | 'context';
    readonly text: string;
    /** `source.kind` of a user-role turn, when the log records one. */
    readonly source?: string;
}
/** A bounded read of one Session's current conversation. */
export interface Transcript {
    readonly sessionId: string;
    readonly header: SessionHeaderLike;
    readonly title?: string;
    readonly cwd?: string;
    readonly live: boolean;
    readonly running: boolean;
    /** Oldest-first retained turns. */
    readonly turns: readonly TranscriptTurn[];
    /** Total user/assistant turns observed before retention. */
    readonly totalTurns: number;
    /** Whether the oldest turns were dropped to fit `maxTurns`. */
    readonly truncated: boolean;
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
export declare function listSessionRows(ctx: HostContext, selfId: string, limit: number): Promise<SessionRow[]>;
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
export declare function readTranscript(ctx: HostContext, sessionId: string, maxTurns: number): Promise<Transcript>;
/**
 * Resolve a Session's title without reading its log, for message framing.
 * @param ctx - Host context.
 * @param sessionId - the Session to name.
 * @returns the latest title, or `undefined`.
 */
export declare function sessionTitle(ctx: HostContext, sessionId: string): Promise<string | undefined>;
/** One resolved Session reference. */
export type SessionRefResolution = {
    readonly ok: true;
    readonly sessionId: string;
    readonly how: 'id' | 'title' | 'prefix';
} | {
    readonly ok: false;
    readonly reason: string;
};
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
export declare function resolveSessionRef(ctx: HostContext, selfId: string, reference: string): Promise<SessionRefResolution>;
/**
 * Describe one live-or-durable Session well enough to address a message to it.
 * @param ctx - Host context.
 * @param sessionId - the Session to describe.
 * @returns the Session's cwd and title, or `undefined` when the Host does not know it.
 */
export declare function describeSession(ctx: HostContext, sessionId: string): Promise<{
    readonly cwd?: string;
    readonly title?: string;
} | undefined>;
/** Read one live Agent's own header for the asking Session. */
export declare function selfHeader(agent: AgentLike | undefined): SessionHeaderLike | undefined;
