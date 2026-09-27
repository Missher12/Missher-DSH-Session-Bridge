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
import { registerBridgeCommands } from "./commands.js";
import { info, systemPromptOf, warn } from "./dsh.js";
import { bridgePromptText } from "./prompt.js";
import { defaultScratchRoot } from "./scratch.js";
import { registerSessionDeleteRoute } from "./session-delete-route.js";
import { registerScratchRoute } from "./scratch-route.js";
import { registerBridgeTools } from "./tools.js";
export const name = 'session-bridge';
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
export const inject = ['tools', 'agents'];
/** Defaults applied when a caller omits a field, or when no schema ran. */
function withDefaults(config) {
    return {
        scratchRoot: config?.scratchRoot ?? defaultScratchRoot(),
        scratchPrefix: config?.scratchPrefix ?? 'dsh-session-',
        registerScratchWorkspace: config?.registerScratchWorkspace ?? true,
        maxListedSessions: config?.maxListedSessions ?? 40,
        maxTranscriptTurns: config?.maxTranscriptTurns ?? 20,
        maxMessageChars: config?.maxMessageChars ?? 8_000,
        wakeColdSessions: config?.wakeColdSessions ?? true,
        announceSessionId: config?.announceSessionId ?? true,
    };
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
export const Config = {
    '~standard': {
        version: 1,
        vendor: 'dsh-session-bridge',
        validate(value) {
            const issues = [];
            const raw = (value ?? {});
            const stringField = (key) => {
                const candidate = raw[key];
                if (candidate === undefined || candidate === null)
                    return undefined;
                if (typeof candidate !== 'string' || candidate.trim().length === 0) {
                    issues.push({ message: `${key} must be a non-empty string`, path: [key] });
                    return undefined;
                }
                return candidate;
            };
            const booleanField = (key) => {
                const candidate = raw[key];
                if (candidate === undefined || candidate === null)
                    return undefined;
                if (typeof candidate !== 'boolean') {
                    issues.push({ message: `${key} must be a boolean`, path: [key] });
                    return undefined;
                }
                return candidate;
            };
            const countField = (key, min, max) => {
                const candidate = raw[key];
                if (candidate === undefined || candidate === null)
                    return undefined;
                if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < min || candidate > max) {
                    issues.push({ message: `${key} must be an integer between ${min} and ${max}`, path: [key] });
                    return undefined;
                }
                return candidate;
            };
            const resolved = withDefaults({
                ...(stringField('scratchRoot') === undefined ? {} : { scratchRoot: stringField('scratchRoot') }),
                ...(stringField('scratchPrefix') === undefined ? {} : { scratchPrefix: stringField('scratchPrefix') }),
                ...(booleanField('registerScratchWorkspace') === undefined ? {} : { registerScratchWorkspace: booleanField('registerScratchWorkspace') }),
                ...(countField('maxListedSessions', 1, 500) === undefined ? {} : { maxListedSessions: countField('maxListedSessions', 1, 500) }),
                ...(countField('maxTranscriptTurns', 1, 500) === undefined ? {} : { maxTranscriptTurns: countField('maxTranscriptTurns', 1, 500) }),
                ...(countField('maxMessageChars', 1, 200_000) === undefined ? {} : { maxMessageChars: countField('maxMessageChars', 1, 200_000) }),
                ...(booleanField('wakeColdSessions') === undefined ? {} : { wakeColdSessions: booleanField('wakeColdSessions') }),
                ...(booleanField('announceSessionId') === undefined ? {} : { announceSessionId: booleanField('announceSessionId') }),
            });
            if (issues.length > 0)
                return { issues };
            return { value: resolved };
        },
    },
};
/** Build the tool policy from a resolved config. */
function toolPolicyOf(config) {
    return {
        scratchRoot: config.scratchRoot,
        scratchPrefix: config.scratchPrefix,
        registerScratchWorkspace: config.registerScratchWorkspace,
        maxListedSessions: config.maxListedSessions,
        maxTranscriptTurns: config.maxTranscriptTurns,
        maxMessageChars: config.maxMessageChars,
        wakeColdSessions: config.wakeColdSessions,
    };
}
/**
 * Mount the bridge: tools, slash commands, and the per-session prompt section.
 *
 * @param ctx - the Cordis context the loader hands this plugin.
 * @param config - validated configuration; defaults are applied when absent.
 */
export function apply(ctx, config = {}) {
    const resolved = withDefaults(config);
    const policy = toolPolicyOf(resolved);
    registerBridgeTools(ctx, policy);
    ctx.inject(['commands'], scope => { registerBridgeCommands(scope, policy); });
    registerScratchRoute(ctx, resolved.scratchRoot);
    registerSessionDeleteRoute(ctx);
    if (!resolved.announceSessionId) {
        info(ctx, `session-bridge: ready · scratch root ${resolved.scratchRoot} · own-session-id prompt section disabled`);
        return;
    }
    const installed = new Map();
    const install = (agent) => {
        if (installed.has(agent) || agent.ctx === undefined)
            return;
        const scoped = systemPromptOf(agent.ctx);
        if (scoped === undefined)
            return;
        try {
            installed.set(agent, scoped.section({
                name: 'session-bridge:policy',
                // Sit just behind the delegation tooling the bridge complements.
                order: scoped.getSectionOrder('TOOL_SUBAGENT') + 10,
                text: bridgePromptText(agent, {
                    scratchRoot: resolved.scratchRoot,
                    announceOwnSessionId: resolved.announceSessionId,
                    maxMessageChars: resolved.maxMessageChars,
                }),
            }));
        }
        catch (error) {
            warn(ctx, `session-bridge: could not install the prompt section for "${agent.id}": ${String(error)}`);
        }
    };
    for (const agent of ctx.agents?.list() ?? [])
        install(agent);
    ctx.on('agent/created', ((payload) => {
        if (payload?.agent !== undefined)
            install(payload.agent);
    }));
    ctx.on('agent/disposed', ((payload) => {
        const agent = payload?.agent;
        if (agent === undefined)
            return;
        installed.get(agent)?.();
        installed.delete(agent);
    }));
    ctx.effect(() => () => {
        for (const dispose of installed.values())
            dispose();
        installed.clear();
    }, 'session-bridge: prompt sections');
    info(ctx, `session-bridge: ready · scratch root ${resolved.scratchRoot} · tools session_list, session_read, session_send, session_scratch`);
}
export { defaultScratchRoot } from "./scratch.js";
export { BRIDGE_SOURCE_KIND, frameBridgedText, isBridgeSource } from "./message.js";
