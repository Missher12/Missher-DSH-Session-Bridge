/** Plugin-owned, authenticated move route; the Host owns the Session log and workspace accounting. */
export declare const SESSION_MOVE_PATH = "/api/session-bridge/move-session";
/** One validated move request. */
export interface MoveRequest {
    readonly sessionId: string;
    readonly targetWorkspaceId: string;
}
/**
 * Reject paths, extra fields, and requests that did not explicitly confirm the move.
 * @param payload - parsed JSON body.
 * @returns the exact identities to move.
 */
export declare function moveSessionRequest(payload: unknown): MoveRequest;
