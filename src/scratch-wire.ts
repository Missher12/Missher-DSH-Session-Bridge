/** Plugin-owned JSON endpoint behind DSH's authenticated /api carrier. */
export const SCRATCH_PATH = '/api/session-bridge/ensure-workspace'

/** The canonical workspace committed by the Host before navigation. */
export interface ScratchWorkspace {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
}

/** The plugin's result envelope; client stores retain their own return types. */
export type ScratchResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

/** Validate the plugin-owned wire payload; no filesystem path is accepted. */
export function scratchTitle(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
    || Object.keys(payload).length !== 1 || !('title' in payload)
    || typeof payload.title !== 'string' || payload.title.trim().length === 0
    || payload.title.length > 80 || /[\u0000-\u001f]/u.test(payload.title)) {
    throw new TypeError('scratch request requires only a non-empty title of at most 80 characters')
  }
  return payload.title.trim()
}

/** Validate a response from the independently versioned Host half. */
export function scratchWorkspace(value: unknown): ScratchWorkspace {
  if (typeof value !== 'object' || value === null || !('workspaceId' in value)
    || !('path' in value) || !('title' in value)
    || typeof value.workspaceId !== 'string' || value.workspaceId.length === 0
    || typeof value.path !== 'string' || value.path.length === 0
    || typeof value.title !== 'string' || value.title.length === 0) {
    throw new TypeError('session-bridge returned an invalid workspace')
  }
  return { workspaceId: value.workspaceId, path: value.path, title: value.title }
}
