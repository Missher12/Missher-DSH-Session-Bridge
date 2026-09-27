import type { HostContext } from './dsh.ts';
/** Expose only the Host's deletion operation; never infer private storage paths. */
export declare function registerSessionDeleteRoute(ctx: HostContext): void;
