# Host lifecycle patch (separate delivery)

`20261031-session-lifecycle.patch` is a minimal DeepSeek Harness source patch for
the two lifecycle operations Session Bridge 0.1.6 exposes only when the Host
provides them:

- `sessionController.deleteSession(sessionId)` (plus the legacy
  `deleteArchivedSession`) — permanent Session deletion under a writer lease,
  with a durable deletion tombstone, an authoritative child-Session check, and a
  lineage lock shared with child creation.
- `sessionController.moveSession(sessionId, targetWorkspaceId)` — moves the
  original Session (id, title, complete event history kept) by journalling the
  intent, committing the effective `working-directory/change` event and the
  Workspace membership/override together, and recovering forward on restart.

It also releases an idle Agent handle the Host itself created before taking the
writer lease, so a used-but-idle Session can be deleted or moved without a
process restart. Running Sessions are still refused.

Base revision: `dsh-v0.2.1-rc.4`
(`504a01a9578abc2c6f1fb896b1dc322c9fe24f66`,
`https://github.com/deepseek-ai/deepseek-harness`).

Apply:

```sh
git clone --depth 1 --branch dsh-v0.2.1-rc.4 https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git apply /path/to/host-patches/20261031-session-lifecycle.patch
```

The patch is **not** part of the plugin tgz. On 2026-10-31 the profile-level
runtime packages in [`runtime/`](runtime/) were installed into the daily desktop
profile as a service-row replacement; see that README for the exact paths and
verification. `app.asar` and native components were not modified. The plugin reports `supported:false` and returns HTTP 501 until a Host
carrying these methods is built and installed. Verification status and the
remaining runtime gaps are recorded in
[`docs/compatibility/host-lifecycle-patch-20261031.md`](../docs/compatibility/host-lifecycle-patch-20261031.md).

Verified here with the installed Electron runtime (`ELECTRON_RUN_AS_NODE=1`) and a
read-only symlink to the installed native `system.node` — no copied, re-signed or
reinstalled native component: `tsc -b` passes and the four targeted suites pass
(94 tests), including real JSONL delete/move and a used-but-idle Agent through
the real AgentLoop. Full Host build, packaged-app acceptance and cross-process
fork/delete concurrency remain unverified.
