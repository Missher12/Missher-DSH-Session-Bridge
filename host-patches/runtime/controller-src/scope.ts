import { AsyncLocalStorage } from 'node:async_hooks'

export interface ScopeToken {
  readonly owner: object
  active: boolean
}

/**
 * One token per synchronous/asynchronous call. Background work that inherits
 * the context after the call settles sees active=false, so it cannot capture a
 * handle under a later caller's identity.
 */
export function createHandleScope() {
  const storage = new AsyncLocalStorage<ScopeToken>()
  return {
    async run<T>(owner: object, operation: () => Promise<T>): Promise<T> {
      const token: ScopeToken = { owner, active: true }
      try {
        return await storage.run(token, operation)
      } finally {
        token.active = false
      }
    },
    owns(owner: object): boolean {
      const token = storage.getStore()
      return token?.active === true && token.owner === owner
    },
  }
}

/** Restore a replaced method only while it is still the wrapper we installed. */
export function restoreIfCurrent(
  target: Record<string, unknown>, key: string, installed: unknown, previous: unknown,
): void {
  if (target[key] === installed) target[key] = previous
}
