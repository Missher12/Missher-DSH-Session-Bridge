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
import { sessionControllerOf, sessionQueryOf } from "./dsh.js";
/** Read the username-visible title out of one summary's projection hints. */
function summaryTitle(summary) {
    const value = summary.projections?.values?.['title'];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
/**
 * Whether one service exposes `name` as a callable method.
 *
 * A service can be mounted while a particular method is absent — an older or
 * narrower composition, or a Host that never carried the upstream extension.
 * The bridge must then take its honest degraded path instead of treating the
 * missing method as an empty result.
 *
 * @param service - the mounted service, or `undefined`.
 * @param name - the method to look for.
 * @returns `true` only when the member is a function.
 */
function callable(service, name) {
    return typeof service?.[name] === 'function';
}
/**
 * Build the diagnostic for a Host that can neither list Sessions nor read them.
 *
 * Reports the exact required method for each seam, and only states that a
 * service is absent when it really is: a service that is mounted but lacks the
 * method must not be described as missing, and a mounted service must not be
 * described as absent. Cases are mutually exclusive.
 *
 * @param controller - the mounted Session Controller, if any.
 * @param query - the mounted Session Query engine, if any.
 * @returns the message for the thrown error.
 */
function noSessionListingReason(controller, query) {
    const parts = [];
    if (controller === undefined)
        parts.push('the session-controller service is not mounted');
    else if (!callable(controller, 'list'))
        parts.push('the mounted session-controller service has no list() method');
    if (query === undefined)
        parts.push('the session-query service is not mounted');
    else if (!callable(query, 'listSessions'))
        parts.push('the mounted session-query service has no listSessions() method');
    return 'session bridge cannot list sessions: ' + parts.join('; ')
        + '; this Host must provide sessionController.list() or sessionQuery.listSessions()';
}
/**
 * List every Session the Host knows about, newest activity first.
 *
 * Prefers the Session Controller listing because it is the sidebar's own
 * projection and carries cached titles; falls back to the query engine's
 * live-preferred corpus, which yields every identity but no titles.
 *
 * @param ctx - Host context.
 * @param selfId - the asking Session's id, marked `self` and sorted first.
 * @returns all rows; callers apply display limits after filtering or resolving.
 * @throws when this Host provides neither listing seam, rather than reporting
 * an empty Host: "no Sessions" and "cannot see Sessions" must stay distinct.
 */
export async function listSessionRows(ctx, selfId) {
    const controller = sessionControllerOf(ctx);
    const query = sessionQueryOf(ctx);
    const canList = callable(controller, 'list');
    const canQuery = callable(query, 'listSessions');
    if (!canList && !canQuery)
        throw new Error(noSessionListingReason(controller, query));
    const rows = [];
    if (canList) {
        const listed = await controller.list({});
        for (const summary of listed.items) {
            const title = summaryTitle(summary);
            const projectedCwd = summary.projections?.values?.['workingDirectory'];
            const cwd = typeof projectedCwd === 'string' && projectedCwd.length > 0 ? projectedCwd : summary.cwd;
            rows.push({
                sessionId: summary.sessionId,
                ...(title === undefined ? {} : { title }),
                ...(cwd === undefined ? {} : { cwd }),
                live: summary.agentAvailable,
                running: summary.running,
                updatedAt: summary.updatedAt,
                ...(summary.origin === undefined ? {} : { origin: summary.origin }),
                ...(summary.parentSessionId === undefined ? {} : { parentSessionId: summary.parentSessionId }),
                self: summary.sessionId === selfId,
            });
        }
    }
    else {
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
            });
        }
    }
    const known = new Set(rows.map(row => row.sessionId));
    // A live root Session created outside the listing (a scratch session that has
    // not been persisted yet, for instance) must still be addressable.
    for (const agent of ctx.agents?.list() ?? []) {
        if (known.has(agent.id))
            continue;
        const header = agent.session?.header;
        rows.push({
            sessionId: agent.id,
            ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
            live: true,
            running: true,
            ...(header?.origin === undefined ? {} : { origin: header.origin }),
            self: agent.id === selfId,
        });
    }
    rows.sort((left, right) => Number(right.self) - Number(left.self)
        || (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
        || left.sessionId.localeCompare(right.sessionId));
    return rows;
}
/** Join the text blocks of one content array. */
function textContent(content) {
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const block of content) {
        if (block === null || typeof block !== 'object')
            continue;
        const candidate = block;
        if (candidate.type === 'text' && typeof candidate.text === 'string')
            parts.push(candidate.text);
    }
    return parts.join('\n');
}
/**
 * Project one Session's current model-visible conversation into bounded turns.
 *
 * Tool results, reasoning, and injected system/developer context are excluded:
 * a peer Session wants the conversation, not the transcript of someone else's
 * file reads.
 *
 * @param ctx - Host context.
 * @param session - the resolved row from this operation's current Host listing.
 * @param maxTurns - maximum retained turns, newest kept.
 * @returns the bounded transcript.
 * @throws when the Session is unknown to the Host.
 */
export async function readTranscript(ctx, session, maxTurns) {
    const { sessionId } = session;
    const query = sessionQueryOf(ctx);
    if (!callable(query, 'readSurface')) {
        throw new Error('session bridge cannot read another session: the session-query service is not mounted '
            + 'with readSurface(); a Host providing sessionQuery.readSurface() is required');
    }
    const snapshot = await query.readSurface(sessionId);
    const turns = [];
    for (const event of snapshot.events) {
        if (event.type === 'user/message') {
            const data = event.data;
            const text = textContent(data?.content);
            if (text.trim() === '')
                continue;
            const kind = data?.source?.kind;
            turns.push({ role: 'user', text, ...(typeof kind === 'string' ? { source: kind } : {}) });
        }
        else if (event.type === 'assistant/message') {
            const data = event.data;
            const text = textContent(data?.message?.content);
            if (text.trim() === '')
                continue;
            turns.push({ role: 'assistant', text });
        }
        else if (event.type === 'compaction/checkpoint' || event.type === 'session/checkpoint') {
            turns.push({ role: 'context', text: '[compaction checkpoint]' });
        }
    }
    const totalTurns = turns.length;
    const retained = totalTurns > maxTurns ? turns.slice(totalTurns - maxTurns) : turns;
    const liveAgent = ctx.agents?.get(sessionId);
    const projection = await sessionControllerOf(ctx)?.projections?.({ sessionId }, new AbortController().signal);
    const projectedCwd = projection?.values?.['workingDirectory'];
    const cwd = typeof projectedCwd === 'string' && projectedCwd.length > 0
        ? projectedCwd : session.cwd ?? snapshot.session.cwd;
    return {
        sessionId,
        header: snapshot.session,
        ...(session.title === undefined ? {} : { title: session.title }),
        ...(cwd === undefined ? {} : { cwd }),
        live: liveAgent !== undefined,
        running: session.running,
        turns: retained,
        totalTurns,
        truncated: retained.length < totalTurns,
    };
}
/**
 * Resolve what a human or a peer model wrote into an exact Session id.
 *
 * Codex resolves `codex resume`/`codex queue --thread` against "a UUID or a
 * session name, UUIDs taking precedence". DSH session ids are long, so the
 * same affordance matters here: an exact id wins, then an exact
 * case-insensitive title, then a unique id prefix. An ambiguous title or
 * prefix is refused with the candidates rather than guessed at.
 *
 * @param rows - the complete listing already read for this operation.
 * @param reference - an id, a title, or an id prefix.
 * @returns the matched Session row, or the reason no single one was meant.
 */
export function resolveSessionRef(rows, reference) {
    const wanted = reference.trim();
    if (wanted.length === 0)
        return { ok: false, reason: 'no session reference was given' };
    const exactId = rows.find(row => row.sessionId === wanted);
    if (exactId !== undefined)
        return { ok: true, session: exactId, how: 'id' };
    const folded = wanted.toLowerCase();
    const byTitle = rows.filter(row => row.title !== undefined && row.title.toLowerCase() === folded);
    if (byTitle.length === 1) {
        const only = byTitle[0];
        return { ok: true, session: only, how: 'title' };
    }
    if (byTitle.length > 1) {
        return { ok: false, reason: `"${wanted}" names ${byTitle.length} sessions: ${byTitle.map(row => row.sessionId).join(', ')}` };
    }
    const byPrefix = rows.filter(row => row.sessionId.startsWith(wanted));
    if (byPrefix.length === 1) {
        const only = byPrefix[0];
        return { ok: true, session: only, how: 'prefix' };
    }
    if (byPrefix.length > 1) {
        return { ok: false, reason: `"${wanted}" is an ambiguous id prefix matching ${byPrefix.length} sessions: ${byPrefix.slice(0, 5).map(row => row.sessionId).join(', ')}` };
    }
    return { ok: false, reason: `no session id, title, or id prefix matches "${wanted}"` };
}
/** Read one live Agent's own header for the asking Session. */
export function selfHeader(agent) {
    return agent?.session?.header;
}
