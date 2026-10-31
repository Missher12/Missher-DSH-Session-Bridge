import type { HostContext } from './dsh.ts';
/**
 * Expose only the Host's own Session move transaction; never rewrite a header,
 * a JSONL file, or workspace accounting from the plugin. A Host without
 * `sessionController.moveSession` is reported unsupported, so the plugin never
 * fakes a move by re-creating a Session.
 *
 * @param ctx - Host plugin context.
 */
export declare function registerSessionMoveRoute(ctx: HostContext): void;
