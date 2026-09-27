/** Plugin-owned, authenticated deletion route; the Host owns storage and lifecycle. */
export const SESSION_DELETE_PATH = '/api/session-bridge/delete-session';
/** Reject paths, extra fields, and requests that did not explicitly confirm deletion. */
export function deletionSessionId(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
        || Object.keys(payload).length !== 2 || !('sessionId' in payload) || !('confirmed' in payload)
        || payload.confirmed !== true || typeof payload.sessionId !== 'string'
        || payload.sessionId.trim().length === 0 || payload.sessionId.length > 512
        || /[\u0000-\u001f/\\]/u.test(payload.sessionId)) {
        throw new TypeError('delete requires a sessionId and confirmed: true');
    }
    return payload.sessionId;
}
