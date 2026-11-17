import type { HostContext } from './dsh.ts';
import type { SessionDeletion } from './session-deletion.ts';
/**
 * Prefer the Host transaction, then the reviewed in-package JSONL companion.
 * Unknown compositions remain unsupported; requests never accept file paths.
 *
 * @param ctx - Host plugin context.
 */
export declare function registerSessionDeleteRoute(ctx: HostContext, fallback?: () => SessionDeletion | undefined): void;
