# Rebuilding the runtime packages

Inputs are the patched host source tree used for
`20261031-session-lifecycle.patch` plus `esbuild` and `tsdown` from that tree.
The committed built artifacts are self-contained; this note records the build
shape.

## Host lifecycle decorator (final client-safe path)

The official `@deepseek-ai/dsh-api-session-controller` row stays enabled so its
`dsh.client` module keeps registering the browser `sessions` service. Build the
host-only decorator from the saved source:

```sh
esbuild lifecycle-src/plugin.ts \
  --bundle --format=esm --platform=node --packages=external \
  --external:@deepseek-ai/* \
  --outfile=lifecycle/lib/index.js
```

`plugin.ts` imports `./scope.ts` and `./lifecycle.ts` (both saved next to it).
The patched seam adds `SessionPersistenceChildExistsError` and
`SessionPersistenceDeleteUnsupportedError`, which the installation seam does not
export yet. For the runtime bundle only, remove those two names from the emitted
import and prepend local classes with the same `name`; `lifecycle.ts` matches
them by name as well as `instanceof`.

The decorator attaches delete/move to the official controller instance, scopes
handle capture to that controller's own calls, serialises fork/delete/move on a
lineage chain, and restores exactly the wrappers it installed.

## Persistence and Workspace

Bundle the patched sources with the same esbuild command:

- `packages/session/session-persistence-jsonl/src/index.ts` (export the module's
  `JsonlSessionPersistence` class temporarily for the bundle, then revert the
  source export);
- `packages/workspace/workspace/src/index.ts`.

These are the only two host rows replaced by the profile layer. The older
`controller/` replacement package is retained for history/rollback only; the
client-safe profile does not load it.

No absolute build path is used at runtime.
