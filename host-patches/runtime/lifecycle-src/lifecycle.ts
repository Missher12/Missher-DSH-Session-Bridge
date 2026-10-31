/**
 * Session lifecycle commands shared by the Host and the Bridge plugin:
 * permanent deletion and moving a stored Session to another Workspace.
 *
 * Both operations are Host-owned transactions. The plugin calls
 * `ctx.sessionController` and never touches a log, an index row, or workspace
 * accounting itself. A running or already-open Session is refused: the writer
 * lease is the Host's own exclusion and no supported path can relocate or
 * remove a log while an Agent is executing against it.
 *
 * @module @deepseek-ai/dsh-api-session-controller/lifecycle
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApiSessionAgentController } from './agent.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import {
  SessionAlreadyOwnedError,
  SessionPersistenceChildExistsError,
  SessionPersistenceDeleteUnsupportedError,
  SessionPersistenceNotFoundError,
} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'

/** Stable refusal/failure codes the plugin route maps to HTTP statuses. */
export type SessionLifecycleErrorCode =
  | 'session/delete-active'
  | 'session/delete-has-children'
  | 'session/delete-not-archived'
  | 'session/delete-not-found'
  | 'session/delete-owned'
  | 'session/delete-unsupported'
  | 'session/move-active'
  | 'session/move-busy'
  | 'session/move-not-found'
  | 'session/move-same-workspace'
  | 'session/move-target-missing'
  | 'session/move-unsupported'

/** One typed lifecycle refusal carrying a stable wire code. */
export class SessionLifecycleError extends Error {
  /**
   * @param code - stable code the client route reports.
   * @param message - human-readable detail.
   */
  constructor(readonly code: SessionLifecycleErrorCode, message: string) {
    super(message)
    this.name = 'SessionLifecycleError'
  }
}

/** Brand a raw workspace id without importing the registry at runtime. */
function workspaceId(value: string): WorkspaceId {
  return value as WorkspaceId
}

/**
 * Host-owned Session deletion and move transactions.
 *
 * Installed once by {@link SessionController}; its methods are the optional
 * `deleteSession`/`deleteArchivedSession`/`moveSession` surface the Session
 * Bridge looks for with capability detection.
 */
export class SessionLifecycleController {
  /**
   * @param ctx - Host context that mounts the persistence, workspace, query and directory services.
   * @param agents - the controller that owns the creation handles of idle Agents.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
  ) {}

  /**
   * Permanently delete one stored Session.
   *
   * Guards run before anything is written: an archived-only request must name
   * an archived Session; a live Agent or attached Session is refused (its
   * writer lease cannot be dropped safely); a running turn/job/subagent/
   * schedule is refused through the Workspace registry's activity waterfall;
   * and a Session with derived child Sessions is refused so its lineage is not
   * orphaned. The persistence backend then performs the removal under its own
   * single-writer claim, and the Workspace registry forgets the identity.
   * @param sessionId - the stored Session to delete.
   * @param options - whether an archived Session is required.
   * @throws {SessionLifecycleError} for a stable refusal code.
   */
  async deleteSession(sessionId: SessionId, options: { readonly archivedOnly?: boolean } = {}): Promise<void> {
    if (options.archivedOnly === true && !this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) {
      throw new SessionLifecycleError('session/delete-not-archived',
        `session '${sessionId}' is not archived; archive it before deleting`)
    }
    // A loaded but idle Agent holds the writer lease. The controller owns its
    // disposal capability, so release exactly that Agent; a running Agent or an
    // Agent owned by another component is refused.
    const released = await this.agents.releaseIdle(sessionId)
    if (released === 'running') {
      throw new SessionLifecycleError('session/delete-active',
        `session '${sessionId}' is running; stop it before deleting`)
    }
    if (released === 'unmanaged' || this.ctx.sessions.get(sessionId) !== undefined) {
      throw new SessionLifecycleError('session/delete-owned',
        `session '${sessionId}' is owned by another component; retry after it is released`)
    }
    const activity = await this.ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
    if (activity.length > 0) {
      throw new SessionLifecycleError('session/delete-active',
        `session '${sessionId}' still has active work (${activity.map(entry => entry.kind).join(', ')})`)
    }
    const observations = await this.ctx.sessionQuery.listSessions()
    if (observations.some(observation => observation.header.parentSession === sessionId)) {
      throw new SessionLifecycleError('session/delete-has-children',
        `session '${sessionId}' has derived Sessions; delete those first`)
    }
    try {
      await this.ctx.sessionPersistence.delete(sessionId)
    } catch (error) {
      if (error instanceof SessionPersistenceNotFoundError) {
        // The idle Agent was legally released above and its blank Session
        // never materialized a durable artifact (or another owner already
        // committed the deletion). There is no log left to remove; release
        // the workspace accounting below as the last observable state.
      } else if (error instanceof SessionAlreadyOwnedError) {
        throw new SessionLifecycleError('session/delete-owned',
          `session '${sessionId}' is owned by another writer`)
      } else if (error instanceof SessionPersistenceChildExistsError
        || (error as { name?: unknown })?.name === 'SessionPersistenceChildExistsError') {
        throw new SessionLifecycleError('session/delete-has-children',
          `session '${sessionId}' has derived Sessions; delete those first`)
      } else if (error instanceof SessionPersistenceDeleteUnsupportedError
        || (error as { name?: unknown })?.name === 'SessionPersistenceDeleteUnsupportedError') {
        throw new SessionLifecycleError('session/delete-unsupported',
          'the mounted persistence backend has no deletion transaction')
      } else {
        throw error
      }
    }
    try {
      await this.ctx.workspaceRegistry.detachSession(sessionId)
    } catch (error) {
      // The authoritative log is gone; a failed accounting write must not turn
      // a completed deletion into a reported failure. The registry filters
      // unknown Sessions on its next header rebuild.
      this.ctx.logger.warn(`session-controller: deleted '${sessionId}' but could not detach its workspace accounting: ${String(error)}`)
    }
  }

  /**
   * Permanently delete one *archived* Session (the legacy Host contract).
   * @param sessionId - the archived Session to delete.
   * @throws {SessionLifecycleError} `session/delete-not-archived` or a deletion refusal.
   */
  deleteArchivedSession(sessionId: SessionId): Promise<void> {
    return this.deleteSession(sessionId, { archivedOnly: true })
  }

  /**
   * Move one stored Session to another registered Workspace.
   *
   * The durable header keeps the original project: DSH's effective directory
   * is a Session projection, so the registry's move journal first commits its
   * intent, then appends the `working-directory/change` event and moves the
   * Workspace accounting together under one recoverable marker. The Session
   * id, event history, title, archive state and pin state are untouched. A
   * running or open Session is refused.
   * @param sessionId - the stored Session to move.
   * @param targetWorkspaceId - registered Workspace identity to move to.
   * @throws {SessionLifecycleError} for a stable refusal code.
   */
  async moveSession(sessionId: SessionId, targetWorkspaceId: string): Promise<void> {
    const target = this.ctx.workspaceRegistry.get(workspaceId(targetWorkspaceId))
    if (target === undefined) {
      throw new SessionLifecycleError('session/move-target-missing', 'the target workspace no longer exists')
    }
    const released = await this.agents.releaseIdle(sessionId)
    if (released === 'running') {
      throw new SessionLifecycleError('session/move-active',
        `session '${sessionId}' is running; stop it before moving`)
    }
    if (released === 'unmanaged' || this.ctx.sessions.get(sessionId) !== undefined) {
      throw new SessionLifecycleError('session/move-busy',
        `session '${sessionId}' is owned by another component; retry after it is released`)
    }
    const activity = await this.ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
    if (activity.length > 0) {
      throw new SessionLifecycleError('session/move-active',
        `session '${sessionId}' still has active work (${activity.map(entry => entry.kind).join(', ')})`)
    }
    if (await this.ctx.sessionPersistence.stat(sessionId) === undefined) {
      throw new SessionLifecycleError('session/move-not-found', `session '${sessionId}' was not found`)
    }
    // The registry stages and finishes one move inside a single queued
    // operation: the marker, the effective-directory event, and the
    // membership/override commit cannot interleave with another workspace
    // mutation, and a pending marker is completed by the queue before a new
    // operation starts (never overwritten).
    await this.ctx.workspaceRegistry.moveSession(sessionId, target.id)
  }
}
