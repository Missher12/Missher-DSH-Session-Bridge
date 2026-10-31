// ../../../../../../private/tmp/sb-runtime/scope.ts
import { AsyncLocalStorage } from "node:async_hooks";
function createHandleScope() {
  const storage = new AsyncLocalStorage();
  return {
    async run(owner, operation) {
      const token = { owner, active: true };
      try {
        return await storage.run(token, operation);
      } finally {
        token.active = false;
      }
    },
    owns(owner) {
      const token = storage.getStore();
      return token?.active === true && token.owner === owner;
    }
  };
}
function restoreIfCurrent(target, key, installed, previous) {
  if (target[key] === installed) target[key] = previous;
}
export {
  createHandleScope,
  restoreIfCurrent
};
