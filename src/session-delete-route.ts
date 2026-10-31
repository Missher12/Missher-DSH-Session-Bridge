import type { HostContext, SessionControllerLike } from './dsh.ts'
import type { ScratchConnection } from './scratch-route.ts'
import { deletionSessionId, SESSION_DELETE_PATH } from './session-delete-wire.ts'

/** Which Host-owned permanent deletion method this composition exposes. */
type DeleteBackend = 'host-session' | 'host-archived'

/**
 * Expose only the Host's own deletion transaction; never infer private storage
 * paths. A Host without either method is reported unsupported, so the plugin
 * never deletes a JSONL file, an index row, or a workspace record itself.
 *
 * @param ctx - Host plugin context.
 */
export function registerSessionDeleteRoute(ctx: HostContext): void {
  ctx.inject(['connection', 'sessionController'], scope => {
    const connection = scope.get('connection') as ScratchConnection
    const controller = scope.get('sessionController') as SessionControllerLike
    scope.effect(() => {
      let closing = false
      const pending = new Set<Promise<void>>()
      const unregister = connection.fetch.register({
        path: SESSION_DELETE_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
        async fetch(request) {
          let status = 409
          try {
            if (closing) throw new Error('session/delete-busy')
            if (request.method === 'GET') {
              const backend = deleteBackend(controller)
              return Response.json(backend === undefined
                ? { supported: false, reason: 'session/delete-unsupported' }
                : { supported: true, backend },
              { headers: { 'cache-control': 'no-store' } })
            }
            if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
              throw new TypeError('delete requires application/json')
            }
            const sessionId = deletionSessionId(await request.json())
            request.signal.throwIfAborted()
            const backend = deleteBackend(controller)
            if (backend === undefined) {
              status = 501
              throw new Error('session/delete-unsupported')
            }
            const operation = backend === 'host-session'
              ? controller.deleteSession!(sessionId)
              : controller.deleteArchivedSession!(sessionId)
            pending.add(operation)
            try { await operation } finally { pending.delete(operation) }
            return Response.json({ ok: true, value: { sessionId } }, { headers: { 'cache-control': 'no-store' } })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const declared = typeof (error as { readonly code?: unknown })?.code === 'string'
              ? (error as { readonly code: string }).code : ''
            const code = /^session\/delete-[a-z-]+$/u.test(declared) ? declared
              : /^session\/delete-[a-z-]+$/u.test(message) ? message
              : error instanceof Error && error.name === 'SessionAlreadyOwnedError' ? 'session/delete-owned'
                : error instanceof TypeError || error instanceof SyntaxError ? 'session/delete-invalid'
                  : 'session/delete-failed'
            return Response.json({ ok: false, error: { code, message, details: {} } },
              { status: deleteStatus(code, status), headers: { 'cache-control': 'no-store' } })
          }
        },
      })
      return async () => { closing = true; await unregister(); await Promise.allSettled(pending) }
    }, 'session-bridge: delete route')
  })
}

/**
 * Read the available Host deletion method.
 * @param controller - mounted Host Session controller.
 * @returns the preferred backend, or `undefined` when absent.
 */
function deleteBackend(controller: SessionControllerLike): DeleteBackend | undefined {
  if (typeof controller.deleteSession === 'function') return 'host-session'
  if (typeof controller.deleteArchivedSession === 'function') return 'host-archived'
  return undefined
}

/**
 * HTTP status for one stable deletion code.
 * @param code - stable error code.
 * @param fallback - the refusal default.
 * @returns HTTP status.
 */
function deleteStatus(code: string, fallback: number): number {
  if (code === 'session/delete-invalid') return 400
  if (code === 'session/delete-not-found') return 404
  if (code === 'session/delete-unsupported') return 501
  return fallback
}
