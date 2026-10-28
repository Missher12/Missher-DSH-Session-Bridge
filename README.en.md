# Session Bridge

[中文](README.md) | English · [Desktop and downloads](https://github.com/Missher12/Missher-DeepseekHarness-Desktop) · [All plugins](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/blob/main/plugins/README.md)

Display and copy complete session IDs, list/read/message other sessions, and create scratch workspaces in DeepSeek Harness.

- Package: `@missher/dsh-session-bridge`; version: **0.1.5** (explicit deletion capability feedback).
- Session identity lives in the left sidebar session menu; the header no longer shows an extra ID control.
- The sidebar menu also copies the full ID, the working directory and the session reference, and archived rows carry a confirmed delete entry.
- An independently removable Cordis Bundle; no companion compatibility package is required. This is not an official DeepSeek product.
- [License](LICENSE) · [Upstream attribution](THIRD_PARTY_NOTICES.md) · [Compatibility record](COMPATIBILITY.json)

## Install and update

Select 0.1.5 on the [Releases page](https://github.com/Missher12/Missher-DSH-Session-Bridge/releases) and download `missher-dsh-session-bridge-0.1.5.tgz` and `SHA256SUMS`. That page determines which versions and assets are available. The package includes compiled files; GitHub’s automatic source archive is not the plugin installer.

In the download directory, verify with `shasum -a 256 -c SHA256SUMS` on macOS or `sha256sum -c SHA256SUMS` on Linux. The package includes compiled `lib` files and has no install scripts; users do not need a build environment.

**Desktop:** open **Plugins → Add plugin** and select the local tarball or use the pinned URL below. Confirm the version and enabled `session-bridge` component. Reload as requested by the Host, or fully quit and reopen if required. Desktop owns its reserved `desktop` profile; use the application's plugin manager.

The published URL follows the tag on the Release page:
`https://github.com/Missher12/Missher-DSH-Session-Bridge/releases/download/<tag>/missher-dsh-session-bridge-0.1.5.tgz`.
Until that asset exists, install from a local tarball's absolute path.

**Web users with DSH CLI already installed:** install into your Web profile. This command does not modify Desktop's profile.

```sh
dsh plugin --profile web add /absolute/path/to/missher-dsh-session-bridge-0.1.5.tgz
```

Use separate `DSH_HOME` / `DSH_AGENTS_HOME` directories for initial testing. Do not enable the old `dsh-session-bridge`, the `session-bridge-dev` alias and the scoped package together: they register the same tools, including `session_list`. Keep the previous package/configuration and let active work finish before reloading an upgrade.

## Use

### Session identity and menus

Open the target session's three-dot menu in the left sidebar and choose “Copy session ID”. The copied value keeps the complete `session-` prefix. The same menu copies the working directory or `/bridge <session-id> ` reference. The header no longer renders a duplicate ID control or its detail panel.

Actions use the selected row, including archived rows, without switching the current session. Missing directory information and clipboard failures produce feedback. Archived rows always show “Delete session…”. Supported Hosts require confirmation; unsupported Hosts show a disabled entry and the reason. Checking, failed checks and unsupported capability are distinct states. Reopen the menu to check again. A POST 501 also shows an explicit error and blocks repeat confirmation.

### “Not in a workspace” and scratch

The new-session workspace picker ends with a scratch entry. Selecting it reuses a registered **`dsh-scratch` workspace**, with the default title “Not in a workspace.” On macOS the default canonical path is `/private/tmp/dsh-scratch`. It is still a **genuinely registered workspace** that simply carries that name — not a session without one, because the Host's blank-session input flow requires a workspace.

![The scratch entry at the end of the new-session workspace picker](docs/images/scratch-workspace-alpha2.png)

Opening the picker alone creates no directory or session. Repeated selection reuses the canonical path and workspace ID, preserves user renaming and does not merge unrelated workspaces with matching titles. A symlink, a directory owned by another user, or one writable by the group/others is rejected for the fixed scratch location.

The `session_scratch` tool and `/scratch` command instead create a separate temporary directory for every call. This differs from the UI's reusable `dsh-scratch` workspace. Operating-system cleanup may remove temporary files; do not keep the only copy of important work there.

### Tools and commands

| Model tool | Behavior |
| --- | --- |
| `session_list` | Lists IDs, titles, directories and running state; excludes subagent sessions by default. |
| `session_read` | Reads recent user/assistant text, excluding reasoning and tool results; does not wake the target. |
| `session_send` | Sends a real user-role message: `steer` delivers at a step boundary or starts an idle turn; `turn` queues a separate turn. |
| `session_scratch` | `session` creates a session in a new scratch directory; `directory` creates no session but still registers a workspace by default; disable registration with `registerScratchWorkspace: false`. |

Targets accept an exact ID, case-insensitive exact title or unique ID prefix. Ambiguous references are rejected.

| Human command | Behavior |
| --- | --- |
| `/sessions [filter]` | Lists session IDs and titles. |
| `/bridge <ID or title> <message>` | Sends to the target; titles with spaces use the longest uniquely resolvable prefix. |
| `/scratch [label]` | Creates a temporary-directory session. |
| `/scratch-clean` | Previews eligible disposable scratch projects. |
| `/scratch-clean yes` | Unregisters eligible projects and deletes their directories. |

Cleanup selects registered workspaces under the canonical `scratchRoot` whose directory names start with `dsh-` and have no nonblank sessions, always excluding the fixed `dsh-scratch` workspace. It does not check a plugin-created marker or the current `scratchPrefix`: other matching `dsh-*` workspaces can qualify, while custom prefixes not starting with `dsh-` do not. Files saved in selected directories are also deleted. Review the preview and preserve anything you need first.

## Host and platform boundaries

0.1.5 inspects exact official npm **DSH 0.2.1-rc.4** contracts and implementations. There is no public permanent-delete operation coordinating writer ownership, concurrent forks and log/index consistency, so the plugin explains the limitation and leaves private storage untouched. Official `workspaces.insertBefore` changes persistent order; it is not a disposable sidebar placement hook. The sidebar therefore retains Host ordering and manual dragging, while the plugin’s scratch picker entry stays last. See the [API and risk report](docs/compatibility/official-rc4-0.1.5.md) and `COMPATIBILITY.json` for current evidence. Static API inspection does not establish official Host installation or native Electron acceptance.

0.1.5 passes client types, Host/client builds, module loading, all 61 offline tests and real React/JSDOM interactions. Actual browser clicks over synthetic responses cover unsupported capability, failed checks, POST 501, cancellation and synthetic success. No full official rc.4 Host or Electron was run. The browser tool’s virtual clipboard could not round-trip the copied value; exact copied bytes were verified only in component tests.

After removing the header ID in 0.1.4, Host/client typechecks, the isolated build, module loading and all 59 offline tests pass (0 failures, 0 skips). Sidebar copying of the complete ID, directory and bridge reference remains covered. The 0.1.3 records below remain historical baselines.

2026-10-17 increment: the **unchanged released 0.1.3 tarball** passed bounded Loader, session list/read, scratch reuse, missing-capability and unload checks against official npm DSH **0.2.1-alpha.5**. No runtime file was changed or repackaged. This official Host lacks `deleteArchivedSession` and `registerTrailingWorkspace`: archive deletion is unavailable and scratch keeps normal Host ordering.

No alpha.5 browser or native Electron UI was tested in this increment; the earlier community-Host screenshots are not official-Host UI evidence. See the [official alpha.5 acceptance record](https://github.com/Missher12/Missher-DSH-Session-Bridge/blob/main/docs/compatibility/official-alpha5-20261017.md) for evidence layers and limits.

There is no hard Host version gate: admission is capability-based, not version-based. The rc.2 development SDK pin is a development link only, not a compatibility gate.

The following records describe 0.1.3; they do not constitute 0.1.5 acceptance. On 2026-10-14, Linux x64 / Node 22.22.1, two actual **Missher community distributions** were exercised (both modified for this desktop product; neither is an unmodified official build):

| | DSH 0.2.0-rc.2 / Cordis 4.0.4 | DSH 0.2.1-alpha.2 / Cordis 4.0.5-alpha.1 (desktop 0.2.1-alpha.2.20261014.1) |
| --- | --- | --- |
| Real Cordis Loader, client boot graph, HTTP | passed | passed |
| Bridge activations / failed enabled components | 1 / 0 | 1 / 0 |
| Actual UI at 1280 and 600px (sidebar expanded) | passed | passed |
| One-line complete ID, full-id copy, Home/End, detail panel and Escape, natural width restored after growing the window | passed | passed |
| Console errors / model requests / external fetches | 0 / 0 / 0 | 0 / 0 / 0 |

| Capability | Without the extension | With the relevant public extension |
| --- | --- | --- |
| ID display and copying, cross-session tools, scratch and the picker entry | Provided by the plugin | Provided by the plugin |
| Place the scratch group last in the sidebar | Normal ordering | Uses `uiWorkspace.registerTrailingWorkspace`; persisted order is unchanged |
| Permanently delete archived history | The disabled entry explains why; the request answers POST 501 without reading private storage | Archived row → Delete session → confirmation; chat history only, workspace files preserved |
| Dedicated archive icon in the workspace toolbar | Belongs to the Host, not supplied in this plugin package | Same |

Deletion cannot be undone. To preserve history, normally quit every process using that data directory and back up the complete profile plus its configured persistence storage. Restore the same complete snapshot while all such processes are stopped; restoring one log alone is insufficient.

Deletion depends on the optional `sessionController.deleteArchivedSession`. When it is missing the plugin does not invent a private deletion path and does not read private Host logs. The Host enforces the guards for running sessions, other writers and derived child sessions.

See `COMPATIBILITY.json` for the evidence layers. Version 0.1.3 builds in isolation on Linux and its 59 offline tests pass (0 failed, 0 skipped, worker 1); 12 of those are React and JSDOM chip/panel checks over controlled geometry, which are behavioural checks rather than pixel or browser layout evidence. `check-host-contracts` passes against the shared Host **source SDK declarations**; the inspected community packages lacked the corresponding declarations; official rc.4 npm packages now include them. Style ownership and peer reload/self reload/unload pass on the installed alpha.2 module system with the real Cordis Loader; the historical "unowned style gets claimed" negative control does not reproduce on this newer Host (owner is null), so that older failure description does not apply. Archive-delete confirm/cancel/delete are real rc.2 clicks over synthetic records: workspace files and other sessions are preserved, and the deletion survives a restart. Native Electron clicks, real-model calls, other official versions and other platforms are not accepted.

Archived-row confirmation on Missher community DSH 0.2.0-rc.2, synthetic records only:

![The delete confirmation for an archived session, stating that workspace files are kept](docs/images/archive-confirm-rc2.png)

The retained scratch and archive-confirmation images are historical 0.1.3 evidence from synthetic sessions in isolated directories, not native Electron. Version 0.1.4 removes the header ID, so the old header screenshots no longer represent the current UI.

## Configuration

All fields are optional. The Bundle already inserts the official component: do not add a second instance. To override settings, update the existing ID in the target profile patch:

```yaml
- id: session-bridge
  config:
    scratchRoot: /tmp
    scratchPrefix: dsh-session-
```

| Field | Default | Meaning |
| --- | --- | --- |
| `scratchRoot` | POSIX `/tmp`; system temporary directory on Windows | Parent directory for scratch work. |
| `scratchPrefix` | `dsh-session-` | Disposable-directory prefix. |
| `registerScratchWorkspace` | `true` | Register tool-created scratch directories as workspaces in both `session` and `directory` modes. |
| `maxListedSessions` | `40` | Maximum rows per list request. |
| `maxTranscriptTurns` | `20` | Maximum recent transcript turns. |
| `maxMessageChars` | `8000` | Maximum characters per cross-session message. |
| `wakeColdSessions` | `true` | Allow cold targets to be resumed through the Host session flow. |
| `announceSessionId` | `true` | Add the current ID and bridge tools to the system prompt. |

## Disable, uninstall and preserve data

Switch off the Bundle in Desktop or Web plugin management and reload as requested. Switch it back on to enable it. Disabling removes this plugin's tools, commands, styles and UI entries, and restores ordinary Host sidebar ordering.

Uninstall through the same manager. Web CLI users may also run:

```sh
dsh plugin --profile web remove @missher/dsh-session-bridge
```

Disabling or uninstalling does not delete existing chat history, delivered messages, workspaces or scratch files, and does not undo already-started target-session work. Separately saved Host configuration overrides can be removed manually when no longer needed. Roll back by installing the retained old tarball through the same entry point; replacing the entire session store is unnecessary.

## Privacy and permissions

The plugin has no independent telemetry or external upload service; UI requests use the Host's authenticated HTTP interface. It can read session directories and user/assistant text through Host services and send real messages to other sessions. When a target model processes a message, its existing provider, permission and billing settings apply. Confirm the target and send only content it is authorized to receive.

The envelope identifies the sender and marks the content as a peer request. There is no additional human-approval queue or permission-isolation layer. This is not a chat backup, account synchronization or cross-Host transport. Reports should include versions, reproduction steps and redacted errors, never session stores, API keys or cookies.

## Develop independently

This repository is the sole maintenance source. Use Node `>=22.19`, pnpm `11.1.3` as declared in `packageManager`, and an already-built rc.2 Harness SDK:

```sh
node scripts/link-harness.mjs /absolute/path/to/built-harness
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
node --test --test-concurrency=1 "tests/*.test.mjs"
pnpm pack --pack-destination ./dist
node scripts/check-package-boundary.mjs ./dist/missher-dsh-session-bridge-0.1.5.tgz
```

The SDK link is for development only and is neither committed nor packaged. The tarball contains compiled runtime files, corresponding source, licenses and user documentation; development scripts and historical local receipts remain in Git. The Node entry uses structural `ctx` services without runtime imports from `@deepseek-ai/dsh-*`. The client keeps three existing Host static requests: `react`, `react/jsx-runtime` and `@deepseek-ai/dsh-client-ui-primitives`. No runtime dependencies were added.

`build` includes strict client type checking and module-load checks. Watch mode only transpiles and cannot substitute for acceptance testing. Editing a checkout does not update another installed app.asar: verify the actual package loaded by the target application. Disabled desktop HMR or cached metadata may require a restart.
