/**
 * Human-facing slash commands.
 *
 * These are the same three verbs the model gets as tools, exposed at the
 * composer so a person can drive cross-session work without a model in the
 * loop: see the other sessions, mint a scratch session, and push a message
 * into a session by id.
 *
 * @module dsh-session-bridge/commands
 */
import type { HostContext } from './dsh.ts';
import type { ToolPolicy } from './tools.ts';
/**
 * Register the bridge slash commands.
 * @param ctx - Host context.
 * @param policy - resolved bridge policy.
 */
export declare function registerBridgeCommands(ctx: HostContext, policy: ToolPolicy): void;
