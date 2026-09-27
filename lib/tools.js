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
import { listSessionRows, readTranscript, resolveSessionRef } from "./catalog.js";
import { deliverToSession } from "./delivery.js";
import { createScratchDirectory, createScratchSession } from "./scratch.js";
/** Build a registry-ready definition that renders its canonical value as compact JSON. */
function tool(definition) {
    return {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        output: {
            schema: definition.output,
            render: (_args, value) => [{ type: 'text', text: renderValue(value) }],
        },
        execute: (args, exec) => definition.execute(asRecord(args), exec),
    };
}
/** Render one canonical value for the model: pretty JSON, bounded. */
function renderValue(value) {
    const text = JSON.stringify(value, null, 2);
    return text.length > 60_000 ? `${text.slice(0, 60_000)}\n… (truncated)` : text;
}
/** Narrow decoded tool arguments to a record. */
function asRecord(args) {
    return args !== null && typeof args === 'object' ? args : {};
}
/** Require one non-empty string argument. */
function requireString(args, key) {
    const value = args[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`invalid arguments: "${key}" must be a non-empty string`);
    }
    return value;
}
/** Read one optional positive integer argument, clamped to a bound. */
function optionalCount(args, key, fallback, max) {
    const value = args[key];
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        throw new Error(`invalid arguments: "${key}" must be a positive number`);
    }
    return Math.min(Math.floor(value), max);
}
/** Read one optional boolean argument. */
function optionalBoolean(args, key, fallback) {
    const value = args[key];
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'boolean')
        throw new Error(`invalid arguments: "${key}" must be a boolean`);
    return value;
}
/** Read one optional string argument. */
function optionalString(args, key) {
    const value = args[key];
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string')
        throw new Error(`invalid arguments: "${key}" must be a string`);
    return value;
}
/** Read one optional enum argument. */
function optionalEnum(args, key, allowed, fallback) {
    const value = args[key];
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new Error(`invalid arguments: "${key}" must be one of ${allowed.join(', ')}`);
    }
    return value;
}
/** Recover the exact calling Agent, which every bridge tool requires. */
function callerOf(exec, toolName) {
    if (exec.agent === undefined) {
        throw new Error(`${toolName} requires a calling session; it is only available to a live Agent`);
    }
    return exec.agent;
}
const LIST_PARAMETERS = {
    type: 'object',
    properties: {
        include_subagents: { type: 'boolean', description: 'Include delegated subagent sessions. Defaults to false.' },
        limit: { type: 'number', description: 'Maximum sessions returned, 1-200. Defaults to 40.' },
    },
};
const LIST_OUTPUT = {
    type: 'object',
    properties: {
        self: { type: 'string', description: 'This session\'s own id.' },
        cwd: { type: 'string', description: 'This session\'s working directory, when the Host records one.' },
        sessions: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    session_id: { type: 'string' },
                    title: { type: 'string' },
                    cwd: { type: 'string' },
                    live: { type: 'boolean', description: 'A live Agent currently holds this session.' },
                    running: { type: 'boolean', description: 'That Agent is inside a turn right now.' },
                    updated_at: { type: 'number', description: 'Last activity, epoch milliseconds.' },
                    origin: { type: 'string' },
                    parent_session_id: { type: 'string' },
                    self: { type: 'boolean' },
                },
            },
        },
        truncated: { type: 'boolean' },
    },
};
const READ_PARAMETERS = {
    type: 'object',
    properties: {
        session_id: {
            type: 'string',
            description: 'The session to read: its exact id, its exact title, or a unique id prefix, as reported by session_list.',
        },
        max_turns: { type: 'number', description: 'Maximum retained conversation turns, newest kept. Defaults to 20, capped at 200.' },
    },
    required: ['session_id'],
};
const READ_OUTPUT = {
    type: 'object',
    properties: {
        session_id: { type: 'string', description: 'The session id the reference resolved to.' },
        reference: { type: 'string', description: 'The exact reference supplied.' },
        title: { type: 'string' },
        cwd: { type: 'string' },
        live: { type: 'boolean' },
        running: { type: 'boolean' },
        total_turns: { type: 'number' },
        truncated: { type: 'boolean' },
        turns: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    role: { type: 'string', enum: ['user', 'assistant', 'context'] },
                    text: { type: 'string' },
                    source: { type: 'string', description: 'For user turns: the logged message source kind.' },
                },
            },
        },
    },
};
const SEND_PARAMETERS = {
    type: 'object',
    properties: {
        session_id: {
            type: 'string',
            description: 'The receiving session: its exact id, its exact title, or a unique id prefix, as reported by session_list.',
        },
        message: { type: 'string', description: 'Exact text to deliver to that session.' },
        mode: {
            type: 'string',
            enum: ['steer', 'turn'],
            description: 'steer (default) delivers promptly at the receiver\'s nearest step boundary and starts a turn when the receiver is idle; turn always queues a distinct next turn.',
        },
    },
    required: ['session_id', 'message'],
};
const SEND_OUTPUT = {
    type: 'object',
    properties: {
        session_id: { type: 'string', description: 'The session id the reference resolved to.' },
        reference: { type: 'string', description: 'The exact reference supplied.' },
        delivered: { type: 'boolean' },
        mode: { type: 'string', enum: ['steer', 'turn'] },
        woke: { type: 'boolean', description: 'The receiver was cold and had to be resumed first.' },
        running: { type: 'boolean' },
        reason: { type: 'string', description: 'Why delivery did not happen, when delivered is false.' },
    },
};
const SCRATCH_PARAMETERS = {
    type: 'object',
    properties: {
        mode: {
            type: 'string',
            enum: ['session', 'directory'],
            description: 'session (default) creates a new session rooted in the scratch directory; directory only mints the directory for this session to work in.',
        },
        label: { type: 'string', description: 'Optional short label carried into the workspace title.' },
    },
};
const SCRATCH_OUTPUT = {
    type: 'object',
    properties: {
        mode: { type: 'string', enum: ['session', 'directory'] },
        path: { type: 'string', description: 'Absolute scratch directory path.' },
        session_id: { type: 'string' },
        workspace_id: { type: 'string' },
        workspace_title: { type: 'string' },
        grouped: { type: 'boolean', description: 'The new session is registered under its own workspace.' },
    },
};
/**
 * Register the bridge tool set on the Host tool registry.
 * @param ctx - Host context.
 * @param policy - resolved bridge policy.
 */
export function registerBridgeTools(ctx, policy) {
    ctx.tools?.register(tool({
        name: 'session_list',
        description: 'List the DeepSeek Harness sessions on this Host — their session ids, titles, working directories, '
            + 'and whether each is live and inside a turn. Use it to find the session a human referred to by id, '
            + 'or to see what other work is running. This session\'s own id is reported as "self".',
        parameters: LIST_PARAMETERS,
        output: LIST_OUTPUT,
        async execute(args, exec) {
            const caller = callerOf(exec, 'session_list');
            const includeSubagents = optionalBoolean(args, 'include_subagents', false);
            const limit = optionalCount(args, 'limit', policy.maxListedSessions, 200);
            const rows = await listSessionRows(ctx, caller.id, limit);
            const filtered = includeSubagents ? rows : rows.filter(row => row.origin !== 'subagent');
            const sessions = filtered.map(row => ({
                session_id: row.sessionId,
                ...(row.title === undefined ? {} : { title: row.title }),
                ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
                live: row.live,
                running: row.running,
                ...(row.updatedAt === undefined ? {} : { updated_at: row.updatedAt }),
                ...(row.origin === undefined ? {} : { origin: row.origin }),
                ...(row.parentSessionId === undefined ? {} : { parent_session_id: row.parentSessionId }),
                self: row.self,
            }));
            return {
                self: caller.id,
                ...(caller.session?.header?.cwd === undefined ? {} : { cwd: caller.session.header.cwd }),
                sessions,
                truncated: filtered.length < rows.length || rows.length >= limit,
            };
        },
    }));
    ctx.tools?.register(tool({
        name: 'session_read',
        description: 'Read the recent conversation of another DeepSeek Harness session by its session id. Returns user and '
            + 'assistant turns only — tool results and reasoning are excluded. This is a read-only peek: the other '
            + 'session is not resumed, interrupted, or notified.',
        parameters: READ_PARAMETERS,
        output: READ_OUTPUT,
        async execute(args, exec) {
            const caller = callerOf(exec, 'session_read');
            const reference = requireString(args, 'session_id');
            const maxTurns = optionalCount(args, 'max_turns', policy.maxTranscriptTurns, 200);
            const resolved = await resolveSessionRef(ctx, caller.id, reference);
            if (!resolved.ok)
                throw new Error(resolved.reason);
            const transcript = await readTranscript(ctx, resolved.sessionId, maxTurns);
            return {
                session_id: transcript.sessionId,
                reference,
                ...(transcript.title === undefined ? {} : { title: transcript.title }),
                ...(transcript.cwd === undefined ? {} : { cwd: transcript.cwd }),
                live: transcript.live,
                running: transcript.running,
                total_turns: transcript.totalTurns,
                truncated: transcript.truncated,
                turns: transcript.turns.map(turn => ({
                    role: turn.role,
                    text: turn.text,
                    ...(turn.source === undefined ? {} : { source: turn.source }),
                })),
            };
        },
    }));
    ctx.tools?.register(tool({
        name: 'session_send',
        description: 'Send a message to another DeepSeek Harness session by its session id. The message lands in that '
            + 'session\'s conversation as a real user-role message attributed to this session, so it can answer '
            + 'and answer back. A cold session is resumed to receive it. Use mode "turn" to queue a distinct next '
            + 'turn instead of interleaving at the receiver\'s next step.',
        parameters: SEND_PARAMETERS,
        output: SEND_OUTPUT,
        async execute(args, exec) {
            const caller = callerOf(exec, 'session_send');
            const sessionId = requireString(args, 'session_id');
            const message = requireString(args, 'message');
            if (message.length > policy.maxMessageChars) {
                throw new Error(`invalid arguments: "message" exceeds ${policy.maxMessageChars} characters`);
            }
            const mode = optionalEnum(args, 'mode', ['steer', 'turn'], 'steer');
            const result = await deliverToSession(ctx, caller, sessionId, message, mode, {
                wakeColdSessions: policy.wakeColdSessions,
            });
            return {
                session_id: result.sessionId,
                reference: result.reference,
                delivered: result.delivered,
                mode: result.mode,
                woke: result.woke,
                running: result.running,
                ...(result.reason === undefined ? {} : { reason: result.reason }),
            };
        },
    }));
    ctx.tools?.register(tool({
        name: 'session_scratch',
        description: 'Work somewhere other than the default workspace. Creates a fresh throwaway directory under the '
            + `configured scratch root (${policy.scratchRoot}) and either mints a new session whose working `
            + 'directory it becomes, or hands the directory back for this session to use. Use it for experiments, '
            + 'generated artifacts, and anything that should not land in the user\'s project.',
        parameters: SCRATCH_PARAMETERS,
        output: SCRATCH_OUTPUT,
        async execute(args) {
            const mode = optionalEnum(args, 'mode', ['session', 'directory'], 'session');
            const options = {
                root: policy.scratchRoot,
                prefix: policy.scratchPrefix,
                registerWorkspace: policy.registerScratchWorkspace,
                ...(optionalString(args, 'label') === undefined ? {} : { label: optionalString(args, 'label') }),
            };
            if (mode === 'directory') {
                const directory = await createScratchDirectory(ctx, options);
                return {
                    mode,
                    path: directory.path,
                    ...(directory.workspaceId === undefined ? {} : { workspace_id: directory.workspaceId }),
                    ...(directory.workspaceTitle === undefined ? {} : { workspace_title: directory.workspaceTitle }),
                };
            }
            const created = await createScratchSession(ctx, options);
            return {
                mode,
                path: created.path,
                session_id: created.sessionId,
                ...(created.workspaceId === undefined ? {} : { workspace_id: created.workspaceId }),
                ...(created.workspaceTitle === undefined ? {} : { workspace_title: created.workspaceTitle }),
                grouped: created.grouped,
            };
        },
    }));
}
