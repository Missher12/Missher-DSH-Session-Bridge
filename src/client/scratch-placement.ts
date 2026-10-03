/** The identity and connection state needed to refresh the fixed-directory lookup. */
export interface WorkspacePlacementSource {
  getSnapshot(): {
    readonly items: readonly { readonly workspaceId: string }[]
    readonly phase?: string
    readonly state?: string
  }
  subscribe(listener: () => void): () => void
}

/**
 * Keep the authenticated scratch identity after ordinary Workspace groups.
 * The initial read never creates a Workspace. Membership changes and reconnects
 * refresh the identity; aborted generations cannot install a stale registration.
 */
export function trackScratchPlacement(
  workspaces: WorkspacePlacementSource,
  find: (signal: AbortSignal) => Promise<string | null>,
  register: (workspaceId: string) => () => void,
): () => void {
  let generation: AbortController | undefined
  let release: (() => void) | undefined
  let registered: string | null = null
  let previous: string | undefined
  const place = (id: string | null): void => {
    if (registered === id) return
    release?.()
    release = undefined
    registered = id
    if (id !== null) release = register(id)
  }
  const refresh = (): void => {
    const snapshot = workspaces.getSnapshot()
    const ids = snapshot.items.map(item => item.workspaceId)
    const key = JSON.stringify([ids, snapshot.phase, snapshot.state])
    if (key === previous) return
    previous = key
    generation?.abort()
    const controller = new AbortController()
    generation = controller
    if (registered !== null && !ids.includes(registered)) place(null)
    void find(controller.signal).then((id) => {
      if (!controller.signal.aborted) place(id !== null && ids.includes(id) ? id : null)
    }).catch((reason: unknown) => {
      // Keep a known existing identity through a temporary connection failure.
      // The picker reports lookup failures through its normal error surface.
      if (!controller.signal.aborted) console.warn('session-bridge: scratch placement lookup failed', reason)
    })
  }
  const unsubscribe = workspaces.subscribe(refresh)
  refresh()
  return () => {
    generation?.abort()
    unsubscribe()
    place(null)
  }
}
