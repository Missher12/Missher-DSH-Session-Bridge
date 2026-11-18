import type { HostContext } from './dsh.ts';
interface SessionMovement {
    canMove: boolean;
    moveSession(id: string, targetId: string): Promise<void>;
}
/** Use the Host transaction or the reviewed in-package workspace adapter. */
export declare function registerSessionMoveRoute(ctx: HostContext, fallback?: () => SessionMovement | undefined): void;
export {};
