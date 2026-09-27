/**
 * Throwaway scratch workspaces.
 *
 * The bridge can put a Session somewhere that is deliberately not the user's
 * default workspace: a fresh directory under `/tmp` (`/tmp/dsh-session-XXXXXX`
 * by default) that exists only for that Session's work. Two shapes are
 * offered, because the two are useful in different moments:
 *
 * - a **scratch directory**, for the Session already running — hand it to
 *   `bash`/file tools and let it build something disposable; and
 * - a **scratch session**, a brand-new Session whose durable `cwd` is that
 *   directory, registered as its own Workspace so it appears in the sidebar
 *   like any other project rather than as an ungrouped orphan.
 *
 * @module dsh-session-bridge/scratch
 */

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { HostContext } from './dsh.ts'
import { sessionControllerOf, workspaceRegistryOf } from './dsh.ts'

/** Where and how one scratch directory is created. */
export interface ScratchOptions {
  /** Parent directory the scratch directory is minted inside. */
  readonly root: string
  /** Name prefix; `mkdtemp` appends six random characters to it. */
  readonly prefix: string
  /** Whether to register the directory as a durable Workspace. */
  readonly registerWorkspace: boolean
  /** Optional human label carried into the workspace title. */
  readonly label?: string
}

/** One created scratch directory. */
export interface ScratchDirectory {
  /** Absolute path, already canonical enough to hand to a shell. */
  readonly path: string
  /** Durable Workspace id, when one was registered. */
  readonly workspaceId?: string
  /** Workspace title as the sidebar will render it. */
  readonly workspaceTitle?: string
}

/** One created scratch Session. */
export interface ScratchSession {
  /** Durable Session id of the new Session. */
  readonly sessionId: string
  /** The scratch directory the Session owns as its `cwd`. */
  readonly path: string
  /** Durable Workspace id, when one was registered. */
  readonly workspaceId?: string
  /** Workspace title as the sidebar will render it. */
  readonly workspaceTitle?: string
  /** Whether the Session was attached to a Workspace, or left ungrouped. */
  readonly grouped: boolean
}

/** Trim a caller label to something safe to embed in a directory-free title. */
function cleanLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined
  const trimmed = label.trim().replace(/\s+/g, ' ')
  return trimmed.length === 0 ? undefined : trimmed.slice(0, 60)
}

/**
 * Mint one fresh scratch directory and record what it is.
 *
 * A `.dsh-scratch.json` marker is written inside so the directory explains
 * itself to a later `ls`, and so an external janitor can find and age out
 * abandoned scratch trees without guessing from the name alone.
 *
 * @param ctx - Host context.
 * @param options - root, prefix, and whether to register a Workspace.
 * @returns the created directory and its Workspace registration, when any.
 */
export async function createScratchDirectory(
  ctx: HostContext,
  options: ScratchOptions,
): Promise<ScratchDirectory> {
  const root = resolve(options.root)
  await mkdir(root, { recursive: true })
  const path = await mkdtemp(join(root, options.prefix))
  const label = cleanLabel(options.label)
  const createdAt = new Date().toISOString()
  await writeFile(
    join(path, '.dsh-scratch.json'),
    `${JSON.stringify({ kind: 'dsh-scratch', createdAt, label: label ?? null, plugin: 'dsh-session-bridge' }, null, 2)}\n`,
    'utf8',
  ).catch(() => undefined)

  if (!options.registerWorkspace) return { path }
  const registry = workspaceRegistryOf(ctx)
  if (registry === undefined) return { path }
  try {
    const title = label === undefined ? `scratch · ${basename(path)}` : `${label} · ${basename(path)}`
    const workspace = await registry.create(path, title)
    return { path: workspace.path, workspaceId: workspace.id, workspaceTitle: workspace.title }
  } catch (error) {
    // Registration is a convenience; the scratch directory is still usable ungrouped.
    return { path }
  }
}

/** Whether a Host Session Controller is available to create Sessions through. */
function controllerOf(ctx: HostContext): NonNullable<HostContext['sessionController']> | undefined {
  return sessionControllerOf(ctx)
}

/**
 * Create a new Session whose working directory is a fresh scratch directory.
 *
 * Prefers the Host Session Controller — the exact path the Web UI's own "new
 * session" uses — so the new Session gets the deployment's preset composition
 * and model selection. Falls back to the Agent registry when no controller is
 * mounted, which still yields a working root Session.
 *
 * @param ctx - Host context.
 * @param options - root, prefix, workspace registration, and label.
 * @returns the new Session's identity and location.
 * @throws when no Host capability can create a Session.
 */
export async function createScratchSession(
  ctx: HostContext,
  options: ScratchOptions,
): Promise<ScratchSession> {
  const directory = await createScratchDirectory(ctx, options)
  const controller = controllerOf(ctx)

  if (controller !== undefined) {
    if (directory.workspaceId !== undefined) {
      const created = await controller.create({ workspaceId: directory.workspaceId })
      return {
        sessionId: created.sessionId,
        path: directory.path,
        workspaceId: directory.workspaceId,
        ...(directory.workspaceTitle === undefined ? {} : { workspaceTitle: directory.workspaceTitle }),
        grouped: true,
      }
    }
    const created = await controller.create({ cwd: directory.path })
    return { sessionId: created.sessionId, path: directory.path, grouped: false }
  }

  if (ctx.agents === undefined) {
    throw new Error('session bridge cannot create a session: this Host exposes neither the Session Controller nor the Agent registry')
  }
  const sessionId = `session-${randomUUID()}`
  await ctx.agents.create({ sessionId, meta: { cwd: directory.path } })
  return {
    sessionId,
    path: directory.path,
    ...(directory.workspaceId === undefined ? {} : { workspaceId: directory.workspaceId }),
    ...(directory.workspaceTitle === undefined ? {} : { workspaceTitle: directory.workspaceTitle }),
    grouped: directory.workspaceId !== undefined,
  }
}

/** The default scratch root: `/tmp` where it exists, the platform temp directory otherwise. */
export function defaultScratchRoot(): string {
  if (process.platform === 'win32') return tmpdir()
  return '/tmp'
}
