import { createHandleScope, restoreIfCurrent } from './scope.ts'
import { SessionLifecycleController } from './lifecycle.ts'

interface Handle { agent: { id: string, status: string }, dispose(): Promise<void> }

/**
 * Add lifecycle methods to the installed SessionController instance without
 * replacing its package row. The official package keeps its own client module
 * (`sessions` service) and every installed Remote method.
 */
export const name = 'sb-host-session-lifecycle'
export const inject = ['sessionController', 'sessionPersistence', 'workspaceRegistry', 'agents', 'sessions', 'sessionQuery']

export function apply(ctx: any): void {
  const controller = ctx.reflect.get('sessionController')
  const agentController = controller.agents
  const registry = ctx.reflect.get('agents')
  const handles = new Map<string, Handle>()
  const scope = createHandleScope()
  const restores: Array<() => void> = []
  const lineageChains = new Map<string, Promise<void>>()

  const inLineage = <Value>(sessionId: string, operation: () => Promise<Value>): Promise<Value> => {
    const result = (lineageChains.get(sessionId) ?? Promise.resolve()).then(operation)
    const settled = result.then(() => undefined, () => undefined)
    lineageChains.set(sessionId, settled)
    return result.finally(() => {
      if (lineageChains.get(sessionId) === settled) lineageChains.delete(sessionId)
    })
  }

  const disposeListener = ctx.on('agent/disposed', ({ agent }: { agent: { id: string } }) => {
    handles.delete(agent.id)
  })
  restores.push(() => disposeListener())

  for (const method of ['resolve', 'claim', 'createMinted'] as const) {
    const original = agentController[method]
    if (typeof original !== 'function') continue
    const wrapper = (...args: any[]) => scope.run(agentController, () => original.apply(agentController, args))
    agentController[method] = wrapper
    restores.push(() => restoreIfCurrent(agentController, method, wrapper, original))
  }

  const globalCreate = registry.create
  const globalResume = registry.resume
  const capture = (original: (...args: any[]) => Promise<Handle>) => async (...args: any[]) => {
    const handle = await original.apply(registry, args)
    if (scope.owns(agentController)) handles.set(handle.agent.id, handle)
    return handle
  }
  const createWrapper = capture(globalCreate)
  const resumeWrapper = capture(globalResume)
  registry.create = createWrapper
  registry.resume = resumeWrapper
  restores.push(() => {
    if (registry.create === createWrapper) registry.create = globalCreate
    if (registry.resume === resumeWrapper) registry.resume = globalResume
  })

  const adapter = {
    releaseIdle: async (sessionId: string) => {
      const agent = registry.get(sessionId)
      if (agent === undefined) return 'missing'
      if (agent.status === 'running') return 'running'
      const handle = handles.get(sessionId)
      if (handle === undefined) return 'unmanaged'
      handles.delete(sessionId)
      await handle.dispose()
      return 'released'
    },
  }
  const lifecycle = new SessionLifecycleController(ctx, adapter)

  const originalFork = controller.fork
  const forkWrapper = (request: any) => inLineage(request.sessionId,
    () => scope.run(agentController, () => originalFork.call(controller, request)))
  controller.fork = forkWrapper
  restores.push(() => { if (controller.fork === forkWrapper) controller.fork = originalFork })

  const deleteSession = (sessionId: string) => inLineage(sessionId, () => lifecycle.deleteSession(sessionId))
  const deleteArchivedSession = (sessionId: string) => inLineage(sessionId, () => lifecycle.deleteSession(sessionId, { archivedOnly: true }))
  const moveSession = (sessionId: string, targetWorkspaceId: string) =>
    inLineage(sessionId, () => lifecycle.moveSession(sessionId, targetWorkspaceId))
  controller.deleteSession = deleteSession
  controller.deleteArchivedSession = deleteArchivedSession
  controller.moveSession = moveSession
  restores.push(() => {
    if (controller.deleteSession === deleteSession) delete controller.deleteSession
    if (controller.deleteArchivedSession === deleteArchivedSession) delete controller.deleteArchivedSession
    if (controller.moveSession === moveSession) delete controller.moveSession
  })

  ctx.effect(() => () => {
    for (const restore of restores.reverse()) restore()
    handles.clear()
  }, 'sb-host-session-lifecycle')
  console.log('SB_HOST_LIFECYCLE_DECORATED', {
    deleteSession: typeof controller.deleteSession,
    moveSession: typeof controller.moveSession,
  })
}
