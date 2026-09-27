/** Plugin-owned JSON endpoint behind DSH's authenticated /api carrier. */
export const SCRATCH_PATH = '/api/session-bridge/ensure-workspace';
/** Validate the plugin-owned wire payload; no filesystem path is accepted. */
export function scratchTitle(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
        || Object.keys(payload).length !== 1 || !('title' in payload)
        || typeof payload.title !== 'string' || payload.title.trim().length === 0
        || payload.title.length > 80 || /[\u0000-\u001f]/u.test(payload.title)) {
        throw new TypeError('scratch request requires only a non-empty title of at most 80 characters');
    }
    return payload.title.trim();
}
/** Validate a response from the independently versioned Host half. */
export function scratchWorkspace(value) {
    if (typeof value !== 'object' || value === null || !('workspaceId' in value)
        || !('path' in value) || !('title' in value)
        || typeof value.workspaceId !== 'string' || value.workspaceId.length === 0
        || typeof value.path !== 'string' || value.path.length === 0
        || typeof value.title !== 'string' || value.title.length === 0) {
        throw new TypeError('session-bridge returned an invalid workspace');
    }
    return { workspaceId: value.workspaceId, path: value.path, title: value.title };
}
