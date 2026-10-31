// ../../../../../../private/tmp/sb-runtime/controller-sub-entry.ts
import { Service } from "@deepseek-ai/cordis";

// ../../../../../../private/tmp/sb-runtime/scope.ts
import { AsyncLocalStorage } from "node:async_hooks";
function createHandleScope() {
  const storage = new AsyncLocalStorage();
  return {
    async run(owner, operation) {
      const token = { owner, active: true };
      try {
        return await storage.run(token, operation);
      } finally {
        token.active = false;
      }
    },
    owns(owner) {
      const token = storage.getStore();
      return token?.active === true && token.owner === owner;
    }
  };
}
function restoreIfCurrent(target, key, installed, previous) {
  if (target[key] === installed) target[key] = previous;
}

// ../../../../../../private/tmp/sb-runtime/controller-sub-entry.ts
import BaseSessionController from "@deepseek-ai/dsh-api-session-controller";

// ../../../../../../private/tmp/sb-runtime/lifecycle.ts
import {
  SessionAlreadyOwnedError,
  SessionPersistenceNotFoundError
} from "@deepseek-ai/dsh-session-persistence";

class SessionPersistenceChildExistsError extends Error {
  constructor(id) { super(`session ${id} has derived Sessions`); this.name = 'SessionPersistenceChildExistsError' }
}
class SessionPersistenceDeleteUnsupportedError extends Error {
  constructor(message = 'deletion is not supported by this persistence backend') { super(message); this.name = 'SessionPersistenceDeleteUnsupportedError' }
}

var SessionLifecycleError = class extends Error {
  /**
   * @param code - stable code the client route reports.
   * @param message - human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "SessionLifecycleError";
  }
  code;
};
function workspaceId(value) {
  return value;
}
var SessionLifecycleController = class {
  /**
   * @param ctx - Host context that mounts the persistence, workspace, query and directory services.
   * @param agents - the controller that owns the creation handles of idle Agents.
   */
  constructor(ctx, agents) {
    this.ctx = ctx;
    this.agents = agents;
  }
  ctx;
  agents;
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
  async deleteSession(sessionId, options = {}) {
    if (options.archivedOnly === true && !this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) {
      throw new SessionLifecycleError(
        "session/delete-not-archived",
        `session '${sessionId}' is not archived; archive it before deleting`
      );
    }
    const released = await this.agents.releaseIdle(sessionId);
    if (released === "running") {
      throw new SessionLifecycleError(
        "session/delete-active",
        `session '${sessionId}' is running; stop it before deleting`
      );
    }
    if (released === "unmanaged" || this.ctx.sessions.get(sessionId) !== void 0) {
      throw new SessionLifecycleError(
        "session/delete-owned",
        `session '${sessionId}' is owned by another component; retry after it is released`
      );
    }
    const activity = await this.ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));
    if (activity.length > 0) {
      throw new SessionLifecycleError(
        "session/delete-active",
        `session '${sessionId}' still has active work (${activity.map((entry) => entry.kind).join(", ")})`
      );
    }
    const observations = await this.ctx.sessionQuery.listSessions();
    if (observations.some((observation) => observation.header.parentSession === sessionId)) {
      throw new SessionLifecycleError(
        "session/delete-has-children",
        `session '${sessionId}' has derived Sessions; delete those first`
      );
    }
    try {
      await this.ctx.sessionPersistence.delete(sessionId);
    } catch (error) {
      if (error instanceof SessionPersistenceNotFoundError) {
      } else if (error instanceof SessionAlreadyOwnedError) {
        throw new SessionLifecycleError(
          "session/delete-owned",
          `session '${sessionId}' is owned by another writer`
        );
      } else if (error instanceof SessionPersistenceChildExistsError || error?.name === "SessionPersistenceChildExistsError") {
        throw new SessionLifecycleError(
          "session/delete-has-children",
          `session '${sessionId}' has derived Sessions; delete those first`
        );
      } else if (error instanceof SessionPersistenceDeleteUnsupportedError || error?.name === "SessionPersistenceDeleteUnsupportedError") {
        throw new SessionLifecycleError(
          "session/delete-unsupported",
          "the mounted persistence backend has no deletion transaction"
        );
      } else {
        throw error;
      }
    }
    try {
      await this.ctx.workspaceRegistry.detachSession(sessionId);
    } catch (error) {
      this.ctx.logger.warn(`session-controller: deleted '${sessionId}' but could not detach its workspace accounting: ${String(error)}`);
    }
  }
  /**
   * Permanently delete one *archived* Session (the legacy Host contract).
   * @param sessionId - the archived Session to delete.
   * @throws {SessionLifecycleError} `session/delete-not-archived` or a deletion refusal.
   */
  deleteArchivedSession(sessionId) {
    return this.deleteSession(sessionId, { archivedOnly: true });
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
  async moveSession(sessionId, targetWorkspaceId) {
    const target = this.ctx.workspaceRegistry.get(workspaceId(targetWorkspaceId));
    if (target === void 0) {
      throw new SessionLifecycleError("session/move-target-missing", "the target workspace no longer exists");
    }
    const released = await this.agents.releaseIdle(sessionId);
    if (released === "running") {
      throw new SessionLifecycleError(
        "session/move-active",
        `session '${sessionId}' is running; stop it before moving`
      );
    }
    if (released === "unmanaged" || this.ctx.sessions.get(sessionId) !== void 0) {
      throw new SessionLifecycleError(
        "session/move-busy",
        `session '${sessionId}' is owned by another component; retry after it is released`
      );
    }
    const activity = await this.ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));
    if (activity.length > 0) {
      throw new SessionLifecycleError(
        "session/move-active",
        `session '${sessionId}' still has active work (${activity.map((entry) => entry.kind).join(", ")})`
      );
    }
    if (await this.ctx.sessionPersistence.stat(sessionId) === void 0) {
      throw new SessionLifecycleError("session/move-not-found", `session '${sessionId}' was not found`);
    }
    await this.ctx.workspaceRegistry.moveSession(sessionId, target.id);
  }
};

// ../../../../../../private/tmp/sb-runtime/controller-sub-entry.ts
var SbSessionController = class extends BaseSessionController {
  static inject = [...BaseSessionController.inject ?? [], "sessionPersistence"];
  lifecycle;
  lineageChains = /* @__PURE__ */ new Map();
  async [Service.init]() {
    await super[Service.init]?.();
    const ctx = this.ctx;
    const agents = this.agents;
    const handles = /* @__PURE__ */ new Map();
    const scope = createHandleScope();
    const restores = [];
    const disposeListener = ctx.on("agent/disposed", ({ agent }) => {
      handles.delete(agent.id);
    });
    restores.push(() => disposeListener());
    for (const name of ["resolve", "claim", "createMinted"]) {
      const original = agents[name];
      if (typeof original !== "function") continue;
      const wrapper = (...args) => scope.run(agents, () => original.apply(agents, args));
      agents[name] = wrapper;
      restores.push(() => restoreIfCurrent(agents, name, wrapper, original));
    }
    const globalCreate = ctx.agents.create;
    const globalResume = ctx.agents.resume;
    const capture = (original) => async (...args) => {
      const handle = await original.apply(ctx.agents, args);
      if (scope.owns(agents)) handles.set(handle.agent.id, handle);
      return handle;
    };
    const createWrapper = capture(globalCreate);
    const resumeWrapper = capture(globalResume);
    ctx.agents.create = createWrapper;
    ctx.agents.resume = resumeWrapper;
    restores.push(() => {
      if (ctx.agents.create === createWrapper) ctx.agents.create = globalCreate;
      if (ctx.agents.resume === resumeWrapper) ctx.agents.resume = globalResume;
    });
    const adapter = {
      releaseIdle: async (sessionId) => {
        const agent = ctx.agents.get(sessionId);
        if (agent === void 0) return "missing";
        if (agent.status === "running") return "running";
        const handle = handles.get(sessionId);
        if (handle === void 0) return "unmanaged";
        handles.delete(sessionId);
        await handle.dispose();
        return "released";
      }
    };
    this.lifecycle = new SessionLifecycleController(ctx, adapter);
    const baseFork = this.fork;
    if (typeof baseFork === "function") {
      const forkWrapper = (request) => this.inLineage(
        request.sessionId,
        () => scope.run(agents, () => baseFork.call(this, request))
      );
      this.fork = forkWrapper;
      restores.push(() => {
        if (this.fork === forkWrapper) delete this.fork;
      });
    }
    ctx.effect(() => () => {
      for (const restore of restores.reverse()) restore();
      handles.clear();
    }, "sb-session-controller lifecycle handles");
  }
  inLineage(sessionId, operation) {
    const result = (this.lineageChains.get(sessionId) ?? Promise.resolve()).then(operation);
    const settled = result.then(() => void 0, () => void 0);
    this.lineageChains.set(sessionId, settled);
    return result.finally(() => {
      if (this.lineageChains.get(sessionId) === settled) this.lineageChains.delete(sessionId);
    });
  }
  deleteSession(sessionId) {
    return this.inLineage(sessionId, () => this.lifecycle.deleteSession(sessionId));
  }
  deleteArchivedSession(sessionId) {
    return this.inLineage(sessionId, () => this.lifecycle.deleteSession(sessionId, { archivedOnly: true }));
  }
  moveSession(sessionId, targetWorkspaceId) {
    return this.inLineage(sessionId, () => this.lifecycle.moveSession(sessionId, targetWorkspaceId));
  }
};
export {
  SbSessionController as default
};
