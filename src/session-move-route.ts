import type { HostContext, SessionControllerLike } from './dsh.ts'
import type { ScratchConnection } from './scratch-route.ts'
import { SESSION_MOVE_PATH, moveSessionRequest } from './session-move-wire.ts'

interface SessionMovement { canMove: boolean; moveSession(id: string, targetId: string): Promise<void> }

/** Use the Host transaction or the reviewed in-package workspace adapter. */
export function registerSessionMoveRoute(ctx: HostContext, fallback: () => SessionMovement | undefined = () => undefined): void {
  ctx.inject(['connection', 'sessionController'], scope => {
    const connection = scope.get('connection') as ScratchConnection
    const controller = scope.get('sessionController') as SessionControllerLike
    scope.effect(() => {
      let closing = false
      const pending = new Set<Promise<void>>()
      const unregister = connection.fetch.register({
        path: SESSION_MOVE_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
        async fetch(request) {
          let status = 409
          try {
            if (closing) throw new Error('session/move-busy')
            if (request.method === 'GET') {
              const backend = typeof controller.moveSession === 'function' ? 'host'
                : fallback()?.canMove === true ? 'bridge-jsonl' : undefined
              return Response.json(backend !== undefined
                ? { supported: true, backend }
                : { supported: false, reason: 'session/move-unsupported' },
              { headers: { 'cache-control': 'no-store' } })
            }
            if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
              throw new TypeError('move requires application/json')
            }
            const move = moveSessionRequest(await request.json())
            request.signal.throwIfAborted()
            const backend = typeof controller.moveSession === 'function' ? controller : fallback()
            if (backend === undefined || ('canMove' in backend && !backend.canMove) || typeof backend.moveSession !== 'function') {
              status = 501
              throw new Error('session/move-unsupported')
            }
            const operation = backend.moveSession(move.sessionId, move.targetWorkspaceId)
            pending.add(operation)
            try { await operation } finally { pending.delete(operation) }
            return Response.json({
              ok: true,
              value: { sessionId: move.sessionId, targetWorkspaceId: move.targetWorkspaceId },
            }, { headers: { 'cache-control': 'no-store' } })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const declared = typeof (error as { readonly code?: unknown })?.code === 'string'
              ? (error as { readonly code: string }).code : ''
            const code = /^session\/move-[a-z-]+$/u.test(declared) ? declared
              : /^session\/move-[a-z-]+$/u.test(message) ? message
              : error instanceof Error && error.name === 'SessionAlreadyOwnedError' ? 'session/move-busy'
                : error instanceof TypeError || error instanceof SyntaxError ? 'session/move-invalid'
                  : 'session/move-failed'
            return Response.json({ ok: false, error: { code, message, details: {} } },
              { status: moveStatus(code, status), headers: { 'cache-control': 'no-store' } })
          }
        },
      })
      return async () => { closing = true; await unregister(); await Promise.allSettled(pending) }
    }, 'session-bridge: move route')
  })
}

/**
 * HTTP status for one stable move code.
 * @param code - stable error code.
 * @param fallback - the refusal default.
 * @returns HTTP status.
 */
function moveStatus(code: string, fallback: number): number {
  if (code === 'session/move-invalid') return 400
  if (code === 'session/move-not-found' || code === 'session/move-target-missing') return 404
  if (code === 'session/move-unsupported') return 501
  return fallback
}
