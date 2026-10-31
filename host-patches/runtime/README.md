# Host lifecycle runtime packages (profile-level install)

These packages are the runtime half of
[`20261031-session-lifecycle.patch`](../20261031-session-lifecycle.patch). They are
installed into the **profile**, not into `app.asar`, and are separate from the
Session Bridge plugin tarball.

## Built artifact SHA-256

- `jsonl/lib/index.js`: `fee1c5f900dd850a5d01ae29df19713d13ecb21e20f7089d0a95f63d789add96`
- `workspace/lib/index.js`: `483c72ffce4d241c23cb890e3f50efa1115c94a7cd4cea503e4269384edd4c37`
- `lifecycle/lib/index.js`: `65c6bbeaa8949a37ee58d05b666ddb1d8363ebad0d9ac8fadc43d2283b4a9a67`
- `controller/lib/index.js` (legacy, not loaded): `8ecb19c5d3b7ddf6642db540c2af777299d4425f71a55edbc0c82f561f26f3ce`

The copies installed under `host-patches/runtime/` match
`~/.dsh/plugin-packages/sb-host-runtime/` when the profile fix is applied.

## Final client-safe composition

- `@missher/sb-host-session-persistence-jsonl` — replaces the official
  persistence row.
- `@missher/sb-host-workspace` — replaces the official workspace row.
- `@missher/sb-host-session-lifecycle` — a **host-only decorator** loaded after
  the official `session-controller` row. It adds delete/move to the official
  controller instance and does **not** replace the controller package.

Keeping the official `session-controller` row is required: its package declares
`dsh.client` and its `lib/client.js` registers `ClientSessions` / provides the
browser `sessions` service. Disabling that row leaves the Web UI in a pending
state even though the host HTTP capability exists. This was the backend-only
installation bug; the client-safe fix is in
[`profile-snippet.yml`](profile-snippet.yml) and
[`apply-profile-fix.sh`](apply-profile-fix.sh).

The controller replacement package under `controller/` is retained for
history/rollback only. It is not loaded by the final profile.

## Install on the daily profile

The prepared script copies the decorator into
`~/.dsh/plugin-packages/sb-host-runtime/lifecycle`, adds the profile dependency,
and edits only two SB fragments in the live `cordis.patch.yml`. It validates
that each fragment occurs exactly once and stops before any change otherwise; it
never replaces the full user profile and creates no full profile snapshot.

```sh
./host-patches/runtime/apply-profile-fix.sh
```

Then restart the desktop Host. `app.asar`, the Electron binary, signing, and the
installed native `system.node` are untouched. A complete Host rebuild/repackage
was **not** done.

## Verification

Isolated profile with official controller + decorator:

- `window.__DSH_BOOT__` contains `@deepseek-ai/dsh-api-session-controller` with
  22 dependent entries; `__ModuleLoader__.pendingQueue.length === 0`;
- the real Web UI renders (workspaces/sidebar/new-chat); the isolated profile has
  no account, so the login/model prompt is expected;
- `session/events`, `session/page` without `throughSeq`, `session/state`,
  `session/wait` → 200;
- bridge delete/move → `supported:true`; idle delete and fork-child move/delete
  200; real running turn delete/move 409.

Daily Host (before this client fix) already passed backend HTTP/storage checks:
ordinary and archived deletion, unconfirmed 400, real running 409, move to
Crodis with real bash pwd, all 70 pre-existing sessions preserved. Codex applied
the client-safe profile after the Host was idle and stopped, then restarted it.
The actual Electron main UI and session list load, and the model picker opens
and closes without changing the selection. Plugin 0.1.8 is now installed; its
native delete confirmation/cancel and removal of the move menu are verified.
After two unsuccessful automated drag attempts, the user confirmed a successful
manual native drag into Crodis. Codex independently verified the same session ID
and title, the unchanged history prefix, and the target working directory via
RPC, then deleted the disposable session through the authenticated plugin route.
All 70 pre-existing session IDs remain. Native drag success is user-reported;
the final native delete button was not clicked.
The 0.1.8 cleanup only removes unused pre-drag UI remnants; the Host runtime
and drag/move/delete behavior are unchanged, and the native UI loads after restart.
