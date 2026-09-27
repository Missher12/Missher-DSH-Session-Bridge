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

/** One durable Session header, reduced to the fields the bridge reasons about. */
export interface SessionHeaderLike {
  readonly id: string
  readonly cwd?: string
  readonly createdAt?: number
  readonly parentSession?: string
  readonly origin?: string
  readonly agentPreset?: string
}

/** One row of the Host Session listing (`ctx.sessionController.list`). */
export interface SessionSummaryLike {
  readonly sessionId: string
  readonly agentAvailable: boolean
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly parentSessionId?: string
  readonly origin?: string
  readonly cwd?: string
  /** Header-only projection hints; `values.title` carries the latest title when cached. */
  readonly projections?: { readonly values?: Readonly<Record<string, unknown>> }
}

/** One live-preferred corpus record (`ctx.sessionQuery.listSessions`). */
export interface SessionRecordLike {
  readonly header: SessionHeaderLike
  readonly live: boolean
  readonly persisted: boolean
}

/** One validated raw Session event. */
export interface SessionEventLike {
  readonly type: string
  readonly seq?: number
  readonly time?: number
  readonly data?: unknown
}

/** The result of `ctx.sessionQuery.readSession`. */
export interface SessionLogSnapshotLike {
  readonly session: SessionHeaderLike
  readonly inheritedEventCount?: number
  readonly events: readonly SessionEventLike[]
}

/** One Session's current model-visible surface (`ctx.sessionQuery.readSurface`). */
export interface SessionSurfaceSnapshotLike {
  readonly session: SessionHeaderLike
  readonly inheritedEventCount?: number
  readonly capturedThroughSeq?: number | null
  readonly events: readonly SessionEventLike[]
}

/** The `ctx.sessionQuery` slice the bridge reads transcripts through. */
export interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<readonly SessionRecordLike[]>
  readSession(sessionId: string): Promise<SessionLogSnapshotLike>
  readSurface(sessionId: string): Promise<SessionSurfaceSnapshotLike>
}

/** The `ctx.sessionController` slice: the Host's own Session creation path. */
export interface SessionControllerLike {
  /** Host-owned permanent deletion, present only in Hosts carrying the upstream patch. */
  deleteArchivedSession?(sessionId: string): Promise<void>
  list(request: unknown, signal?: AbortSignal): Promise<{ readonly items: readonly SessionSummaryLike[] }>
  create(request: {
    readonly sessionId?: string
    readonly cwd?: string
    readonly workspaceId?: string
  }): Promise<{ readonly sessionId: string }>
}

/** One durable Workspace registration. */
export interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string
  /** Sessions accounted to this Workspace, in manual order. */
  readonly sessionIds: readonly string[]
  attachSession(sessionId: string): Promise<void>
}

/** The `ctx.workspaceRegistry` slice: durable project registration. */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<WorkspaceLike>
  get(id: string): WorkspaceLike | undefined
  list(): readonly WorkspaceLike[]
  /** Delete one registration; the directory and its session logs are retained. */
  delete(id: string): Promise<boolean>
  resolveByPath(path: string): Promise<WorkspaceLike | undefined>
}

/** A live Agent's model-facing input surface. */
export interface AgentLike {
  readonly id: string
  readonly ctx?: HostContext
  readonly session?: { readonly header?: SessionHeaderLike }
  /** Start a distinct next turn. */
  followup(message: unknown): void
  /** Interleave at the nearest step boundary; wakes an idle driver. */
  steer(message: unknown): void
  /** Attach context without waking the driver. */
  inject(message: unknown): void
}

/** The `ctx.agents` slice: the process-local live Agent registry. */
export interface AgentsLike {
  get(id: string): AgentLike | undefined
  list(): readonly AgentLike[]
  resume(options: { readonly resumeSessionId: string }): Promise<{ readonly agent: AgentLike }>
  create(options: {
    readonly sessionId: string
    readonly meta?: { readonly cwd?: string }
  }): Promise<{ readonly agent: AgentLike }>
}

/** The `ctx.sessions` slice: attached Session identities. */
export interface SessionsLike {
  get(id: string): { readonly header?: SessionHeaderLike } | undefined
  list(): readonly { readonly header?: SessionHeaderLike }[]
}

/** One registered model-facing tool. */
export interface ToolDefinitionLike {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
  readonly output: {
    readonly schema: unknown
    readonly render: (args: unknown, value: unknown) => ReadonlyArray<{ readonly type: 'text'; readonly text: string }>
  }
  readonly execute: (args: unknown, exec: ToolExecutionLike) => Promise<unknown>
}

/** The execution identity handed to one tool call. */
export interface ToolExecutionLike {
  /** The exact Agent on whose behalf the call runs. */
  readonly agent?: AgentLike
  readonly signal: AbortSignal
}

/** One registered human slash command. */
export interface CommandDefinitionLike {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint?: string }
  readonly handler: (invocation: CommandInvocationLike) => CommandResultLike | Promise<CommandResultLike>
}

/** The invocation handed to one slash command. */
export interface CommandInvocationLike {
  readonly agent?: AgentLike
  readonly rawInput: string
  readonly signal: AbortSignal
}

/** The outcome one slash command reports to the dispatching UI. */
export type CommandResultLike =
  | { readonly kind: 'success'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string }

/** The `ctx.systemPrompt` slice: per-scope prompt contributions. */
export interface SystemPromptLike {
  section(section: { readonly name: string; readonly order: number; readonly text: string }): () => void
  getSectionOrder(name: string): number
}

/** The `ctx.logger` slice. */
export interface LoggerLike {
  info(message: string): void
  warn(message: string): void
}

/**
 * The Cordis Context the loader hands `apply`, narrowed to the members the
 * bridge actually uses. Declaring the surface here (rather than importing
 * Cordis) is what keeps this plugin dependency-free while still type-checked.
 */
export interface HostContext {
  readonly tools?: { register(definition: ToolDefinitionLike): () => void }
  readonly commands?: { register(definition: CommandDefinitionLike): () => void }
  readonly agents?: AgentsLike
  readonly sessions?: SessionsLike
  readonly sessionQuery?: SessionQueryLike
  readonly sessionController?: SessionControllerLike
  readonly workspaceRegistry?: WorkspaceRegistryLike
  readonly systemPrompt?: SystemPromptLike
  readonly logger?: LoggerLike
  /** Cordis service lookup; returns `undefined` for an unmounted capability. */
  get(name: string): unknown
  /** Mount a child scope only while all named services are present. */
  inject(names: string[], callback: (scope: HostContext) => void): unknown
  /** Register a disposer that runs when this plugin unloads. */
  effect(disposer: () => unknown, label?: string): void
  /** Subscribe to a Host event. */
  on(event: string, listener: (...args: never[]) => void): () => void
  /** This context's own plugin instance scope, when the plugin holds one. */
  readonly scope?: unknown
}

/**
 * Read an optional service through Cordis's non-reactive lookup.
 * Missing services return undefined; lookup failures remain visible.
 * @param ctx - Host or Agent-scoped Cordis context.
 * @param name - exact service key.
 * @returns the mounted service, if present.
 */
export function service<T>(ctx: HostContext, name: string): T | undefined {
  return ctx.get(name) as T | undefined
}

/** The mounted attached-Session store. */
export function sessionsOf(ctx: HostContext): SessionsLike | undefined {
  return service<SessionsLike>(ctx, 'sessions')
}

/** The mounted Session query engine, when this composition has one. */
export function sessionQueryOf(ctx: HostContext): SessionQueryLike | undefined {
  return service<SessionQueryLike>(ctx, 'sessionQuery')
}

/** The mounted Session Controller — the Host's own Session creation path. */
export function sessionControllerOf(ctx: HostContext): SessionControllerLike | undefined {
  return service<SessionControllerLike>(ctx, 'sessionController')
}

/** The mounted durable Workspace registry. */
export function workspaceRegistryOf(ctx: HostContext): WorkspaceRegistryLike | undefined {
  return service<WorkspaceRegistryLike>(ctx, 'workspaceRegistry')
}

/** The mounted human-command registry. */
export function commandsOf(ctx: HostContext): NonNullable<HostContext['commands']> | undefined {
  return service<NonNullable<HostContext['commands']>>(ctx, 'commands')
}

/** The mounted system-prompt registry for this exact scope. */
export function systemPromptOf(ctx: HostContext): SystemPromptLike | undefined {
  return service<SystemPromptLike>(ctx, 'systemPrompt')
}

/** Log one warning without assuming the logger survived composition. */
export function warn(ctx: HostContext, message: string): void {
  try {
    ctx.logger?.warn(message)
  } catch {
    // A logger is diagnostics only; never let it break a registration.
  }
}

/** Log one informational line without assuming the logger survived composition. */
export function info(ctx: HostContext, message: string): void {
  try {
    ctx.logger?.info(message)
  } catch {
    // Diagnostics only.
  }
}
