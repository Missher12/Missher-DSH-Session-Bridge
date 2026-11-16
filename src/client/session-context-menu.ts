/** Native context-menu contributions on Hosts that no longer use legacy row cells. */
import { IconFolderCloseRegular, IconLinkOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContextLike } from './index.js'
import type { createSessionCopyActions } from './session-menu.js'
import { readSessionDeleteCapability } from './session-delete.js'
import type { createSessionDeleteActions, SessionDeleteCapability } from './session-delete.js'
import { NS } from './locales.js'

interface Source {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}
interface Action {
  id: string
  label: string
  icon: { key: string }
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  afterContent?: boolean
  run(): void | Promise<void>
}
/** Structural public service contract; no extra Host runtime dependency. */
export interface SessionContextMenus {
  register(contribution: {
    id: string; target: 'session'; order: number
    observe?(): readonly Source[]
    resolve(target: { sessionId: string }): readonly Action[]
  }): () => void
}

/** A synchronous menu remains visible while its cancellable capability query settles. */
function deletionCapability() {
  const listeners = new Set<() => void>()
  let status: SessionDeleteCapability | 'checking' = 'checking'
  let controller: AbortController | undefined
  return {
    getSnapshot: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) {
        status = 'checking'
        const request = controller = new AbortController()
        const timer = setTimeout(() => { publish('error'); request.abort() }, 10_000)
        const publish = (value: SessionDeleteCapability): void => {
          if (request.signal.aborted) return
          status = value
          for (const notify of listeners) notify()
        }
        void readSessionDeleteCapability(request.signal).then(publish, () => { publish('error') })
          .finally(() => { clearTimeout(timer) })
        request.signal.addEventListener('abort', () => { clearTimeout(timer) }, { once: true })
      }
      return () => { listeners.delete(listener); if (listeners.size === 0) controller?.abort() }
    },
  }
}

/** Return false only when the older Host needs the legacy row extension. */
export function registerSessionContextMenu(
  ctx: ClientContextLike,
  copy: ReturnType<typeof createSessionCopyActions>,
  deletion: ReturnType<typeof createSessionDeleteActions>,
): boolean {
  const menus = ctx.get?.('contextMenus')
  if (typeof menus?.register !== 'function' || typeof ctx.locale.bind !== 'function') return false
  const t = ctx.locale.bind(NS)
  const capability = deletionCapability()
  const observed: Source[] = [capability]
  if (ctx.sessions.list.subscribe) observed.push({
    getSnapshot: () => ctx.sessions.list.getSnapshot(),
    subscribe: ctx.sessions.list.subscribe.bind(ctx.sessions.list),
  })
  const localeSources: Source[] = ctx.locale.subscribe ? [{
    getSnapshot: () => undefined, subscribe: ctx.locale.subscribe.bind(ctx.locale),
  }] : []
  ctx.slots.inject('contextMenu.icon', () => {
    for (const [key, Icon] of Object.entries({
      'sessionBridge.cwd': IconFolderCloseRegular,
      'sessionBridge.bridge': IconLinkOutlineRegular,
      'sessionBridge.delete': IconTrashOutlineRegular,
    })) ctx.slots.register({ name: 'contextMenu.icon', key }, Icon)
  })
  ctx.effect(() => menus.register({
    id: 'sessionBridge.copy', target: 'session', order: 510,
    observe: () => localeSources,
    resolve: ({ sessionId }) => [
      { id: 'cwd', label: t('menu.copyCwd'), icon: { key: 'sessionBridge.cwd' }, run: () => copy.copy('cwd', sessionId) },
      { id: 'bridge', label: t('menu.copyBridge'), icon: { key: 'sessionBridge.bridge' }, run: () => copy.copy('bridge', sessionId) },
    ],
  }), 'session-bridge: native copy menu')
  ctx.effect(() => menus.register({
    id: 'sessionBridge.delete', target: 'session', order: 700,
    observe: () => [...observed, ...localeSources],
    resolve: ({ sessionId }) => {
      const status = capability.getSnapshot()
      const running = ctx.sessions.list.getSnapshot().byId[sessionId]?.running === true
      const disabled = running || status !== 'supported'
      const key = running ? 'delete.runningAction' : status === 'checking' ? 'delete.checkingAction'
        : status === 'unsupported' ? 'delete.unavailableAction' : status === 'error' ? 'delete.failedAction' : 'delete.action'
      return [{ id: 'delete', label: t(key), icon: { key: 'sessionBridge.delete' },
        danger: true, separatorBefore: true, afterContent: true, disabled,
        run: () => { if (!disabled) deletion.request(sessionId) },
      }]
    },
  }), 'session-bridge: native delete menu')
  return true
}
