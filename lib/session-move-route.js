import { SESSION_MOVE_PATH, moveSessionRequest } from "./session-move-wire.js";
/**
 * Expose only the Host's own Session move transaction; never rewrite a header,
 * a JSONL file, or workspace accounting from the plugin. A Host without
 * `sessionController.moveSession` is reported unsupported, so the plugin never
 * fakes a move by re-creating a Session.
 *
 * @param ctx - Host plugin context.
 */
export function registerSessionMoveRoute(ctx) {
    ctx.inject(['connection', 'sessionController'], scope => {
        const connection = scope.get('connection');
        const controller = scope.get('sessionController');
        scope.effect(() => {
            let closing = false;
            const pending = new Set();
            const unregister = connection.fetch.register({
                path: SESSION_MOVE_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
                async fetch(request) {
                    let status = 409;
                    try {
                        if (closing)
                            throw new Error('session/move-busy');
                        if (request.method === 'GET') {
                            return Response.json(typeof controller.moveSession === 'function'
                                ? { supported: true, backend: 'host' }
                                : { supported: false, reason: 'session/move-unsupported' }, { headers: { 'cache-control': 'no-store' } });
                        }
                        if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
                            throw new TypeError('move requires application/json');
                        }
                        const move = moveSessionRequest(await request.json());
                        request.signal.throwIfAborted();
                        if (typeof controller.moveSession !== 'function') {
                            status = 501;
                            throw new Error('session/move-unsupported');
                        }
                        const operation = controller.moveSession(move.sessionId, move.targetWorkspaceId);
                        pending.add(operation);
                        try {
                            await operation;
                        }
                        finally {
                            pending.delete(operation);
                        }
                        return Response.json({
                            ok: true,
                            value: { sessionId: move.sessionId, targetWorkspaceId: move.targetWorkspaceId },
                        }, { headers: { 'cache-control': 'no-store' } });
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        const declared = typeof error?.code === 'string'
                            ? error.code : '';
                        const code = /^session\/move-[a-z-]+$/u.test(declared) ? declared
                            : /^session\/move-[a-z-]+$/u.test(message) ? message
                                : error instanceof Error && error.name === 'SessionAlreadyOwnedError' ? 'session/move-busy'
                                    : error instanceof TypeError || error instanceof SyntaxError ? 'session/move-invalid'
                                        : 'session/move-failed';
                        return Response.json({ ok: false, error: { code, message, details: {} } }, { status: moveStatus(code, status), headers: { 'cache-control': 'no-store' } });
                    }
                },
            });
            return async () => { closing = true; await unregister(); await Promise.allSettled(pending); };
        }, 'session-bridge: move route');
    });
}
/**
 * HTTP status for one stable move code.
 * @param code - stable error code.
 * @param fallback - the refusal default.
 * @returns HTTP status.
 */
function moveStatus(code, fallback) {
    if (code === 'session/move-invalid')
        return 400;
    if (code === 'session/move-not-found' || code === 'session/move-target-missing')
        return 404;
    if (code === 'session/move-unsupported')
        return 501;
    return fallback;
}
