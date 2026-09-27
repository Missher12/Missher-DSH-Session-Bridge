/** Create the shared scratch workspace without creating a directory-making Session. */
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SCRATCH_PATH, scratchTitle } from "./scratch-wire.js";
/** Resolve the owned fixed leaf; reading it never creates a directory. */
async function canonicalScratchDirectory(directory) {
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()
        || (typeof process.getuid === 'function' && entry.uid !== process.getuid())
        || (process.platform !== 'win32' && (entry.mode & 0o022) !== 0)) {
        throw new Error(`scratch directory must be an owned directory without group/other write access: ${directory}`);
    }
    return await realpath(directory);
}
/** Read the configured scratch identity without creating or renaming anything. */
export async function findScratchWorkspace(registry, root, signal) {
    signal.throwIfAborted();
    let path;
    try {
        path = await canonicalScratchDirectory(join(resolve(root), 'dsh-scratch'));
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return null;
        throw error;
    }
    signal.throwIfAborted();
    const workspace = await registry.resolveByPath(path);
    return workspace === undefined ? null : { workspaceId: workspace.id, path: workspace.path, title: workspace.title };
}
/**
 * Ensure one canonical directory and workspace. Existing titles are retained.
 * Cancellation can leave a directory or committed registration for the next retry.
 */
export async function ensureScratchWorkspace(registry, root, title, signal) {
    signal.throwIfAborted();
    const directory = join(resolve(root), 'dsh-scratch');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = await canonicalScratchDirectory(directory);
    signal.throwIfAborted();
    const workspace = await registry.create(path, title);
    return { workspaceId: workspace.id, path: workspace.path, title: workspace.title };
}
/** Install only while the Host's Connection and workspace registry are available. */
export function registerScratchRoute(ctx, root) {
    ctx.inject(['connection', 'workspaceRegistry'], (scope) => {
        const connection = scope.get('connection');
        const registry = scope.get('workspaceRegistry');
        let pending;
        scope.effect(() => {
            let closing = false;
            const unregister = connection.fetch.register({
                path: SCRATCH_PATH,
                methods: ['GET', 'POST'],
                requestBody: 'buffered',
                async fetch(request) {
                    let result;
                    try {
                        if (closing)
                            throw new Error('session-bridge is unloading');
                        if (request.method === 'GET') {
                            return Response.json({ ok: true, value: await findScratchWorkspace(registry, root, request.signal) }, { headers: { 'cache-control': 'no-store' } });
                        }
                        if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
                            throw new TypeError('scratch request requires application/json');
                        }
                        const title = scratchTitle(await request.json());
                        request.signal.throwIfAborted();
                        pending ??= ensureScratchWorkspace(registry, root, title, request.signal)
                            .finally(() => { pending = undefined; });
                        result = { ok: true, value: await pending };
                    }
                    catch (error) {
                        result = { ok: false, error: {
                                code: 'session-bridge/scratch-failed',
                                message: error instanceof Error ? error.message : String(error), details: {},
                            } };
                    }
                    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
                },
            });
            return async () => {
                closing = true;
                await unregister();
                await pending?.catch(() => undefined);
            };
        }, 'session-bridge: scratch route');
    });
}
