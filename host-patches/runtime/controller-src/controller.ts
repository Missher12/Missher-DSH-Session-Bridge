import { Service } from '@deepseek-ai/cordis'
import { createHandleScope, restoreIfCurrent } from './scope.ts'
import BaseSessionController from '@deepseek-ai/dsh-api-session-controller'
import { SessionLifecycleController } from './lifecycle.ts'

type Handle = { agent: { id: string, status: string }, dispose(): Promise<void> }

/**
 * Installed controller plus lifecycle. It inherits every original Remote method
 * and only captures disposal capabilities for Agents created/resumed by the
 * controller's own ApiSessionAgentController; other components keep ownership.
 */
export default class SbSessionController extends (BaseSessionController as any) {
  static inject = [...((BaseSessionController as any).inject ?? []), 'sessionPersistence']

  lifecycle: any
  lineageChains = new Map<string, Promise<void>>()

  async [Service.init]() {
    await super[Service.init]?.()
    const ctx = this.ctx
    const agents = this.agents
    const handles = new Map<string, Handle>()
    const scope = createHandleScope()
    const restores: Array<() => void> = []

    const disposeListener = ctx.on('agent/disposed', ({ agent }: { agent: { id: string } }) => {
      handles.delete(agent.id)
    })
    restores.push(() => disposeListener())

    for (const name of ['resolve', 'claim', 'createMinted'] as const) {
      const original = agents[name]
      if (typeof original !== 'function') continue
      const wrapper = (...args: any[]) => scope.run(agents, () => original.apply(agents, args))
      agents[name] = wrapper
      restores.push(() => restoreIfCurrent(agents, name, wrapper, original))
    }

    const globalCreate = ctx.agents.create
    const globalResume = ctx.agents.resume
    const capture = (original: (...args: any[]) => Promise<Handle>) => async (...args: any[]) => {
      const handle = await original.apply(ctx.agents, args)
      if (scope.owns(agents)) handles.set(handle.agent.id, handle)
      return handle
    }
    const createWrapper = capture(globalCreate)
    const resumeWrapper = capture(globalResume)
    ctx.agents.create = createWrapper
    ctx.agents.resume = resumeWrapper
    restores.push(() => {
      if (ctx.agents.create === createWrapper) ctx.agents.create = globalCreate
      if (ctx.agents.resume === resumeWrapper) ctx.agents.resume = globalResume
    })

    const adapter = {
      releaseIdle: async (sessionId: string) => {
        const agent = ctx.agents.get(sessionId)
        if (agent === undefined) return 'missing'
        if (agent.status === 'running') return 'running'
        const handle = handles.get(sessionId)
        if (handle === undefined) return 'unmanaged'
        handles.delete(sessionId)
        await handle.dispose()
        return 'released'
      },
    }
    this.lifecycle = new SessionLifecycleController(ctx, adapter)

    const baseFork = this.fork
    if (typeof baseFork === 'function') {
      const forkWrapper = (request: any) => this.inLineage(request.sessionId,
        () => scope.run(agents, () => baseFork.call(this, request)))
      this.fork = forkWrapper
      restores.push(() => { if (this.fork === forkWrapper) delete this.fork })
    }
    ctx.effect(() => () => {
      for (const restore of restores.reverse()) restore()
      handles.clear()
    }, 'sb-session-controller lifecycle handles')
  }

  inLineage<Value>(sessionId: string, operation: () => Promise<Value>): Promise<Value> {
    const result = (this.lineageChains.get(sessionId) ?? Promise.resolve()).then(operation)
    const settled = result.then(() => undefined, () => undefined)
    this.lineageChains.set(sessionId, settled)
    return result.finally(() => {
      if (this.lineageChains.get(sessionId) === settled) this.lineageChains.delete(sessionId)
    })
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.inLineage(sessionId, () => this.lifecycle.deleteSession(sessionId))
  }

  deleteArchivedSession(sessionId: string): Promise<void> {
    return this.inLineage(sessionId, () => this.lifecycle.deleteSession(sessionId, { archivedOnly: true }))
  }

  moveSession(sessionId: string, targetWorkspaceId: string): Promise<void> {
    return this.inLineage(sessionId, () => this.lifecycle.moveSession(sessionId, targetWorkspaceId))
  }
}
