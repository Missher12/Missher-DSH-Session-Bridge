/**
 * Throwaway scratch workspaces.
 *
 * The bridge can put a Session somewhere that is deliberately not the user's
 * default workspace: a fresh directory under `/tmp` (`/tmp/dsh-session-XXXXXX`
 * by default) that exists only for that Session's work. Two shapes are
 * offered, because the two are useful in different moments:
 *
 * - a **scratch directory**, for the Session already running — hand it to
 *   `bash`/file tools and let it build something disposable; and
 * - a **scratch session**, a brand-new Session whose durable `cwd` is that
 *   directory, registered as its own Workspace so it appears in the sidebar
 *   like any other project rather than as an ungrouped orphan.
 *
 * @module dsh-session-bridge/scratch
 */
import type { HostContext } from './dsh.ts';
/** Where and how one scratch directory is created. */
export interface ScratchOptions {
    /** Parent directory the scratch directory is minted inside. */
    readonly root: string;
    /** Name prefix; `mkdtemp` appends six random characters to it. */
    readonly prefix: string;
    /** Whether to register the directory as a durable Workspace. */
    readonly registerWorkspace: boolean;
    /** Optional human label carried into the workspace title. */
    readonly label?: string;
}
/** One created scratch directory. */
export interface ScratchDirectory {
    /** Absolute path, already canonical enough to hand to a shell. */
    readonly path: string;
    /** Durable Workspace id, when one was registered. */
    readonly workspaceId?: string;
    /** Workspace title as the sidebar will render it. */
    readonly workspaceTitle?: string;
}
/** One created scratch Session. */
export interface ScratchSession {
    /** Durable Session id of the new Session. */
    readonly sessionId: string;
    /** The scratch directory the Session owns as its `cwd`. */
    readonly path: string;
    /** Durable Workspace id, when one was registered. */
    readonly workspaceId?: string;
    /** Workspace title as the sidebar will render it. */
    readonly workspaceTitle?: string;
    /** Whether the Session was attached to a Workspace, or left ungrouped. */
    readonly grouped: boolean;
}
/**
 * Mint one fresh scratch directory and record what it is.
 *
 * A `.dsh-scratch.json` marker is written inside so the directory explains
 * itself to a later `ls`, and so an external janitor can find and age out
 * abandoned scratch trees without guessing from the name alone.
 *
 * @param ctx - Host context.
 * @param options - root, prefix, and whether to register a Workspace.
 * @returns the created directory and its Workspace registration, when any.
 */
export declare function createScratchDirectory(ctx: HostContext, options: ScratchOptions): Promise<ScratchDirectory>;
/**
 * Create a new Session whose working directory is a fresh scratch directory.
 *
 * Prefers the Host Session Controller — the exact path the Web UI's own "new
 * session" uses — so the new Session gets the deployment's preset composition
 * and model selection. Falls back to the Agent registry when no controller is
 * mounted, which still yields a working root Session.
 *
 * @param ctx - Host context.
 * @param options - root, prefix, workspace registration, and label.
 * @returns the new Session's identity and location.
 * @throws when no Host capability can create a Session.
 */
export declare function createScratchSession(ctx: HostContext, options: ScratchOptions): Promise<ScratchSession>;
/** The default scratch root: `/tmp` where it exists, the platform temp directory otherwise. */
export declare function defaultScratchRoot(): string;
