/**
 * The bridge's prompt contribution.
 *
 * Registered per Agent scope, so the text can state the one fact a session
 * cannot otherwise see about itself — its own session id — together with the
 * handles for talking to the sessions around it.
 *
 * @module dsh-session-bridge/prompt
 */
import type { AgentLike } from './dsh.ts';
/** Policy the prompt text discloses. */
export interface PromptPolicy {
    readonly scratchRoot: string;
    readonly announceOwnSessionId: boolean;
    readonly maxMessageChars: number;
}
/**
 * Render the bridge's system-prompt section for one exact Agent.
 * @param agent - the Agent whose scope receives the section.
 * @param policy - resolved bridge policy.
 * @returns the section text, or `''` when nothing should be contributed.
 */
export declare function bridgePromptText(agent: AgentLike, policy: PromptPolicy): string;
