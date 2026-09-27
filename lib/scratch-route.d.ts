import type { HostContext, WorkspaceRegistryLike } from './dsh.ts';
import type { ScratchWorkspace } from './scratch-wire.ts';
/** The Host-side Connection API; authentication remains Host-owned. */
export interface ScratchConnection {
    readonly fetch: {
        register(route: {
            readonly path: string;
            readonly methods: readonly ('GET' | 'POST')[];
            readonly requestBody: 'buffered';
            readonly fetch: (request: Request) => Promise<Response>;
        }): () => Promise<void>;
    };
}
/** Read the configured scratch identity without creating or renaming anything. */
export declare function findScratchWorkspace(registry: WorkspaceRegistryLike, root: string, signal: AbortSignal): Promise<ScratchWorkspace | null>;
/**
 * Ensure one canonical directory and workspace. Existing titles are retained.
 * Cancellation can leave a directory or committed registration for the next retry.
 */
export declare function ensureScratchWorkspace(registry: WorkspaceRegistryLike, root: string, title: string, signal: AbortSignal): Promise<ScratchWorkspace>;
/** Install only while the Host's Connection and workspace registry are available. */
export declare function registerScratchRoute(ctx: HostContext, root: string): void;
