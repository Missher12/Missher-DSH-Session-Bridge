/** Plugin-owned JSON endpoint behind DSH's authenticated /api carrier. */
export declare const SCRATCH_PATH = "/api/session-bridge/ensure-workspace";
/** The canonical workspace committed by the Host before navigation. */
export interface ScratchWorkspace {
    readonly workspaceId: string;
    readonly path: string;
    readonly title: string;
}
/** The plugin's result envelope; client stores retain their own return types. */
export type ScratchResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details: object;
    };
};
/** Validate the plugin-owned wire payload; no filesystem path is accepted. */
export declare function scratchTitle(payload: unknown): string;
/** Validate a response from the independently versioned Host half. */
export declare function scratchWorkspace(value: unknown): ScratchWorkspace;
