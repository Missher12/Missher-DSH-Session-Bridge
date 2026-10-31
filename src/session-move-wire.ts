/** Plugin-owned, authenticated move route; the Host owns the Session log and workspace accounting. */
export const SESSION_MOVE_PATH = '/api/session-bridge/move-session'

/** One validated move request. */
export interface MoveRequest {
  readonly sessionId: string
  readonly targetWorkspaceId: string
}

/**
 * Reject paths, extra fields, and requests that did not explicitly confirm the move.
 * @param payload - parsed JSON body.
 * @returns the exact identities to move.
 */
export function moveSessionRequest(payload: unknown): MoveRequest {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
    || Object.keys(payload).length !== 3 || !('sessionId' in payload)
    || !('targetWorkspaceId' in payload) || !('confirmed' in payload)
    || payload.confirmed !== true
    || !isIdentity(payload.sessionId) || !isIdentity(payload.targetWorkspaceId)) {
    throw new TypeError('move requires sessionId, targetWorkspaceId and confirmed: true')
  }
  return { sessionId: payload.sessionId, targetWorkspaceId: payload.targetWorkspaceId }
}

/**
 * One bounded, filesystem-safe identity.
 * @param value - unknown payload field.
 * @returns whether it is a usable identity string.
 */
function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512
    && !/[\u0000-\u001f/\\]/u.test(value)
}
