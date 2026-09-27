/** Plugin-owned, authenticated deletion route; the Host owns storage and lifecycle. */
export declare const SESSION_DELETE_PATH = "/api/session-bridge/delete-session";
/** Reject paths, extra fields, and requests that did not explicitly confirm deletion. */
export declare function deletionSessionId(payload: unknown): string;
