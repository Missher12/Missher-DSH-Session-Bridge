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
import type { AgentLike, HostContext } from './dsh.ts';
/** How a bridged message enters the target Session's turn machinery. */
export type DeliveryMode = 'steer' | 'turn';
/** The observation one delivery reports back to its sender. */
export interface DeliveryResult {
    /** The target Session id actually addressed. */
    readonly sessionId: string;
    /** The exact reference the caller supplied. */
    readonly reference: string;
    /** Whether the message reached the target Agent's durable inbox. */
    readonly delivered: boolean;
    /** The mode actually used. */
    readonly mode: DeliveryMode;
    /** Whether the target was cold and had to be resumed before delivery. */
    readonly woke: boolean;
    /** Whether the target is in a turn after delivery. */
    readonly running: boolean;
    /** A human-readable refusal, when delivery did not happen. */
    readonly reason?: string;
}
/** Delivery policy the caller resolves once. */
export interface DeliveryPolicy {
    /** Resume a cold receiving Session so it can take the message. */
    readonly wakeColdSessions: boolean;
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
export declare function deliverToSession(ctx: HostContext, sender: AgentLike, reference: string, body: string, mode: DeliveryMode, policy: DeliveryPolicy): Promise<DeliveryResult>;
