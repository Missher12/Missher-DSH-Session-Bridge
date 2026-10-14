# Session Bridge

Current Git delivery: **0.1.3-local.7**. Source and frozen runtime match; see [validation and installation limits](./PUBLICATION.md). Git sync does not update installed devices.


[中文](README.md) | English · [Desktop and downloads](https://github.com/Missher12/Missher-DeepseekHarness-Desktop) · [All plugins](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/blob/main/plugins/README.md)

Display and copy complete session IDs, list/read/message other sessions, and create scratch workspaces in DeepSeek Harness.

- Package: `@missher/dsh-session-bridge`; version: **0.1.3-local.7**.
- This release removes the conversation-header identity control. Copy the full ID, working directory and session reference from the sidebar menu.
- An independently removable Cordis Bundle; no companion compatibility package is required. This is not an official DeepSeek product.
- [License](LICENSE) · [Upstream attribution](THIRD_PARTY_NOTICES.md) · [Compatibility record](COMPATIBILITY.json)

## Installation and updates

Choose the plugin `.tgz` and `SHA256SUMS` from the [latest formal Release](https://github.com/Missher12/Missher-DSH-Session-Bridge/releases/latest). The current package is `missher-dsh-session-bridge-0.1.3-local.7.tgz`; the pinned URLs below reproduce this delivery. Use Latest for future updates. GitHub's automatic source archive is not the plugin tarball.

In the download directory, verify with `shasum -a 256 -c SHA256SUMS` on macOS or `sha256sum -c SHA256SUMS` on Linux. The package includes compiled `lib` files and has no install scripts; users do not need a build environment.

**Desktop:** open **Plugins → Add plugin** and select the local tarball or use the pinned URL below. Confirm the version and enabled `session-bridge` component. Reload as requested by the Host, or fully quit and reopen if required. Desktop owns its reserved `desktop` profile; use the application's plugin manager.

```text
https://github.com/Missher12/Missher-DSH-Session-Bridge/releases/download/v0.1.3-local.7/missher-dsh-session-bridge-0.1.3-local.7.tgz
```

**Web users with DSH CLI already installed:** install into your Web profile. This command does not modify Desktop's profile.

```sh
dsh plugin --profile web add https://github.com/Missher12/Missher-DSH-Session-Bridge/releases/download/v0.1.3-local.7/missher-dsh-session-bridge-0.1.3-local.7.tgz
```

A local tarball's absolute path can replace the URL. Use separate `DSH_HOME` / `DSH_AGENTS_HOME` directories for initial testing. Do not enable the old `dsh-session-bridge`, the `session-bridge-dev` alias and the scoped package together: they register the same tools, including `session_list`. Keep the previous package/configuration and let active work finish before reloading an upgrade.

## Use

### Session identity and menus

Use the sidebar session menu to copy the complete session ID, working directory or `/bridge <session-id> ` reference, including from archived rows. Actions use the selected row without switching the current session. Missing directory information and clipboard failures produce feedback. The conversation header no longer contains the session identity control.

### “Not in a workspace” and scratch

The new-session workspace picker ends with a scratch entry. Selecting it reuses a registered **`dsh-scratch` workspace**, with the default title “Not in a workspace.” On macOS the default canonical path is `/private/tmp/dsh-scratch`. It is still a registered workspace: the Host's blank-session input flow requires one.

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

Maintenance targets a reasonable DSH version range and continued adaptation to the latest release. Features depend on Host services and slots; there is no hard version gate. The rc.2 development SDK is a reproducible build baseline, not the only intended compatible version. The table describes inspected capability differences, without claiming untested versions have passed.

| Capability | Official DSH 0.2.0-rc.2 | Missher Desktop with the relevant public extension |
| --- | --- | --- |
| IDs/copying, cross-session tools, scratch and the picker entry | Provided by the plugin; historical isolated loading passed | Provided by the plugin |
| Place the scratch group last in the sidebar | Normal ordering without the extension | Uses `uiWorkspace.registerTrailingWorkspace`; persisted order is unchanged |
| Permanently delete archived history | No `sessionController.deleteArchivedSession`; the plugin hides the action | Archived row → Delete session → confirmation; workspace files are preserved |
| Dedicated archive icon in the workspace toolbar | Archive filtering is under view options | A Host enhancement, not supplied in this plugin package |

The Host enforces deletion guards for running sessions, other writers and derived child sessions. The plugin calls the public operation; it does not infer or edit private Host logs. Updating the plugin alone cannot add missing Host extensions.

See `COMPATIBILITY.json` for evidence layers. The macOS x64 custom rc.2 checks for local.5 are historical, including browser copying and archived deletion. This release uses an isolated Linux build to verify removal of the header registration and retention of sidebar copying. It is installed and active on the companion Ubuntu Desktop `0.2.1-alpha.2.20261014.1`, with installed files matching the public package. Declaration and runtime sources are recorded separately. Offline checks do not replace native Electron clicks, real-model calls or full cross-platform acceptance.

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
node scripts/check-package-boundary.mjs ./dist/missher-dsh-session-bridge-0.1.3-local.7.tgz
```

The SDK link is for development only and is neither committed nor packaged. The tarball contains compiled runtime files, corresponding source, licenses and user documentation; development scripts and historical local receipts remain in Git. The Node entry uses structural `ctx` services without runtime imports from `@deepseek-ai/dsh-*`. The client keeps three existing Host static requests: `react`, `react/jsx-runtime` and `@deepseek-ai/dsh-client-ui-primitives`. No runtime dependencies were added.

`build` includes strict client type checking and module-load checks. Watch mode only transpiles and cannot substitute for acceptance testing. Editing a checkout does not update another installed app.asar: verify the actual package loaded by the target application. Disabled desktop HMR or cached metadata may require a restart.
