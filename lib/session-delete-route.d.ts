import type { HostContext } from './dsh.ts';
import { type SessionDeletion } from './session-deletion.ts';
/**
 * Prefer the reviewed companion. Never fall back to the unsafe 0.1.0 decorator.
 * Unknown compositions remain unsupported; requests never accept file paths.
 *
 * @param ctx - Host plugin context.
 */
export declare function registerSessionDeleteRoute(ctx: HostContext, fallback?: () => SessionDeletion | undefined): void;
