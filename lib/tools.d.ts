/**
 * The four model-facing tools the bridge registers.
 *
 * Definitions are written as plain `ToolDefinition` records rather than built
 * through `defineTool`, so the plugin carries no dependency on
 * `@deepseek-ai/dsh-tools`; each `execute` validates its own arguments with
 * the small helpers below and the declared `parameters` schema stays the
 * model's contract.
 *
 * @module dsh-session-bridge/tools
 */
import type { HostContext } from './dsh.ts';
/** Resolved bridge policy the tools read. */
export interface ToolPolicy {
    readonly scratchRoot: string;
    readonly scratchPrefix: string;
    readonly registerScratchWorkspace: boolean;
    readonly maxListedSessions: number;
    readonly maxTranscriptTurns: number;
    readonly maxMessageChars: number;
    readonly wakeColdSessions: boolean;
}
/**
 * Register the bridge tool set on the Host tool registry.
 * @param ctx - Host context.
 * @param policy - resolved bridge policy.
 */
export declare function registerBridgeTools(ctx: HostContext, policy: ToolPolicy): void;
