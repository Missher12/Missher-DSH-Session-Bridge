/**
 * Session Bridge — a DeepSeek Harness session plugin.
 *
 * Two capabilities, one plugin:
 *
 * 1. **Scratch sessions.** A session does not have to work in the user's
 *    default workspace. `session_scratch` mints a throwaway directory under a
 *    configured root (`/tmp/dsh-session-XXXXXX` by default) and either starts
 *    a new session rooted there — registered as its own Workspace, so it
 *    appears in the sidebar like any project — or hands the path to the
 *    session already running.
 *
 * 2. **Cross-session messaging by session id.** `session_list` /
 *    `session_read` / `session_send` let one session find, read, and talk to
 *    another by the id a human copied out of the UI. A sent message becomes a
 *    real user-role turn in the receiving session, attributed to the sender,
 *    so the two can hold a conversation. A cold receiver is woken through the
 *    Host's own Session-resume path.
 *
 * The plugin imports no `@deepseek-ai/dsh-*` package at runtime: every
 * capability is reached through the Cordis `ctx` it is handed and typed
 * structurally in `dsh.ts`. That keeps it installable into any profile with no
 * dependency resolution of its own and no second copy of a Host package.
 *
 * @module dsh-session-bridge
 */
import type { HostContext } from './dsh.ts';
export declare const name = "session-bridge";
/**
 * Hard dependencies only.
 *
 * `tools` and `agents` are core rows every profile mounts, and the bridge is
 * meaningless without them. Everything else —
 * `commands`, `sessionQuery`, `sessionController`, `workspaceRegistry`,
 * `systemPrompt` — is looked up optionally at use time, so a profile that
 * lacks one degrades to the capabilities it does have instead of failing to
 * load the plugin at all.
 */
export declare const inject: string[];
/** User-tunable bridge policy. */
export interface Config {
    /** Parent directory scratch workspaces are minted under. @default '/tmp' on POSIX, the platform temp directory on Windows */
    scratchRoot?: string;
    /** Name prefix `mkdtemp` extends with six random characters. @default 'dsh-session-' */
    scratchPrefix?: string;
    /** Register each scratch directory as a durable Workspace so it appears in the sidebar. @default true */
    registerScratchWorkspace?: boolean;
    /** Maximum sessions `session_list` returns in one call. @default 40 */
    maxListedSessions?: number;
    /** Maximum conversation turns `session_read` retains, newest kept. @default 20 */
    maxTranscriptTurns?: number;
    /** Maximum characters `session_send` and `/bridge` accept in one body. @default 8000 */
    maxMessageChars?: number;
    /** Resume a cold receiving session so it can take the message. @default true */
    wakeColdSessions?: boolean;
    /** Tell each session its own id and the cross-session tools in the system prompt. @default true */
    announceSessionId?: boolean;
}
/** Fully resolved, defaulted bridge policy. */
type ResolvedConfig = Required<Config>;
/** One Standard Schema issue. */
interface SchemaIssue {
    readonly message: string;
    readonly path?: readonly (string | number)[];
}
/**
 * The plugin's configuration schema, written directly against the
 * [Standard Schema](https://standardschema.dev) v1 interface.
 *
 * Cordis validates a plugin's exported `Config` through that interface, which
 * is why a plain object is rejected while a real schema is accepted. Declaring
 * it by hand — instead of depending on Schemastery — is what lets this plugin
 * ship with zero runtime dependencies. Validation deliberately only
 * type-checks and bounds: every field has a safe default, so a partially
 * specified row still loads.
 */
export declare const Config: {
    '~standard': {
        version: 1;
        vendor: string;
        validate(value: unknown): {
            readonly value: ResolvedConfig;
        } | {
            readonly issues: readonly SchemaIssue[];
        };
    };
};
/**
 * Mount the bridge: tools, slash commands, and the per-session prompt section.
 *
 * @param ctx - the Cordis context the loader hands this plugin.
 * @param config - validated configuration; defaults are applied when absent.
 */
export declare function apply(ctx: HostContext, config?: Config): void;
export { defaultScratchRoot } from './scratch.ts';
export { BRIDGE_SOURCE_KIND, frameBridgedText, isBridgeSource } from './message.ts';
export type { DeliveryMode, DeliveryResult } from './delivery.ts';
export type { ScratchDirectory, ScratchSession } from './scratch.ts';
export type { SessionRow, Transcript, TranscriptTurn } from './catalog.ts';
