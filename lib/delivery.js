/**
 * Cross-session delivery.
 *
 * A message from session A to session B becomes a durable `user/message` in
 * B's log, tagged with a `session-bridge` source naming A. Delivery goes
 * through B's own Agent inbox, so it obeys B's turn machinery instead of
 * writing history behind its back: a running B receives it at its next step
 * boundary, an idle B starts a fresh turn, and a cold B is woken through the
 * Host's ordinary Session-resume path first.
 *
 * @module dsh-session-bridge/delivery
 */
import { describeSession, resolveSessionRef, sessionTitle } from "./catalog.js";
import { info, sessionControllerOf } from "./dsh.js";
import { createBridgeMessage, frameBridgedText } from "./message.js";
/** Bring one cold Session back to life through the Host's own resume path. */
async function ensureLive(ctx, sessionId, cwd) {
    const existing = ctx.agents?.get(sessionId);
    if (existing !== undefined)
        return { agent: existing, woke: false };
    const controller = sessionControllerOf(ctx);
    if (controller !== undefined && cwd !== undefined) {
        try {
            await controller.create({ sessionId, cwd });
            const resumed = ctx.agents?.get(sessionId);
            if (resumed !== undefined)
                return { agent: resumed, woke: true };
        }
        catch (error) {
            return { woke: false, reason: `could not resume session "${sessionId}": ${stringifyError(error)}` };
        }
    }
    if (ctx.agents === undefined) {
        return { woke: false, reason: 'this Host composition has no Agent registry, so a cold session cannot be woken' };
    }
    try {
        const handle = await ctx.agents.resume({ resumeSessionId: sessionId });
        return { agent: handle.agent, woke: true };
    }
    catch (error) {
        return { woke: false, reason: `could not resume session "${sessionId}": ${stringifyError(error)}` };
    }
}
/** Render one thrown value as a single diagnostic line. */
function stringifyError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Deliver one text body from the sending Agent into another Session.
 *
 * @param ctx - Host context.
 * @param sender - the exact live Agent sending, used to record sender identity and to refuse self-delivery.
 * @param reference - the receiving Session's id, exact title, or unique id prefix.
 * @param body - the exact text to deliver.
 * @param mode - `steer` interleaves at the nearest step boundary and wakes an
 *   idle target; `turn` always queues a distinct next turn.
 * @param policy - whether a cold receiver may be resumed.
 * @returns what actually happened, never throwing for an ordinary refusal.
 */
export async function deliverToSession(ctx, sender, reference, body, mode, policy) {
    const refused = (reason, sessionId = reference) => ({ sessionId, reference, delivered: false, mode, woke: false, running: false, reason });
    if (body.trim().length === 0)
        return refused('the message body is empty');
    const resolved = await resolveSessionRef(ctx, sender.id, reference);
    if (!resolved.ok)
        return refused(resolved.reason);
    const targetId = resolved.sessionId;
    if (targetId === sender.id)
        return refused('a session cannot bridge a message to itself', targetId);
    const described = await describeSession(ctx, targetId);
    if (described === undefined)
        return refused(`no session "${targetId}" exists in this Host`, targetId);
    if (ctx.agents?.get(targetId) === undefined && !policy.wakeColdSessions) {
        return refused(`session "${targetId}" is cold and this deployment does not wake cold sessions to deliver `
            + '(set wakeColdSessions to allow it)', targetId);
    }
    const live = await ensureLive(ctx, targetId, described.cwd);
    if (live.agent === undefined)
        return refused(live.reason ?? `session "${targetId}" could not be activated`, targetId);
    const senderTitle = await sessionTitle(ctx, sender.id);
    const text = frameBridgedText(body, sender.id, senderTitle);
    const message = createBridgeMessage(text, sender.id, senderTitle);
    try {
        if (mode === 'turn')
            live.agent.followup(message);
        else
            live.agent.steer(message);
    }
    catch (error) {
        return {
            sessionId: targetId,
            reference,
            delivered: false,
            mode,
            woke: live.woke,
            running: false,
            reason: `session "${targetId}" rejected the message: ${stringifyError(error)}`,
        };
    }
    info(ctx, `session-bridge: delivered a ${mode} message from "${sender.id}" to "${targetId}"${live.woke ? ' (resumed a cold session)' : ''}`);
    return { sessionId: targetId, reference, delivered: true, mode, woke: live.woke, running: true };
}
