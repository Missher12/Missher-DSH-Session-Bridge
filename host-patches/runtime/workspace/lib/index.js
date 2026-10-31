// ../../../../../../private/tmp/sb-host-src/packages/workspace/workspace/src/index.ts
import { randomUUID } from "node:crypto";
import { mkdir, stat as stat2 } from "node:fs/promises";
import { Service } from "@deepseek-ai/cordis";
import { SessionSeq } from "@deepseek-ai/dsh-session";

// ../../../../../../private/tmp/sb-host-src/packages/workspace/workspace/src/entity.ts
import { stat } from "node:fs/promises";

// ../../../../../../private/tmp/sb-host-src/packages/workspace/workspace/src/paths.ts
import { realpath } from "node:fs/promises";
import { posix, win32 } from "node:path";
function fullyQualifiedWorkspacePath(path, platform = process.platform) {
  if (platform !== "win32") return posix.isAbsolute(path);
  const root = win32.parse(path).root;
  return win32.isAbsolute(path) && root !== "\\" && root !== "/";
}
function defaultWorkspaceTitle(path, platform = process.platform) {
  const pathApi = platform === "win32" ? win32 : posix;
  return pathApi.basename(path) || pathApi.parse(path).root;
}
async function realpathNormalize(path) {
  if (!fullyQualifiedWorkspacePath(path)) {
    throw new TypeError(`Workspace path is not fully qualified: '${path}'`);
  }
  return await realpath(path);
}

// ../../../../../../private/tmp/sb-host-src/packages/workspace/workspace/src/entity.ts
var WorkspaceMoveInvalidError = class extends Error {
  /**
   * @param message - Which id was unaccounted and where.
   */
  constructor(message) {
    super(message);
    this.name = "WorkspaceMoveInvalidError";
  }
};
var unchangedSentinel = new Error("workspace record unchanged (internal sentinel)");
var WorkspaceEntity = class {
  /**
   * @param host - Registry-owned table, session-path index, and header reads.
   * @param id - The record's stable id.
   * @param record - The validated record snapshot loaded or just written.
   */
  constructor(host, id, record) {
    this.host = host;
    this.id = id;
    this.record = record;
  }
  host;
  id;
  record;
  get path() {
    return this.record.path;
  }
  get title() {
    return this.record.title;
  }
  get createdAt() {
    return this.record.createdAt;
  }
  get updatedAt() {
    return this.record.updatedAt;
  }
  get sessionIds() {
    return this.record.sessionIds.filter((id) => this.host.candidateMatches(id, this.record.path));
  }
  async setTitle(title) {
    await this.mutate((record) => ({ ...record, title }));
  }
  async attachSession(sessionId2) {
    if (!this.record.sessionIds.includes(sessionId2)) {
      const header = await this.host.readSessionHeader(sessionId2);
      if (header.cwd === void 0) {
        throw new Error(
          `cannot attach session '${sessionId2}' to workspace '${this.record.path}': its stored header carries no cwd to validate against`
        );
      }
      let cwd;
      try {
        cwd = await realpathNormalize(header.cwd);
      } catch (error) {
        throw new Error(
          `cannot attach session '${sessionId2}' to workspace '${this.record.path}': its cwd '${header.cwd}' does not resolve, so it cannot be validated`,
          { cause: error }
        );
      }
      if (!(await stat(cwd)).isDirectory()) {
        throw new Error(
          `cannot attach session '${sessionId2}' to workspace '${this.record.path}': its cwd '${header.cwd}' is not a directory`
        );
      }
      if (cwd !== this.record.path) {
        throw new Error(
          `cannot attach session '${sessionId2}' to workspace '${this.record.path}': its cwd resolves to '${cwd}'`
        );
      }
      this.host.rememberSessionPath(sessionId2, cwd);
    }
    await this.mutate((record) => record.sessionIds.includes(sessionId2) ? record : { ...record, sessionIds: [sessionId2, ...record.sessionIds] });
  }
  async insertSessionBefore(sessionId2, beforeSessionId) {
    await this.mutate((record) => {
      if (!record.sessionIds.includes(sessionId2)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId2}' in workspace '${record.path}': the session is not accounted`
        );
      }
      if (beforeSessionId !== void 0 && !record.sessionIds.includes(beforeSessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId2}' before '${beforeSessionId}' in workspace '${record.path}': the anchor session is not accounted`
        );
      }
      if (beforeSessionId === sessionId2) return record;
      const without = record.sessionIds.filter((id) => id !== sessionId2);
      const at = beforeSessionId === void 0 ? without.length : without.indexOf(beforeSessionId);
      const sessionIds = [...without.slice(0, at), sessionId2, ...without.slice(at)];
      return sessionIds.every((id, index) => id === record.sessionIds[index]) ? record : { ...record, sessionIds };
    });
  }
  async detachSession(sessionId2) {
    await this.mutate((record) => record.sessionIds.includes(sessionId2) ? { ...record, sessionIds: record.sessionIds.filter((id) => id !== sessionId2) } : record);
  }
  async status() {
    try {
      return (await stat(this.record.path)).isDirectory() ? "ok" : "missing-dir";
    } catch {
      return "missing-dir";
    }
  }
  /**
   * The single write path: run `fn` on the domain write chain via
   * `table.update`, stamping `updatedAt` and pruning candidates that no
   * longer pass the candidate membership check, then swap the
   * snapshot.
   *
   * `fn` sees the value current at its chain slot, so membership decisions
   * (attach/detach idempotence) are race-free against queued writes; a fn
   * signalling no change by returning `current` verbatim aborts the slot
   * through the sentinel when pruning also finds nothing, so a no-op neither
   * rewrites the medium nor emits a change event.
   */
  async mutate(fn) {
    let next;
    try {
      next = await this.host.table().update(this.id, (current) => {
        const changed = fn(current);
        const sessionIds = changed.sessionIds.filter(
          (id) => this.host.candidateMatches(id, changed.path)
        );
        if (changed === current && sessionIds.length === current.sessionIds.length) {
          throw unchangedSentinel;
        }
        return { ...changed, sessionIds, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      });
    } catch (error) {
      if (error === unchangedSentinel) return;
      throw error;
    }
    this.record = next;
  }
};

// ../../../../../../private/tmp/sb-host-src/packages/workspace/workspace/src/spec.ts
import { z } from "zod";
import { brandString } from "@deepseek-ai/dsh-brand";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
var workspaceId = z.string().transform((value) => value);
var sessionId = z.string().transform((value) => brandString(value));
var workspaceRecord = z.object({
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(sessionId),
  createdAt: z.string(),
  updatedAt: z.string()
});
var workspacePendingMutation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), workspaceId }),
  z.object({ operation: z.literal("delete"), workspaceId }),
  z.object({
    operation: z.literal("moveSession"),
    sessionId,
    fromWorkspaceId: workspaceId.optional(),
    toWorkspaceId: workspaceId,
    targetCwd: z.string()
  }),
  z.object({ operation: z.literal("detachSession"), sessionId })
]);
var sessionWorkspaceOverride = z.object({ sessionId, workspaceId });
var workspaceDomainState = z.object({
  initialized: z.boolean(),
  /** First-use Workspace identity, retained after its registration is deleted. */
  defaultWorkspaceId: workspaceId.optional(),
  workspaceIds: z.array(workspaceId),
  archivedSessionIds: z.array(sessionId).default([]),
  pinnedSessionIds: z.array(sessionId).default([]),
  sessionWorkspaceOverrides: z.array(sessionWorkspaceOverride).default([]),
  pendingMutation: workspacePendingMutation.optional()
});
var workspaceDomainSpec = defineDomain({
  name: "workspace",
  version: 2,
  global: {
    schema: workspaceDomainState,
    initial: {
      initialized: false,
      workspaceIds: [],
      archivedSessionIds: [],
      pinnedSessionIds: [],
      sessionWorkspaceOverrides: []
    }
  },
  tables: { workspaces: domainTable(workspaceRecord) }
});

// ../../../../../../private/tmp/sb-host-src/packages/workspace/workspace/src/index.ts
function WorkspaceId(id) {
  return id;
}
var WorkspaceUnknownSessionError = class extends Error {
  /**
   * @param sessionId - The unknown session id.
   * @param verb - The registry operation that named the session.
   */
  constructor(sessionId2, verb) {
    super(`cannot ${verb} session '${sessionId2}': live sessions and session persistence hold no such session`);
    this.sessionId = sessionId2;
    this.name = "WorkspaceUnknownSessionError";
  }
  sessionId;
};
var WorkspaceActiveSessionError = class extends Error {
  /**
   * @param sessionId - The active session id.
   * @param activity - The reported activity, in listener order.
   */
  constructor(sessionId2, activity) {
    super(`cannot archive session '${sessionId2}': the session is active (${activity.map((entry) => entry.kind).join(", ")})`);
    this.sessionId = sessionId2;
    this.activity = activity;
    this.name = "WorkspaceActiveSessionError";
  }
  sessionId;
  activity;
};
var WorkspaceArchivedSessionPinError = class extends Error {
  /**
   * @param sessionId - The archived session id.
   */
  constructor(sessionId2) {
    super(`cannot pin session '${sessionId2}': the session is archived`);
    this.sessionId = sessionId2;
    this.name = "WorkspaceArchivedSessionPinError";
  }
  sessionId;
};
var WorkspaceOrderInvalidError = class extends Error {
  /**
   * @param workspaceId - Missing source or anchor id.
   */
  constructor(workspaceId2) {
    super(`cannot reorder unknown workspace '${workspaceId2}'`);
    this.workspaceId = workspaceId2;
    this.name = "WorkspaceOrderInvalidError";
  }
  workspaceId;
};
var WorkspaceNotFoundError = class extends Error {
  /**
   * @param workspaceId - The missing workspace id.
   */
  constructor(workspaceId2) {
    super(`workspace '${workspaceId2}' does not exist`);
    this.workspaceId = workspaceId2;
    this.name = "WorkspaceNotFoundError";
  }
  workspaceId;
};
var sameIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);
var compareHeaders = (left, right) => right.createdAt - left.createdAt || String(left.id).localeCompare(String(right.id));
var WorkspaceRegistry = class extends Service {
  static inject = ["storageDomain", "sessionPersistence"];
  table;
  global;
  state;
  entities = /* @__PURE__ */ new Map();
  headers = /* @__PURE__ */ new Map();
  sessionPaths = /* @__PURE__ */ new Map();
  missingSessionPaths = /* @__PURE__ */ new Set();
  invalidSessionPaths = /* @__PURE__ */ new Map();
  /**
   * Explicit durable moves: a Session whose effective Workspace is not the one
   * its immutable header cwd names. Mirrors `state.sessionWorkspaceOverrides`
   * so membership filters do not need a state read.
   */
  sessionOverrides = /* @__PURE__ */ new Map();
  operationTail = Promise.resolve();
  host = {
    table: () => this.requireTable(),
    candidateMatches: (id, path) => {
      const override = this.sessionOverrides.get(id);
      if (override !== void 0) return this.requireTable().get(override)?.path === path;
      return this.sessionPaths.get(id) === path || this.missingSessionPaths.has(id);
    },
    readSessionHeader: (id) => this.readSessionHeader(id),
    rememberSessionPath: (id, path) => {
      this.sessionPaths.set(id, path);
      this.missingSessionPaths.delete(id);
      this.invalidSessionPaths.delete(id);
    }
  };
  constructor(ctx) {
    super(ctx, "workspaceRegistry");
  }
  /** Open the domain, finish bootstrap when required, and rebuild the ordered cache. */
  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(workspaceDomainSpec);
    this.ctx.effect(() => () => domain.close(), "workspace.domainClose");
    this.table = domain.table("workspaces");
    this.global = domain.global;
    this.state = domain.global.get();
    this.indexOverrides(this.state);
    await this.recoverPendingMutation();
    this.validateStoredState(this.state);
    if (!this.state.initialized) {
      const headers = await this.listStoredHeaders();
      await this.replaceHeaderIndex(headers);
      await this.bootstrap(headers);
    } else if (this.table.size > 0) {
      await this.replaceHeaderIndex(await this.listStoredHeaders());
    }
    await this.indexLiveSessions();
    this.validateStoredState(this.requireState());
    this.rebuildEntities();
    this.reportFilteredCandidates();
  }
  /**
   * Create or reuse a workspace for an existing directory. The fully qualified
   * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
   * non-directory path rejects. Repeated calls for the same canonical path
   * return the existing entity without changing its title.
   * A newly created workspace is prepended to the durable registry order.
   * Different canonical paths may share a display title.
   * @param path - Existing directory to own, in a fully qualified path spelling.
   * @param title - Display title used only when a new record is created.
   * @returns the existing or newly durable workspace.
   */
  // TODO: `title` lost its last production caller when the gateway's
  // create-by-name branch was deleted
  // (.agents/notes/archived/simplification/2026-07-31-one-route-to-add-a-workspace.md);
  // drop the parameter with its @param clause and the `create(path, title?)`
  // lines in this package's README pair.
  async create(path, title) {
    const canonical = await realpathNormalize(path);
    if (!(await stat2(canonical)).isDirectory()) {
      throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`);
    }
    return await this.enqueueOperation(() => this.createCanonical(canonical, title));
  }
  /**
   * Initialize the default Workspace only while both the registry and Session
   * history are empty. Repeated requests reuse its durable identity; deleting
   * that registration permanently disables automatic creation.
   * @param resolveDirectory - resolve the absolute directory; called only for
   * eligible creation, inside the registry mutation queue. Missing directories
   * are created recursively before registration, and the initial title is the
   * requested directory's own final segment — not the canonical one, so a
   * symlink at that path does not retitle the Workspace after its target.
   * After resolution, caller cancellation does not roll back creation or registration.
   * @returns the initialized Workspace, or undefined when automatic creation is ineligible.
   */
  initializeDefault(resolveDirectory) {
    return this.enqueueOperation(async () => {
      const state = this.requireState();
      if (state.defaultWorkspaceId !== void 0) return this.entities.get(state.defaultWorkspaceId);
      const sessions = this.ctx.get("sessions");
      if (sessions === void 0) throw new Error("default Workspace initialization requires the Session store");
      if (state.workspaceIds.length > 0 || state.archivedSessionIds.length > 0 || sessions.list().length > 0 || (await this.listStoredHeaders()).length > 0) return void 0;
      const path = await resolveDirectory();
      if (!fullyQualifiedWorkspacePath(path)) throw new TypeError(`Workspace path is not fully qualified: '${path}'`);
      await mkdir(path, { recursive: true });
      const canonical = await realpathNormalize(path);
      if ((await this.listStoredHeaders()).length > 0 || sessions.list().length > 0) return void 0;
      return this.createCanonical(canonical, defaultWorkspaceTitle(path), true);
    });
  }
  /**
   * Look up a workspace by id.
   * @param id - Workspace id.
   * @returns the workspace, or `undefined` when unknown.
   */
  get(id) {
    return this.entities.get(id);
  }
  /**
   * Synchronous workspace projection in durable registry order. Every
   * entity's `sessionIds` getter is already filtered by the startup/live
   * canonical-cwd header index; this method performs no persistence reads.
   * @returns a fresh ordered array of workspace entities.
   */
  list() {
    return this.requireState().workspaceIds.map((id) => {
      const entity = this.entities.get(id);
      if (entity === void 0) {
        throw new Error(`workspace registry order references missing workspace '${id}'`);
      }
      return entity;
    });
  }
  /**
   * Delete one workspace registration while retaining its directory and every
   * session log. The durable order is updated before the table deletion; a
   * failed table write restores the prior order and keeps the entity
   * published. Unknown ids are an idempotent no-op for domain callers.
   * @param id - Workspace registration to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id) {
    return this.enqueueOperation(() => this.deleteKnown(id));
  }
  /**
   * Move one workspace within the durable display order, DOM-insertBefore-like.
   * With an anchor it lands before that workspace; without one it appends.
   * @param id - Workspace to move.
   * @param beforeId - Workspace anchor; omitted appends.
   * @returns the complete committed workspace order.
   */
  insertBefore(id, beforeId) {
    return this.enqueueOperation(async () => {
      const state = this.requireState();
      if (!state.workspaceIds.includes(id)) throw new WorkspaceOrderInvalidError(id);
      if (beforeId !== void 0 && !state.workspaceIds.includes(beforeId)) {
        throw new WorkspaceOrderInvalidError(beforeId);
      }
      if (beforeId === id) return state.workspaceIds;
      const without = state.workspaceIds.filter((workspaceId2) => workspaceId2 !== id);
      const at = beforeId === void 0 ? without.length : without.indexOf(beforeId);
      const workspaceIds = [...without.slice(0, at), id, ...without.slice(at)];
      if (sameIds(workspaceIds, state.workspaceIds)) return state.workspaceIds;
      await this.setState({ ...state, workspaceIds });
      return workspaceIds;
    });
  }
  /**
   * The registry-global archive set: sessions hidden from every grouping
   * surface. Archiving never touches workspace accounting — an archived
   * session keeps its `sessionIds` slot so unarchiving restores its position.
   * @returns the archived session ids in archive order.
   */
  get archivedSessionIds() {
    return this.requireState().archivedSessionIds;
  }
  /**
   * Archive one session durably. The session must exist (live or in session
   * persistence); its workspace accounting — or lack of one — is irrelevant.
   * Without `stopActivity` the session must also be inactive: the
   * `workspace/session-activity` waterfall is asked once, and any reported
   * activity rejects with {@link WorkspaceActiveSessionError} before anything
   * is written. With `stopActivity` the archive is written without an
   * activity check, and the `workspace/session-stop` providers are then asked
   * to stop the session's work: the durable archive set is what a provider's
   * `agent/pre-step` gate reads, so every wake the stops induce is already
   * blocked. Archiving drops the session's pin in the same durable write
   * (pinning and archival are mutually exclusive). An already archived id
   * resolves without writing, asking, or stopping.
   * @param sessionId - The session to archive.
   * @param options - Whether running work is stopped instead of refusing.
   * @returns resolution after durability and, with `stopActivity`, after every stop request was issued.
   */
  archiveSession(sessionId2, options = {}) {
    return this.enqueueOperation(async () => {
      if (this.requireState().archivedSessionIds.includes(sessionId2)) return;
      if (!await this.sessionKnown(sessionId2)) {
        throw new WorkspaceUnknownSessionError(sessionId2, "archive");
      }
      if (options.stopActivity !== true) {
        const activity = await this.ctx.waterfall(
          "workspace/session-activity",
          { sessionId: sessionId2 },
          () => Promise.resolve([])
        );
        if (activity.length > 0) throw new WorkspaceActiveSessionError(sessionId2, activity);
      }
      const state = this.requireState();
      await this.setState({
        ...state,
        archivedSessionIds: [...state.archivedSessionIds, sessionId2],
        pinnedSessionIds: state.pinnedSessionIds.filter((id) => id !== sessionId2)
      });
      if (options.stopActivity === true) await this.stopSessionActivity(sessionId2);
    });
  }
  /**
   * Unarchive one session durably by dropping it from the registry-global
   * archive set; the accounting slot was never touched, so the session
   * returns to its recorded position. Unarchiving runs no session-existence
   * check because removing an id cannot introduce an unknown one, so an
   * entry whose session is gone still resolves. An id that is not archived
   * resolves without writing.
   * @param sessionId - The session to unarchive.
   * @returns resolution after durability.
   */
  unarchiveSession(sessionId2) {
    return this.enqueueOperation(async () => {
      const state = this.requireState();
      if (!state.archivedSessionIds.includes(sessionId2)) return;
      await this.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId2)
      });
    });
  }
  /**
   * Move one Session's durable workspace ownership to another registered
   * Workspace without touching its immutable header.
   *
   * The target record receives the membership slot; the previous record (if
   * any) loses it, and a durable override records that this Session's
   * effective Workspace differs from its header cwd. The override survives
   * restarts and is what the membership filter consults, so the moved Session
   * stays grouped under the target even though its log header still names the
   * original project. The Session must exist (live or persisted); archive and
   * pin state are untouched.
   * @param sessionId - The Session to move.
   * @param targetWorkspaceId - Registered Workspace that will own it.
   * @returns resolution after both records and the override are durable.
   */
  beginSessionMove(sessionId2, targetWorkspaceId) {
    return this.enqueueOperation(async () => {
      const state = this.requireState();
      if (state.pendingMutation !== void 0) {
        throw new Error(`workspace domain still has a pending ${state.pendingMutation.operation} mutation; recovery must complete it first`);
      }
      const table = this.requireTable();
      const target = table.get(targetWorkspaceId);
      if (target === void 0) throw new WorkspaceNotFoundError(targetWorkspaceId);
      if (!await this.sessionKnown(sessionId2)) throw new WorkspaceUnknownSessionError(sessionId2, "move");
      let sourceId;
      for (const [id, record] of table.entries()) {
        if (record.sessionIds.includes(sessionId2)) {
          sourceId = id;
          break;
        }
      }
      if (sourceId === targetWorkspaceId) return;
      await this.setState({
        ...state,
        pendingMutation: {
          operation: "moveSession",
          sessionId: sessionId2,
          fromWorkspaceId: sourceId,
          toWorkspaceId: targetWorkspaceId,
          targetCwd: target.path
        }
      });
    });
  }
  /**
   * Complete a move staged by {@link beginSessionMove}: append the effective
   * working-directory event, move the current accounting membership, install
   * the override, and clear the marker. Idempotent; a missing marker resolves
   * without writing.
   * @param sessionId - the Session being moved.
   * @returns resolution after the directory event and membership are durable.
   */
  completeSessionMove(sessionId2) {
    return this.enqueueOperation(async () => {
      const pending = this.requireState().pendingMutation;
      if (pending === void 0) return;
      if (pending.operation !== "moveSession" || pending.sessionId !== sessionId2) {
        throw new Error(
          `workspace domain has a pending ${pending.operation} mutation for another target; session '${sessionId2}' cannot complete over it`
        );
      }
      await this.finishSessionMove(pending);
    });
  }
  /**
   * Stage and finish one Session move inside a single registry queue slot.
   *
   * The queue's pre-step recovery completes any earlier pending marker before
   * this operation starts, so a second move can never overwrite the first.
   * Once this operation stages its marker, only it may finish it: no other
   * workspace mutation can interleave between staging and completion.
   * @param sessionId - the Session to move.
   * @param targetWorkspaceId - registered Workspace that will own it.
   * @returns resolution after the directory event and membership are durable.
   */
  moveSession(sessionId2, targetWorkspaceId) {
    return this.enqueueOperation(async () => {
      const state = this.requireState();
      if (state.pendingMutation !== void 0) {
        throw new Error(`workspace domain still has a pending ${state.pendingMutation.operation} mutation; recovery must complete it first`);
      }
      const table = this.requireTable();
      const target = table.get(targetWorkspaceId);
      if (target === void 0) throw new WorkspaceNotFoundError(targetWorkspaceId);
      if (!await this.sessionKnown(sessionId2)) throw new WorkspaceUnknownSessionError(sessionId2, "move");
      let sourceId;
      for (const [id, record] of table.entries()) {
        if (record.sessionIds.includes(sessionId2)) {
          sourceId = id;
          break;
        }
      }
      if (sourceId === targetWorkspaceId) return;
      const marker = {
        operation: "moveSession",
        sessionId: sessionId2,
        fromWorkspaceId: sourceId,
        toWorkspaceId: targetWorkspaceId,
        targetCwd: target.path
      };
      await this.setState({ ...state, pendingMutation: marker });
      try {
        await this.finishSessionMove(marker);
      } catch (error) {
        try {
          await this.finishSessionMove(marker);
        } catch (recoveryError) {
          throw new AggregateError(
            [error, recoveryError],
            `session '${sessionId2}' move is staged but not completed; its marker remains for the next queued recovery`
          );
        }
      }
    });
  }
  /** Convenience wrapper; one queued stage+finish operation. */
  relocateSession(sessionId2, targetWorkspaceId) {
    return this.moveSession(sessionId2, targetWorkspaceId);
  }
  async finishSessionMove(marker) {
    const target = this.requireTable().get(marker.toWorkspaceId);
    if (target === void 0) throw new WorkspaceNotFoundError(marker.toWorkspaceId);
    await this.ensureSessionWorkingDirectory(marker.sessionId, target.path);
    await this.applySessionMove(marker.sessionId, marker.toWorkspaceId);
    await this.setState({
      ...this.requireState(),
      pendingMutation: void 0,
      sessionWorkspaceOverrides: this.overrideList()
    });
  }
  /**
   * Commit the moved Session's effective directory. The immutable header
   * cannot change, so recovery and completion both append the same durable
   * `working-directory/change` event the working-directory owner would. The
   * append is a no-op when the projection already names the target.
   */
  async ensureSessionWorkingDirectory(sessionId2, cwd) {
    const handle = await this.ctx.sessionPersistence.open(sessionId2, "write");
    try {
      const read = await handle.read(0);
      const changed = read.events.findLast((event2) => event2.type === "working-directory/change");
      const current = changed === void 0 ? handle.header.cwd : changed.data?.cwd;
      if (current === cwd) return;
      const event = {
        type: "working-directory/change",
        seq: SessionSeq(read.events.length),
        time: Date.now(),
        data: { cwd }
      };
      await handle.append([event]);
    } finally {
      await handle.close();
    }
  }
  /**
   * Drop a Session from every durable workspace surface: record accounting,
   * the archive set, the pin set, and any explicit move override. Idempotent;
   * used by the Host's permanent-deletion transaction after the log is gone.
   * @param sessionId - The Session identity to forget.
   * @returns resolution after every affected record and the global state are durable.
   */
  detachSession(sessionId2) {
    return this.enqueueOperation(async () => {
      const state = this.requireState();
      let accounted = false;
      for (const [, record] of this.requireTable().entries()) {
        if (record.sessionIds.includes(sessionId2)) {
          accounted = true;
          break;
        }
      }
      const known = accounted || this.sessionOverrides.has(sessionId2) || state.archivedSessionIds.includes(sessionId2) || state.pinnedSessionIds.includes(sessionId2);
      if (!known) return;
      await this.setState({ ...state, pendingMutation: { operation: "detachSession", sessionId: sessionId2 } });
      try {
        await this.applySessionDetach(sessionId2);
      } catch (error) {
        try {
          await this.recoverPendingMutation();
          return;
        } catch (recoveryError) {
          throw new AggregateError(
            [error, recoveryError],
            `session '${sessionId2}' detach failed and its pending marker could not be completed`
          );
        }
      }
      await this.setState({
        ...this.requireState(),
        pendingMutation: void 0,
        archivedSessionIds: this.requireState().archivedSessionIds.filter((id) => id !== sessionId2),
        pinnedSessionIds: this.requireState().pinnedSessionIds.filter((id) => id !== sessionId2),
        sessionWorkspaceOverrides: this.overrideList()
      });
    });
  }
  /**
   * The registry-global pin set: sessions surfaced ahead of every unpinned
   * session on grouping surfaces. Pinning never touches workspace accounting.
   * @returns Session ids in pin order (most recently pinned first).
   */
  get pinnedSessionIds() {
    return this.requireState().pinnedSessionIds;
  }
  /**
   * Pin one session durably, prepending it to the registry-global pin set.
   * The session must exist (live or in session persistence) and must not be
   * archived. An already pinned id resolves without writing or reordering.
   * @param sessionId - The session to pin.
   * @returns resolution after durability.
   */
  pinSession(sessionId2) {
    return this.enqueueOperation(async () => {
      if (this.requireState().pinnedSessionIds.includes(sessionId2)) return;
      if (this.requireState().archivedSessionIds.includes(sessionId2)) {
        throw new WorkspaceArchivedSessionPinError(sessionId2);
      }
      if (!await this.sessionKnown(sessionId2)) {
        throw new WorkspaceUnknownSessionError(sessionId2, "pin");
      }
      const state = this.requireState();
      await this.setState({
        ...state,
        pinnedSessionIds: [sessionId2, ...state.pinnedSessionIds]
      });
    });
  }
  /**
   * Unpin one session durably by dropping it from the registry-global pin
   * set. Unpinning runs no session-existence check because removing an id
   * cannot introduce an unknown one, so an entry whose session is gone still
   * resolves. An id that is not pinned resolves without writing.
   * @param sessionId - The session to unpin.
   * @returns resolution after durability.
   */
  unpinSession(sessionId2) {
    return this.enqueueOperation(async () => {
      const state = this.requireState();
      if (!state.pinnedSessionIds.includes(sessionId2)) return;
      await this.setState({
        ...state,
        pinnedSessionIds: state.pinnedSessionIds.filter((id) => id !== sessionId2)
      });
    });
  }
  /**
   * Whether a session is live, header-indexed, or present in a fresh
   * persistence listing. Only a definite miss returns false — a failing
   * `sessionPersistence.list()` propagates so storage faults never
   * masquerade as an unknown session.
   */
  async sessionKnown(id) {
    if (this.ctx.get("sessions")?.get(id) !== void 0) return true;
    if (this.headers.has(id)) return true;
    await this.indexHeaders(await this.listStoredHeaders());
    return this.headers.has(id);
  }
  /** Request every provider's stop; a failing provider is logged, never a reason to keep the session visible. */
  async stopSessionActivity(sessionId2) {
    try {
      await this.ctx.parallel("workspace/session-stop", { sessionId: sessionId2 });
    } catch (error) {
      const failures = error instanceof AggregateError ? error.errors : [error];
      for (const failure of failures) {
        this.ctx.logger.warn(`workspace: stopping session '${sessionId2}' for archive failed: ${String(failure)}`);
      }
    }
  }
  /**
   * Resolve by canonical directory path without creating or mutating a
   * workspace. A missing path rejects during `realpath`; an existing unowned
   * directory returns `undefined`.
   * @param path - Existing directory path in a fully qualified spelling.
   * @returns the workspace owning the canonical path, when one exists.
   */
  async resolveByPath(path) {
    const canonical = await realpathNormalize(path);
    for (const entity of this.entities.values()) {
      if (entity.path === canonical) return entity;
    }
    return void 0;
  }
  async createCanonical(canonical, title, firstUse = false) {
    for (const entity2 of this.entities.values()) {
      if (entity2.path === canonical) return entity2;
    }
    const workspaceName = title ?? defaultWorkspaceTitle(canonical);
    const table = this.requireTable();
    const state = this.requireState();
    const id = WorkspaceId(randomUUID());
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      path: canonical,
      title: workspaceName,
      sessionIds: [],
      createdAt: now,
      updatedAt: now
    };
    const entity = new WorkspaceEntity(this.host, id, record);
    this.entities.set(id, entity);
    const pendingState = {
      ...state,
      pendingMutation: { operation: "create", workspaceId: id }
    };
    try {
      await this.setState(pendingState);
    } catch (error) {
      this.entities.delete(id);
      throw error;
    }
    try {
      await table.put(id, record);
    } catch (error) {
      this.entities.delete(id);
      try {
        await this.setState(state);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record write and pending-marker rollback both failed`
        );
      }
      throw error;
    }
    try {
      await this.setState({
        ...state,
        pendingMutation: void 0,
        initialized: true,
        ...firstUse ? { defaultWorkspaceId: id } : {},
        workspaceIds: [id, ...state.workspaceIds]
      });
    } catch (error) {
      this.entities.delete(id);
      try {
        await table.delete(id);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and record rollback both failed; the pending marker remains recoverable`
        );
      }
      try {
        await this.setState(state);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and pending-marker rollback both failed`
        );
      }
      throw error;
    }
    return entity;
  }
  async deleteKnown(id) {
    const entity = this.entities.get(id);
    if (entity === void 0) return false;
    const state = this.requireState();
    const nextState = {
      ...state,
      pendingMutation: void 0,
      initialized: true,
      workspaceIds: state.workspaceIds.filter((workspaceId2) => workspaceId2 !== id)
    };
    await this.setState({
      ...nextState,
      pendingMutation: { operation: "delete", workspaceId: id }
    });
    this.entities.delete(id);
    try {
      await this.requireTable().delete(id);
    } catch (error) {
      this.entities.set(id, entity);
      try {
        await this.setState(state);
      } catch (rollbackError) {
        this.entities.delete(id);
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record deletion and registry-order rollback both failed`
        );
      }
      throw error;
    }
    try {
      await this.setState(nextState);
    } catch (error) {
      this.ctx.logger.warn(
        `workspace '${id}' was deleted but its pending marker could not be cleared: ${String(error)}`
      );
    }
    return true;
  }
  /**
   * Complete the one mutation explicitly named by durable state. Unexplained
   * order/table divergence still reaches {@link validateStoredState} and
   * fails loud; this path never guesses which operation created a row from its shape alone.
   */
  /**
   * Complete the one mutation explicitly named by durable state.
   *
   * Session moves and detaches stage a marker before touching records, so a
   * failure or process death at any point is completed from the marker instead
   * of leaving an override/record disagreement for {@link validateStoredState}
   * to reject. Workspace create/delete markers keep their original recovery.
   */
  async recoverPendingMutation() {
    const state = this.requireState();
    const pending = state.pendingMutation;
    if (pending === void 0) return;
    if (pending.operation === "moveSession") {
      await this.finishSessionMove(pending);
      return;
    }
    if (pending.operation === "detachSession") {
      await this.applySessionDetach(pending.sessionId);
      await this.setState({
        ...this.requireState(),
        pendingMutation: void 0,
        archivedSessionIds: this.requireState().archivedSessionIds.filter((id) => id !== pending.sessionId),
        pinnedSessionIds: this.requireState().pinnedSessionIds.filter((id) => id !== pending.sessionId),
        sessionWorkspaceOverrides: this.overrideList()
      });
      return;
    }
    if (state.workspaceIds.includes(pending.workspaceId)) {
      throw new Error(
        `workspace domain is inconsistent: pending ${pending.operation} workspace '${pending.workspaceId}' is still present in registry order`
      );
    }
    await this.requireTable().delete(pending.workspaceId);
    await this.setState({ ...state, pendingMutation: void 0 });
  }
  /** Apply the record/override half of a staged Session move (idempotent). */
  async applySessionMove(sessionId2, targetWorkspaceId) {
    const table = this.requireTable();
    if (table.get(targetWorkspaceId) === void 0) throw new WorkspaceNotFoundError(targetWorkspaceId);
    const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    for (const [id, record] of table.entries()) {
      if (id === targetWorkspaceId || !record.sessionIds.includes(sessionId2)) continue;
      await table.update(id, (current) => current.sessionIds.includes(sessionId2) ? { ...current, sessionIds: current.sessionIds.filter((value) => value !== sessionId2), updatedAt } : current);
    }
    await table.update(targetWorkspaceId, (record) => record.sessionIds.includes(sessionId2) ? record : { ...record, sessionIds: [sessionId2, ...record.sessionIds], updatedAt });
    this.sessionOverrides.set(sessionId2, targetWorkspaceId);
    this.rebuildEntities();
  }
  /** Apply the record/override half of a staged Session detach (idempotent). */
  async applySessionDetach(sessionId2) {
    const table = this.requireTable();
    const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    for (const [id, record] of table.entries()) {
      if (!record.sessionIds.includes(sessionId2)) continue;
      await table.update(id, (current) => current.sessionIds.includes(sessionId2) ? { ...current, sessionIds: current.sessionIds.filter((value) => value !== sessionId2), updatedAt } : current);
    }
    this.sessionOverrides.delete(sessionId2);
    this.rebuildEntities();
  }
  async bootstrap(headers) {
    const table = this.requireTable();
    const state = this.requireState();
    const groupsByPath = /* @__PURE__ */ new Map();
    for (const header of headers) {
      if (this.sessionOverrides.has(header.id)) continue;
      const path = this.sessionPaths.get(header.id);
      if (path === void 0) continue;
      const group = groupsByPath.get(path);
      if (group === void 0) groupsByPath.set(path, [header]);
      else group.push(header);
    }
    const groups = [...groupsByPath].map(([path, groupHeaders]) => {
      groupHeaders.sort(compareHeaders);
      const newest = groupHeaders[0];
      return { path, headers: groupHeaders, newestAt: newest.createdAt };
    }).sort((left, right) => right.newestAt - left.newestAt || left.path.localeCompare(right.path));
    const byPath = /* @__PURE__ */ new Map();
    const accounted = /* @__PURE__ */ new Map();
    for (const [id, record] of table.entries()) {
      byPath.set(record.path, id);
      for (const sessionId2 of record.sessionIds) accounted.set(sessionId2, id);
    }
    for (const group of groups) {
      let id = byPath.get(group.path);
      if (id === void 0) {
        const sessionIds2 = group.headers.map((header) => header.id).filter((sessionId2) => !accounted.has(sessionId2));
        if (sessionIds2.length === 0) continue;
        id = WorkspaceId(randomUUID());
        const createdAt = new Date(group.newestAt).toISOString();
        const record = {
          path: group.path,
          title: defaultWorkspaceTitle(group.path),
          sessionIds: sessionIds2,
          createdAt,
          updatedAt: createdAt
        };
        await table.put(id, record);
        byPath.set(group.path, id);
        for (const sessionId2 of sessionIds2) accounted.set(sessionId2, id);
        continue;
      }
      const current = table.get(id);
      const historical = group.headers.map((header) => header.id).filter((sessionId2) => accounted.get(sessionId2) === void 0 || accounted.get(sessionId2) === id);
      const historicalSet = new Set(historical);
      const sessionIds = [
        ...historical,
        ...current.sessionIds.filter((sessionId2) => !historicalSet.has(sessionId2))
      ];
      if (sameSessionIds(current.sessionIds, sessionIds)) continue;
      await table.update(id, (record) => ({
        ...record,
        sessionIds,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }));
      for (const sessionId2 of historical) accounted.set(sessionId2, id);
    }
    const groupRank = new Map(groups.map((group) => [group.path, group.newestAt]));
    const priorRank = new Map(state.workspaceIds.map((id, index) => [id, index]));
    const workspaceIds = [...table.entries()].sort(([leftId, left], [rightId, right]) => {
      const leftTime = groupRank.get(left.path) ?? Date.parse(left.createdAt);
      const rightTime = groupRank.get(right.path) ?? Date.parse(right.createdAt);
      return rightTime - leftTime || (priorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER) - (priorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER) || String(leftId).localeCompare(String(rightId));
    }).map(([id]) => id);
    if (!sameIds(state.workspaceIds, workspaceIds)) {
      await this.setState({
        initialized: false,
        workspaceIds,
        archivedSessionIds: state.archivedSessionIds,
        pinnedSessionIds: state.pinnedSessionIds,
        sessionWorkspaceOverrides: state.sessionWorkspaceOverrides
      });
    }
    await this.setState({
      initialized: true,
      workspaceIds,
      archivedSessionIds: state.archivedSessionIds,
      pinnedSessionIds: state.pinnedSessionIds,
      sessionWorkspaceOverrides: state.sessionWorkspaceOverrides
    });
  }
  validateStoredState(state) {
    const table = this.requireTable();
    const order = /* @__PURE__ */ new Set();
    for (const id of state.workspaceIds) {
      if (order.has(id)) {
        throw new Error(`workspace domain is inconsistent: registry order repeats workspace '${id}'`);
      }
      if (table.get(id) === void 0) {
        throw new Error(`workspace domain is inconsistent: registry order references missing workspace '${id}'`);
      }
      order.add(id);
    }
    if (state.initialized && order.size !== table.size) {
      const orphan = [...table.keys()].find((id) => !order.has(id));
      throw new Error(
        `workspace domain is inconsistent: workspace '${orphan}' is absent from registry order`
      );
    }
    const paths = /* @__PURE__ */ new Map();
    const accounted = /* @__PURE__ */ new Map();
    for (const [id, record] of table.entries()) {
      const pathHolder = paths.get(record.path);
      if (pathHolder !== void 0) {
        throw new Error(
          `workspace domain is inconsistent: path '${record.path}' is claimed by both workspace '${pathHolder}' and workspace '${id}'`
        );
      }
      paths.set(record.path, id);
      for (const sessionId2 of record.sessionIds) {
        const holder = accounted.get(sessionId2);
        if (holder !== void 0) {
          throw new Error(
            `workspace domain is inconsistent: session '${sessionId2}' is accounted by both workspace '${holder}' and workspace '${id}'`
          );
        }
        accounted.set(sessionId2, id);
      }
    }
    const overridden = /* @__PURE__ */ new Set();
    for (const entry of state.sessionWorkspaceOverrides) {
      if (overridden.has(entry.sessionId)) {
        throw new Error(`workspace domain is inconsistent: session '${entry.sessionId}' has repeated move overrides`);
      }
      overridden.add(entry.sessionId);
      if (table.get(entry.workspaceId) === void 0) {
        throw new Error(
          `workspace domain is inconsistent: session '${entry.sessionId}' overrides to missing workspace '${entry.workspaceId}'`
        );
      }
      if (accounted.get(entry.sessionId) !== entry.workspaceId) {
        throw new Error(
          `workspace domain is inconsistent: session '${entry.sessionId}' overrides workspace '${entry.workspaceId}' but its record accounting disagrees`
        );
      }
    }
  }
  indexOverrides(state) {
    this.sessionOverrides.clear();
    for (const entry of state.sessionWorkspaceOverrides) this.sessionOverrides.set(entry.sessionId, entry.workspaceId);
  }
  overrideList() {
    return [...this.sessionOverrides].map(([sessionId2, workspaceId2]) => ({ sessionId: sessionId2, workspaceId: workspaceId2 }));
  }
  rebuildEntities() {
    this.entities.clear();
    for (const id of this.requireState().workspaceIds) {
      const record = this.requireTable().get(id);
      this.entities.set(id, new WorkspaceEntity(this.host, id, record));
    }
  }
  async replaceHeaderIndex(headers) {
    this.headers.clear();
    this.sessionPaths.clear();
    this.missingSessionPaths.clear();
    this.invalidSessionPaths.clear();
    await this.indexHeaders(headers);
  }
  async indexHeaders(headers) {
    for (const header of headers) await this.indexHeader(header);
  }
  async indexHeader(header) {
    this.headers.set(header.id, header);
    this.sessionPaths.delete(header.id);
    this.missingSessionPaths.delete(header.id);
    if (header.cwd === void 0) {
      this.invalidSessionPaths.set(header.id, "header has no cwd");
      return;
    }
    try {
      const path = await realpathNormalize(header.cwd);
      if (!(await stat2(path)).isDirectory()) {
        this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' is not a directory`);
        return;
      }
      this.sessionPaths.set(header.id, path);
      this.invalidSessionPaths.delete(header.id);
    } catch (error) {
      if (fullyQualifiedWorkspacePath(header.cwd) && error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.missingSessionPaths.add(header.id);
      }
      this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' does not resolve`);
    }
  }
  /** Every stored session's header, projected from the persistence snapshot listing. */
  async listStoredHeaders() {
    const snapshots = await this.ctx.sessionPersistence.list();
    return snapshots.map((snapshot) => snapshot.header);
  }
  async indexLiveSessions() {
    const sessions = this.ctx.get("sessions");
    if (sessions === void 0) return;
    await this.indexHeaders(sessions.list().map((session) => session.header));
  }
  reportFilteredCandidates() {
    for (const entity of this.entities.values()) {
      const record = this.requireTable().get(entity.id);
      for (const sessionId2 of record.sessionIds) {
        if (this.host.candidateMatches(sessionId2, record.path)) continue;
        const path = this.sessionPaths.get(sessionId2);
        const reason = this.invalidSessionPaths.get(sessionId2) ?? (this.headers.has(sessionId2) ? `canonical cwd '${path}' differs from workspace path '${record.path}'` : "session header is missing");
        this.ctx.logger.warn(
          `workspace '${entity.id}' filtered session '${sessionId2}' from membership: ${reason}`
        );
      }
    }
  }
  async readSessionHeader(id) {
    const live = this.ctx.get("sessions")?.get(id);
    if (live !== void 0) {
      this.headers.set(id, live.header);
      return live.header;
    }
    const cached = this.headers.get(id);
    if (cached !== void 0) return cached;
    const headers = await this.listStoredHeaders();
    await this.indexHeaders(headers);
    const header = this.headers.get(id);
    if (header === void 0) {
      throw new Error(`cannot validate session '${id}': session persistence holds no such session`);
    }
    return header;
  }
  requireTable() {
    if (this.table === void 0) throw new Error("workspace registry is not started yet");
    return this.table;
  }
  requireState() {
    if (this.state === void 0) throw new Error("workspace registry is not started yet");
    return this.state;
  }
  async setState(state) {
    await this.global.set(state);
    this.state = state;
  }
  enqueueOperation(operation) {
    const result = this.operationTail.then(async () => {
      await this.recoverPendingMutation();
      return await operation();
    });
    this.operationTail = result.then(() => {
    }, () => {
    });
    return result;
  }
};
var sameSessionIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);
var src_default = WorkspaceRegistry;
export {
  src_default as default
};
