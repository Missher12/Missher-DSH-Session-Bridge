/**
 * In-package deletion companion for the reviewed 0.2.2-rc.3 JSONL composition.
 * No Host code or native addon is copied. The existing owners supply writer
 * leases, write queues and index reconciliation. Unknown implementations refuse.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { warn } from "./dsh.js";
// These private seams are deliberately narrower than Bridge's other features.
// Compare the raw prototype, not Cordis's traced `service.constructor` wrapper.
const REVIEWED = {
    sessionPersistence: '3b266ac3f592216e5967eedce615630e07024c68637fe9f86ba152419805c3f7',
    workspaceRegistry: '0f77c69b0ba7304ca545382ff28a54223b676ae3b11dd7f98931be92fd070c09',
    sessionProjectionCache: 'd2be1d374a7320e09e837ea912a40aadf4e34e532f7b3e7826ab994948b5a83b',
    sessionQuery: '442848396e7bcd64362ce13ee0322bb2c38ca8153d73ead968c806c67c98eb58',
};
// The installed 0.1.0 persistence/workspace pair has native lifecycle locks
// and move overrides. Its controller deletion method is unsafe and is bypassed.
const LEGACY = {
    sessionPersistence: '26d5c499ca2781c8f02604a727cb0f2b376a48a8fd56e5de939f8194592a1063',
    workspaceRegistry: '924f5bcc2e7fe8e71eddf306781a7797aac9b96c4dd4dd59f514548765e6b59c',
    lease: '4299bd33a2590fe367b40e9b0129ce89a402464b2764d14633c59ba88e9acc0c',
    owner: 'c5339e44a6d5930d8d46afb70490c9d842b6de99440ee25131fac4c65ca52126',
    registry: 'c91556bb3126a811df40e319ccb98ffba75a119c79d8c97c33999f4c478da0f2',
    deleteSession: '703ae11c5b1f96b83f379b5c70325a4d7be7a90af627aed8116358fb33de57d5',
    deleteArchivedSession: '1c887f0de84ecab08d155d7a220da542a812ff9b329af3c7f84111307ff271ed',
};
/** Refusals are stable across HTTP and the native adapter verification. */
function refuse(reason) { throw new Error(`session/delete-${reason}`); }
function missing(error) { return error?.code === 'ENOENT'; }
const digest = (value) => createHash('sha256').update(value).digest('hex');
/** Do not advertise the known 0.1.0 controller while the safe adapter is absent. */
export function hasLegacyDeletion(controller) {
    return ['deleteSession', 'deleteArchivedSession'].some(key => {
        const value = Object.getOwnPropertyDescriptor(controller, key)?.value;
        return typeof value === 'function' && digest(value.toString()) === LEGACY[key];
    });
}
/** Install for a reviewed composition, including the old lifecycle decorator. */
export function registerSessionDeletion(ctx) {
    let available;
    ctx.inject(['sessionPersistence', 'workspaceRegistry', 'sessionProjectionCache', 'sessionQuery', 'sessionController', 'agents', 'sessions'], scope => {
        const controller = scope.get('sessionController');
        if (!hasLegacyDeletion(controller)
            && (typeof controller.deleteSession === 'function' || typeof controller.deleteArchivedSession === 'function'))
            return;
        scope.effect(() => {
            let adapter;
            let closing = false;
            const ready = (async () => {
                try {
                    adapter = new JsonlDeletion(scope);
                    await adapter.initialize();
                    if (!closing)
                        available = adapter;
                }
                catch (error) {
                    await adapter?.dispose();
                    adapter = undefined;
                    warn(scope, `session-bridge: deletion companion unavailable: ${String(error)}`);
                }
            })();
            return async () => {
                closing = true;
                available = undefined;
                await ready;
                await adapter?.dispose();
            };
        }, 'session-bridge: deletion companion');
    });
    return () => available;
}
/** One reviewed service instance; exported for genuine Host integration checks. */
export class JsonlDeletion {
    ctx;
    persistence;
    workspace;
    query;
    cache;
    agents;
    legacy;
    leaseClass;
    root = '';
    records = '';
    lockDirectory = '';
    closing = false;
    tail = Promise.resolve();
    pending = new Set();
    deleting = new Set();
    handles = new Map();
    ownership = new AsyncLocalStorage();
    restore = [];
    constructor(ctx) {
        this.ctx = ctx;
        const storage = ctx.get('sessionPersistence');
        this.legacy = storage !== undefined
            && digest(Object.getPrototypeOf(storage).constructor.toString()) === LEGACY.sessionPersistence;
        for (const [name, fingerprint] of Object.entries(REVIEWED)) {
            const service = ctx.get(name);
            if (name === 'sessionProjectionCache' && service === undefined)
                continue;
            const expected = this.legacy && (name === 'sessionPersistence' || name === 'workspaceRegistry') ? LEGACY[name] : fingerprint;
            if (service === undefined || digest(Object.getPrototypeOf(service).constructor.toString()) !== expected) {
                refuse('unsupported');
            }
        }
        this.persistence = ctx.get('sessionPersistence');
        this.workspace = ctx.get('workspaceRegistry');
        this.query = ctx.get('sessionQuery');
        this.cache = ctx.get('sessionProjectionCache');
        this.agents = ctx.get('agents');
    }
    async initialize() {
        const profile = this.ctx.get('profileContext');
        if (typeof profile?.installAnchor !== 'string')
            refuse('unsupported');
        const host = JSON.parse(await readFile(profile.installAnchor, 'utf8'));
        if (host.version !== '0.2.2-rc.3')
            refuse('unsupported');
        await mkdir(this.persistence.root, { recursive: true });
        this.root = await realpath(this.persistence.root);
        const directory = join(this.root, '.session-bridge-deletion');
        for (const path of [directory, join(directory, 'records'), join(directory, 'lock')]) {
            await mkdir(path, { recursive: true, mode: 0o700 });
            if (!(await lstat(path)).isDirectory())
                refuse('unsupported');
        }
        this.records = join(directory, 'records');
        this.lockDirectory = join(directory, 'lock');
        await this.syncDirectory(directory);
        await this.syncDirectory(this.root);
        this.guardStorage();
        this.captureOwnership();
        // Recovery runs through the same locks and owner queues as a new request.
        await this.inLineage(async () => {
            for (const name of await readdir(this.records)) {
                if (!/^[a-f0-9]{64}\.json$/u.test(name))
                    continue;
                const record = await this.readRecord(join(this.records, name));
                if (digest(record.id) + '.json' !== name)
                    refuse('unsupported');
                if (!record.done) {
                    try {
                        await this.complete(record);
                    }
                    catch (error) {
                        if (!(error instanceof Error) || error.message !== 'session/delete-cleanup-pending')
                            throw error;
                        // Keep the route available for an explicit retry after an owner recovers.
                        warn(this.ctx, `session-bridge: cleanup pending for ${record.id}`);
                    }
                }
            }
        });
    }
    async deleteSession(id) {
        if (this.closing || this.deleting.has(id))
            refuse('busy');
        this.deleting.add(id);
        const operation = this.inLineage(async () => {
            const existing = await this.record(id);
            if (existing !== undefined) {
                if (!existing.done)
                    await this.complete(existing);
                return;
            }
            // Refuse queued/background work before releasing a controller-owned Agent.
            const agent = this.agents.get(id);
            if (agent !== undefined) {
                if (agent.status === 'running' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length)
                    refuse('active');
                if (this.handles.get(id)?.agent !== agent)
                    refuse('owned');
            }
            const ctx = this.ctx;
            if ((await ctx.waterfall('workspace/session-activity', { sessionId: id }, async () => [])).length)
                refuse('active');
            await this.assertNoChildren(id);
            if (agent !== undefined) {
                if (agent.status === 'running' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length)
                    refuse('active');
                await this.handles.get(id).dispose();
                this.handles.delete(id);
            }
            const sessions = this.ctx.get('sessions');
            if (this.agents.get(id) !== undefined || sessions.get(id) !== undefined)
                refuse('owned');
            this.persistence.tracker.claimWrite(id);
            let lease;
            let lifecycle;
            try {
                const found = await this.persistence.findLog(id);
                if (found === undefined)
                    refuse('not-found');
                const directory = await this.sessionDirectory(relative(resolve(this.persistence.root), dirname(found.currentPath)));
                if (this.legacy) {
                    lifecycle = await this.leaseClass.acquire(directory, id, 'session.lifecycle.lock');
                    // Older writers coordinate parent/child creation with this native lock.
                    await this.assertNoChildren(id);
                }
                lease = await this.persistence.acquireLease(id, undefined, directory);
                await this.artifacts(directory); // reject unfamiliar files before committing intent
                const record = { version: 1, id, directory: relative(this.root, directory), done: false };
                await this.writeRecord(record);
                await this.cleanup(record, directory);
            }
            finally {
                try {
                    await lease?.release();
                }
                finally {
                    try {
                        await lifecycle?.release();
                    }
                    finally {
                        this.persistence.tracker.releaseClaim(id);
                    }
                }
            }
        });
        this.pending.add(operation);
        try {
            await operation;
        }
        finally {
            this.pending.delete(operation);
            this.deleting.delete(id);
        }
    }
    async dispose() {
        this.closing = true;
        await Promise.allSettled([...this.pending, this.tail]);
        for (const restore of this.restore.reverse())
            restore();
        this.restore.length = 0;
        this.handles.clear();
    }
    /** Preserve the caller's traced `this`; never bind registry methods to our scope. */
    wrap(target, key, wrap, reviewedWrapper) {
        const previous = Object.getOwnPropertyDescriptor(target, key);
        // Only the exact reviewed lifecycle wrappers may be layered. Unknown
        // extensions and another Bridge adapter still refuse, without replacing them.
        if (previous !== undefined && (reviewedWrapper === undefined || typeof previous.value !== 'function'
            || digest(previous.value.toString()) !== reviewedWrapper))
            refuse('unsupported');
        let owner = target;
        let descriptor = previous;
        while (descriptor === undefined && (owner = Object.getPrototypeOf(owner)) !== null) {
            descriptor = Object.getOwnPropertyDescriptor(owner, key);
        }
        if (typeof descriptor?.value !== 'function')
            refuse('unsupported');
        const value = wrap(descriptor.value);
        Object.defineProperty(target, key, { configurable: true, writable: true, enumerable: previous?.enumerable ?? false, value });
        this.restore.push(() => {
            if (Object.getOwnPropertyDescriptor(target, key)?.value !== value)
                return;
            if (previous !== undefined)
                Object.defineProperty(target, key, previous);
            else
                Reflect.deleteProperty(target, key);
        });
    }
    guardStorage() {
        const adapter = this;
        // The journal hides every historical/compressed generation during recovery.
        this.wrap(this.persistence, 'findLog', original => async function (id, ...args) {
            if (await adapter.record(id))
                return undefined;
            return Reflect.apply(original, this, [id, ...args]);
        });
        const backend = this.persistence;
        this.wrap(backend, 'listArtifacts', original => async function (...args) {
            const rows = await Reflect.apply(original, this, args);
            const kept = await Promise.all(rows.map(async (row) => await adapter.record(row.header.id) ? undefined : row));
            return kept.filter(row => row !== undefined);
        });
        this.wrap(backend, 'open', original => async function (id, ...args) {
            if (adapter.deleting.has(id) || await adapter.record(id))
                refuse('busy');
            return Reflect.apply(original, this, [id, ...args]);
        });
        this.wrap(backend, 'create', original => function (header, ...args) {
            const receiver = this;
            return adapter.inLineage(async () => {
                if (adapter.closing || adapter.deleting.has(header.id) || await adapter.record(header.id))
                    refuse('busy');
                if (header.parentSession !== undefined && (await adapter.record(header.parentSession)
                    || await adapter.persistence.stat(header.parentSession) === undefined))
                    refuse('not-found');
                const handle = await Reflect.apply(original, receiver, [header, ...args]);
                // A child must be visible to another process before releasing the lineage lock.
                if (header.parentSession !== undefined) {
                    try {
                        await handle.flush();
                    }
                    catch (error) {
                        await handle.close();
                        throw error;
                    }
                }
                return handle;
            });
        });
        const workspace = this.workspace;
        this.wrap(workspace, 'indexHeader', original => async function (header) {
            if (!await adapter.record(header.id))
                await Reflect.apply(original, this, [header]);
            // indexHeader has an async realpath: do not reinsert a concurrently deleted header.
            if (await adapter.record(header.id))
                adapter.forgetHeader(header.id);
        });
        if (this.cache !== undefined) {
            const cache = this.cache;
            this.wrap(cache, 'put', original => async function (id, ...args) {
                if (!await adapter.record(id))
                    return Reflect.apply(original, this, [id, ...args]);
            });
        }
    }
    captureOwnership() {
        const adapter = this;
        const controller = this.ctx.get('sessionController');
        // Minimal non-Agent compositions can delete only cold Sessions. Real API
        // controllers expose these exact owners; other owners remain non-disposable.
        if (controller.agents === undefined)
            return;
        const owners = ['resolve', 'claim', 'createMinted'].map(key => [controller.agents, key]);
        if (controller.commands !== undefined)
            owners.push([controller.commands, 'fork']);
        for (const [owner, key] of owners) {
            this.wrap(owner, key, original => function (...args) {
                if ((key === 'resolve' || key === 'claim') && adapter.deleting.has(args[0]))
                    refuse('busy');
                const token = { active: true };
                return adapter.ownership.run(token, async () => {
                    try {
                        return await Reflect.apply(original, this, args);
                    }
                    finally {
                        token.active = false;
                    }
                });
            }, this.legacy && key !== 'fork' ? LEGACY.owner : undefined);
        }
        for (const key of ['create', 'resume']) {
            this.wrap(this.agents, key, original => async function (...args) {
                const handle = await Reflect.apply(original, this, args);
                if (adapter.ownership.getStore()?.active)
                    adapter.handles.set(handle.agent.id, handle);
                return handle;
            }, this.legacy ? LEGACY.registry : undefined);
        }
        this.restore.push(this.ctx.on('agent/disposed', ((event) => {
            if (this.handles.get(event.agent.id)?.agent === event.agent)
                this.handles.delete(event.agent.id);
        })));
    }
    inLineage(operation) {
        const result = this.tail.then(async () => {
            let lease;
            for (let attempt = 0; lease === undefined; attempt++) {
                try {
                    lease = await this.persistence.acquireLease('session-bridge-lineage', undefined, this.lockDirectory);
                }
                catch (error) {
                    if (!(error instanceof Error) || error.name !== 'SessionAlreadyOwnedError' || attempt >= 99)
                        throw error;
                    await delay(50);
                }
            }
            try {
                if (this.legacy && this.leaseClass === undefined) {
                    const constructor = Object.getPrototypeOf(lease).constructor;
                    if (digest(constructor.toString()) !== LEGACY.lease)
                        refuse('unsupported');
                    this.leaseClass = constructor;
                }
                return await operation();
            }
            finally {
                await lease.release();
            }
        });
        this.tail = result.catch(() => { });
        return result;
    }
    async record(id) {
        try {
            return await this.readRecord(join(this.records, digest(id) + '.json'), id);
        }
        catch (error) {
            if (missing(error))
                return undefined;
            throw error;
        }
    }
    async readRecord(path, expectedId) {
        if (!(await lstat(path)).isFile())
            refuse('unsupported');
        const value = JSON.parse(await readFile(path, 'utf8'));
        if (value.version !== 1 || typeof value.id !== 'string' || typeof value.directory !== 'string'
            || typeof value.done !== 'boolean' || (expectedId !== undefined && value.id !== expectedId))
            refuse('unsupported');
        return value;
    }
    async writeRecord(record) {
        const path = join(this.records, digest(record.id) + '.json');
        const temporary = `${path}.${randomUUID()}.tmp`;
        const file = await open(temporary, 'wx', 0o600);
        try {
            await file.writeFile(JSON.stringify(record));
            await file.sync();
        }
        finally {
            await file.close();
        }
        try {
            await rename(temporary, path);
            await this.syncDirectory(this.records);
        }
        finally {
            await unlink(temporary).catch(error => { if (!missing(error))
                throw error; });
        }
    }
    async sessionDirectory(path) {
        const parts = path.split(sep);
        if (parts.length !== 2 || parts.some(part => !part || part === '.' || part === '..')
            || parts[0] === '.session-bridge-deletion')
            refuse('unsupported');
        const absolute = resolve(this.root, path);
        if (relative(this.root, absolute) !== path)
            refuse('unsupported');
        for (const directory of [dirname(absolute), absolute]) {
            if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory)
                refuse('unsupported');
        }
        return absolute;
    }
    async artifacts(directory) {
        const files = [];
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.name === 'session.lock' && entry.isFile())
                continue;
            if (this.legacy && entry.isFile() && ['session.lifecycle.lock', 'session.deleted'].includes(entry.name))
                continue;
            if (!entry.isFile() || (!/^session\.(?:v\d+\.jsonl(?:\.zstd)?|migration\.[\w-]+\.jsonl(?:\.zstd)?\.tmp)$/u.test(entry.name)
                && !(this.legacy && /^session\.deleted\.\d+\.[a-f0-9]{12}$/u.test(entry.name)))) {
                refuse('unsupported');
            }
            files.push(join(directory, entry.name));
        }
        return files;
    }
    async complete(record) {
        const directory = await this.sessionDirectory(record.directory);
        this.persistence.tracker.claimWrite(record.id);
        let lease;
        let lifecycle;
        try {
            if (this.legacy) {
                lifecycle = await this.leaseClass.acquire(directory, record.id, 'session.lifecycle.lock');
                await this.assertNoChildren(record.id);
            }
            lease = await this.persistence.acquireLease(record.id, undefined, directory);
            await this.cleanup(record, directory);
        }
        finally {
            try {
                await lease?.release();
            }
            finally {
                try {
                    await lifecycle?.release();
                }
                finally {
                    this.persistence.tracker.releaseClaim(record.id);
                }
            }
        }
    }
    async cleanup(record, directory) {
        try {
            if (this.legacy)
                await this.persistence.writeDeletionTombstone(directory, record.id);
            for (const path of await this.artifacts(directory))
                await unlink(path);
            await this.syncDirectory(directory);
            this.persistence.coldLogMemo.delete(record.id);
            this.persistence.migrationPreparations.delete(record.id);
            if (this.legacy) {
                this.forgetHeader(record.id);
                // The legacy owner also clears durable move overrides and its journal.
                await this.workspace.detachSession(record.id);
            }
            else
                await this.workspace.enqueueOperation(async () => {
                    this.forgetHeader(record.id);
                    for (const workspace of this.workspace.list())
                        await workspace.detachSession(record.id);
                    const state = this.workspace.requireState();
                    if (state.archivedSessionIds.includes(record.id) || state.pinnedSessionIds.includes(record.id)) {
                        await this.workspace.setState({ ...state,
                            archivedSessionIds: state.archivedSessionIds.filter(id => id !== record.id),
                            pinnedSessionIds: state.pinnedSessionIds.filter(id => id !== record.id) });
                    }
                });
            await this.cache?.requireTable().delete(record.id);
            this.query._observations.cache.delete(record.id);
            // An unopened in-memory/disabled search index contains nothing to erase.
            const storedIndex = this.query.config.path !== ':memory:'
                && await lstat(this.query.config.path).then(() => true, error => { if (missing(error))
                    return false; throw error; });
            if (this.query._db !== undefined || storedIndex)
                await this.query._serialized(undefined, async () => {
                    await this.query._ensureReady();
                    await this.query._reconcile();
                });
            await this.writeRecord({ ...record, done: true });
        }
        catch (error) {
            throw new Error('session/delete-cleanup-pending', { cause: error });
        }
    }
    async assertNoChildren(id) {
        if ((await this.persistence.list()).some(row => row.header.parentSession === id)
            || this.agents.list().some(item => item.session.header.parentSession === id))
            refuse('has-children');
    }
    forgetHeader(id) {
        this.workspace.headers.delete(id);
        this.workspace.sessionPaths.delete(id);
        this.workspace.missingSessionPaths.delete(id);
        this.workspace.invalidSessionPaths.delete(id);
    }
    async syncDirectory(path) {
        if (process.platform === 'win32')
            return; // Windows does not expose directory fsync through Node.
        const handle = await open(path, 'r');
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
}
