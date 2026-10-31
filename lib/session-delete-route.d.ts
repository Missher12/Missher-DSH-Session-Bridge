import type { HostContext } from './dsh.ts';
/**
 * Expose only the Host's own deletion transaction; never infer private storage
 * paths. A Host without either method is reported unsupported, so the plugin
 * never deletes a JSONL file, an index row, or a workspace record itself.
 *
 * @param ctx - Host plugin context.
 */
export declare function registerSessionDeleteRoute(ctx: HostContext): void;
