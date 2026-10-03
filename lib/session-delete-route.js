import { deletionSessionId, SESSION_DELETE_PATH } from "./session-delete-wire.js";
/** Expose only the Host's deletion operation; never infer private storage paths. */
export function registerSessionDeleteRoute(ctx) {
    ctx.inject(['connection', 'sessionController'], scope => {
        const connection = scope.get('connection');
        const controller = scope.get('sessionController');
        scope.effect(() => {
            let closing = false;
            const pending = new Set();
            const unregister = connection.fetch.register({
                path: SESSION_DELETE_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
                async fetch(request) {
                    let status = 409;
                    try {
                        if (closing)
                            throw new Error('session/delete-busy');
                        if (request.method === 'GET') {
                            return Response.json({ supported: typeof controller.deleteArchivedSession === 'function' }, { headers: { 'cache-control': 'no-store' } });
                        }
                        if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
                            throw new TypeError('delete requires application/json');
                        }
                        const sessionId = deletionSessionId(await request.json());
                        request.signal.throwIfAborted();
                        if (controller.deleteArchivedSession === undefined) {
                            status = 501;
                            throw new Error('session/delete-unsupported');
                        }
                        const operation = controller.deleteArchivedSession(sessionId);
                        pending.add(operation);
                        try {
                            await operation;
                        }
                        finally {
                            pending.delete(operation);
                        }
                        return Response.json({ ok: true, value: { sessionId } }, { headers: { 'cache-control': 'no-store' } });
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        const code = /^session\/delete-[a-z-]+$/u.test(message) ? message
                            : error instanceof Error && error.name === 'SessionAlreadyOwnedError' ? 'session/delete-owned'
                                : error instanceof TypeError || error instanceof SyntaxError ? 'session/delete-invalid'
                                    : 'session/delete-failed';
                        return Response.json({ ok: false, error: { code, message, details: {} } }, { status: code === 'session/delete-invalid' ? 400 : status, headers: { 'cache-control': 'no-store' } });
                    }
                },
            });
            return async () => { closing = true; await unregister(); await Promise.allSettled(pending); };
        }, 'session-bridge: delete route');
    });
}
