/**
 * The durable message envelope one bridged Session receives.
 *
 * A cross-session message is a real `user/message` in the receiving Session
 * log — it is not a fake tool result and not a prompt-only whisper — so it
 * survives reload, participates in compaction, and is visible to the human in
 * the receiving conversation. Its `source` records the sender so a reader can
 * tell a bridged message from something the human typed.
 *
 * @module dsh-session-bridge/message
 */
/** The `source.kind` every bridged message carries. */
export declare const BRIDGE_SOURCE_KIND = "session-bridge";
/** One bridged message's durable sender and source identity. */
export interface BridgeMessageSource {
    readonly kind: typeof BRIDGE_SOURCE_KIND;
    /** Exact sending Session id, so the receiver can reply to it. */
    readonly senderSessionId: string;
    /** Best-effort sending Session title at delivery time. */
    readonly senderTitle?: string;
    /** Delivery identity, stable across a retry of the same send. */
    readonly messageId: string;
}
/** One durable conversation message, as the Agent loop accepts it. */
export interface BridgedUserMessage {
    readonly id: string;
    readonly role: 'user';
    readonly content: ReadonlyArray<{
        readonly type: 'text';
        readonly text: string;
    }>;
    readonly source: BridgeMessageSource;
}
/**
 * Build one immutable bridged user message.
 *
 * Mirrors the Host's own `createUserMessage` (detached, deep-frozen, freshly
 * identified) without importing it, so the plugin stays dependency-free while
 * producing a value the Session log accepts losslessly.
 *
 * @param text - exact model-facing body.
 * @param senderSessionId - the sending Session's durable id.
 * @param senderTitle - the sending Session's title, when known.
 * @returns a frozen user-role message carrying a `session-bridge` source.
 */
export declare function createBridgeMessage(text: string, senderSessionId: string, senderTitle: string | undefined): BridgedUserMessage;
/**
 * Frame a sender's body so the receiving model can tell it apart from the
 * human at its own keyboard, and can address a reply back.
 *
 * The frame states the sender and source explicitly: the receiving model must
 * treat the body as a peer request, never as authority it does not have.
 *
 * @param body - the exact text the sender asked to deliver.
 * @param senderSessionId - the sending Session's durable id.
 * @param senderTitle - the sending Session's title, when known.
 * @returns the complete model-facing message text.
 */
export declare function frameBridgedText(body: string, senderSessionId: string, senderTitle: string | undefined): string;
/** Test whether a message source is a bridged cross-session message. */
export declare function isBridgeSource(source: unknown): source is BridgeMessageSource;
