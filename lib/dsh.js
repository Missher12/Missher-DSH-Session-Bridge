/**
 * Structural signatures of the DeepSeek Harness Host services this plugin
 * consumes.
 *
 * The plugin deliberately imports no `@deepseek-ai/dsh-*` package at runtime:
 * every DSH capability is reached through the Cordis `ctx` it was handed, and
 * the shapes below describe exactly the slice of each service the bridge
 * touches. That keeps the plugin installable into any profile with zero
 * dependency resolution of its own — no second copy of `dsh-session`, no
 * duplicated Cordis instance, nothing to keep in version lockstep with the
 * host it is loaded by.
 *
 * @module dsh-session-bridge/dsh
 */
/**
 * Read an optional service through Cordis's non-reactive lookup.
 * Missing services return undefined; lookup failures remain visible.
 * @param ctx - Host or Agent-scoped Cordis context.
 * @param name - exact service key.
 * @returns the mounted service, if present.
 */
export function service(ctx, name) {
    return ctx.get(name);
}
/** The mounted attached-Session store. */
export function sessionsOf(ctx) {
    return service(ctx, 'sessions');
}
/** The mounted Session query engine, when this composition has one. */
export function sessionQueryOf(ctx) {
    return service(ctx, 'sessionQuery');
}
/** The mounted Session Controller — the Host's own Session creation path. */
export function sessionControllerOf(ctx) {
    return service(ctx, 'sessionController');
}
/** The mounted durable Workspace registry. */
export function workspaceRegistryOf(ctx) {
    return service(ctx, 'workspaceRegistry');
}
/** The mounted human-command registry. */
export function commandsOf(ctx) {
    return service(ctx, 'commands');
}
/** The mounted system-prompt registry for this exact scope. */
export function systemPromptOf(ctx) {
    return service(ctx, 'systemPrompt');
}
/** Log one warning without assuming the logger survived composition. */
export function warn(ctx, message) {
    try {
        ctx.logger?.warn(message);
    }
    catch {
        // A logger is diagnostics only; never let it break a registration.
    }
}
/** Log one informational line without assuming the logger survived composition. */
export function info(ctx, message) {
    try {
        ctx.logger?.info(message);
    }
    catch {
        // Diagnostics only.
    }
}
