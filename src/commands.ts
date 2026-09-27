/**
 * Human-facing slash commands.
 *
 * These are the same three verbs the model gets as tools, exposed at the
 * composer so a person can drive cross-session work without a model in the
 * loop: see the other sessions, mint a scratch session, and push a message
 * into a session by id.
 *
 * @module dsh-session-bridge/commands
 */

import { realpath, rm } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { listSessionRows, resolveSessionRef } from './catalog.ts'
import { deliverToSession } from './delivery.ts'
import type { DeliveryMode } from './delivery.ts'
import type { AgentLike, CommandInvocationLike, CommandResultLike, HostContext } from './dsh.ts'
import { commandsOf, sessionControllerOf } from './dsh.ts'
import { createScratchSession } from './scratch.ts'
import { workspaceRegistryOf } from './dsh.ts'
import type { ToolPolicy } from './tools.ts'

/** Render one relative age for the session listing. */
function age(timestamp: number | undefined): string {
  if (timestamp === undefined) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

/** Render one session listing row for a human. */
function rowLine(row: {
  readonly sessionId: string
  readonly title?: string
  readonly cwd?: string
  readonly live: boolean
  readonly running: boolean
  readonly updatedAt?: number
  readonly origin?: string
  readonly self: boolean
}): string {
  const state = row.self ? 'you' : row.running ? 'running' : row.live ? 'live' : 'cold'
  const title = row.title === undefined ? '(untitled)' : row.title
  const where = row.cwd === undefined ? '' : `  ${row.cwd}`
  const child = row.origin === 'subagent' ? ' [subagent]' : ''
  return `• ${title}${child}\n  ${row.sessionId}\n  ${state} · ${age(row.updatedAt)}${where}`
}

/**
 * Register the bridge slash commands.
 * @param ctx - Host context.
 * @param policy - resolved bridge policy.
 */
export function registerBridgeCommands(ctx: HostContext, policy: ToolPolicy): void {
  const commands = commandsOf(ctx)
  if (commands === undefined) return

  commands.register({
    name: 'sessions',
    description: 'List DeepSeek Harness sessions with their session ids',
    input: { hint: '[filter text]' },
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      const filter = invocation.rawInput.trim().toLowerCase()
      const selfId = invocation.agent?.id ?? ''
      const rows = await listSessionRows(ctx, selfId, 200)
      const matched = filter.length === 0 ? rows : rows.filter(row =>
        row.sessionId.toLowerCase().includes(filter)
        || (row.title ?? '').toLowerCase().includes(filter)
        || (row.cwd ?? '').toLowerCase().includes(filter))
      if (matched.length === 0) {
        return { kind: 'success', text: filter.length === 0 ? 'No sessions.' : `No session matches "${filter}".` }
      }
      const shown = matched.slice(0, 30)
      const more = matched.length > shown.length ? `\n… and ${matched.length - shown.length} more.` : ''
      return { kind: 'success', text: `${shown.map(rowLine).join('\n')}${more}` }
    },
  })

  commands.register({
    name: 'scratch',
    description: 'Create a new session working in a throwaway scratch directory',
    input: { hint: '[label]' },
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      const label = invocation.rawInput.trim()
      const created = await createScratchSession(ctx, {
        root: policy.scratchRoot,
        prefix: policy.scratchPrefix,
        registerWorkspace: policy.registerScratchWorkspace,
        ...(label.length === 0 ? {} : { label }),
      })
      return {
        kind: 'success',
        text: [
          'Scratch session created.',
          `  session  ${created.sessionId}`,
          `  folder   ${created.path}`,
          created.workspaceTitle === undefined ? '  grouped  no' : `  project  ${created.workspaceTitle}`,
          '',
          'Open it from the sidebar to continue there.',
        ].join('\n'),
      }
    },
  })

  commands.register({
    name: 'bridge',
    description: 'Send a message to another session by its id or title',
    input: { hint: '<session-id | title> <message>' },
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      const agent: AgentLike | undefined = invocation.agent
      if (agent === undefined) return { kind: 'error', text: 'The /bridge command needs a live session.' }
      const raw = invocation.rawInput.trim()
      if (raw.length === 0) return { kind: 'error', text: 'Usage: /bridge <session-id | title> <message>' }

      // A title may contain spaces, so the split between reference and body is
      // not the first whitespace: the longest leading token span that resolves
      // to exactly one session wins, and everything after it is the body.
      const tokens = raw.split(/\s+/)
      let target: string | undefined
      let body = ''
      for (let span = tokens.length - 1; span >= 1; span -= 1) {
        const candidate = tokens.slice(0, span).join(' ')
        const remaining = tokens.slice(span).join(' ')
        if (remaining.length === 0) continue
        const probe = await resolveSessionRef(ctx, agent.id, candidate)
        if (probe.ok && probe.sessionId !== agent.id) {
          target = candidate
          body = remaining
          break
        }
      }
      if (target === undefined) {
        return {
          kind: 'error',
          text: raw.search(/\s/) < 0
            ? 'Usage: /bridge <session-id | title> <message>'
            : `No single session matches the start of "${raw}". Use /sessions to list ids and titles.`,
        }
      }
      if (body.length > policy.maxMessageChars) {
        return { kind: 'error', text: `Message exceeds ${policy.maxMessageChars} characters.` }
      }
      const mode: DeliveryMode = 'steer'
      const result = await deliverToSession(ctx, agent, target, body, mode, { wakeColdSessions: policy.wakeColdSessions })
      if (!result.delivered) {
        return { kind: 'error', text: `Not delivered to ${result.sessionId}: ${result.reason ?? 'unknown reason'}` }
      }
      return {
        kind: 'success',
        text: `Delivered to ${result.sessionId}${result.woke ? ' (woke a cold session)' : ''} · mode ${result.mode}.`,
      }
    },
  })

  commands.register({
    name: 'scratch-clean',
    description: 'Remove scratch projects that hold no sessions (add "yes" to actually delete)',
    input: { hint: '[yes]' },
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      const registry = workspaceRegistryOf(ctx)
      if (registry === undefined) {
        return { kind: 'error', text: 'This Host exposes no workspace registry.' }
      }
      let root: string
      try {
        root = await realpath(resolve(policy.scratchRoot))
      } catch (error) {
        return { kind: 'error', text: `Cannot inspect scratch root: ${error instanceof Error ? error.message : String(error)}` }
      }
      // Only directories the bridge itself mints, and never a project outside
      // the scratch root: this removes throwaways, not the user's work.
      const isScratch = (path: string): boolean => {
        const canonical = resolve(path)
        return canonical.startsWith(`${root}${sep}`) && basename(canonical).startsWith('dsh-')
          && basename(canonical) !== 'dsh-scratch'
      }
      // A scratch project is disposable when nothing has happened in it: it
      // holds no sessions, or only blank ones. Clicking the New-Session row
      // leaves exactly one blank session behind, so "no sessions" alone would
      // never clean up the clutter this command exists for.
      const blanks = new Set<string>()
      try {
        const listed = await sessionControllerOf(ctx)?.list({})
        for (const summary of listed?.items ?? []) {
          if (summary.blank) blanks.add(summary.sessionId)
        }
      } catch {
        // Without the listing, only provably empty projects qualify.
      }
      const candidates = registry.list().filter(workspace =>
        isScratch(workspace.path)
        && workspace.sessionIds.every(sessionId => blanks.has(sessionId)))
      if (candidates.length === 0) {
        return { kind: 'success', text: 'No unused scratch projects to remove.' }
      }
      const lines = candidates.map(workspace => {
        const held = workspace.sessionIds.length
        return `  ${workspace.title}  →  ${workspace.path}${held === 0 ? '' : `  (${held} blank session${held === 1 ? '' : 's'})`}`
      })
      if (invocation.rawInput.trim().toLowerCase() !== 'yes') {
        return {
          kind: 'success',
          text: [
            `${candidates.length} unused scratch project(s) would be removed:`,
            ...lines,
            '',
            'Folders are deleted too. Run /scratch-clean yes to do it.',
          ].join('\n'),
        }
      }
      const removed: string[] = []
      const failed: string[] = []
      for (const workspace of candidates) {
        try {
          await registry.delete(workspace.id)
        } catch (error: unknown) {
          failed.push(`${workspace.path}: ${error instanceof Error ? error.message : String(error)}`)
          continue
        }
        // The registration is gone either way; a folder that refuses to delete
        // is reported rather than retried, since the project already left the UI.
        try {
          await rm(workspace.path, { recursive: true, force: true })
          removed.push(workspace.title)
        } catch (error: unknown) {
          failed.push(`${workspace.path} (project removed, folder kept): ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return {
        kind: 'success',
        text: [
          `Removed ${removed.length} scratch project(s)${removed.length === 0 ? '' : `: ${removed.join(', ')}`}.`,
          ...failed.length === 0 ? [] : ['', 'Problems:', ...failed.map(line => `  ${line}`)],
        ].join('\n'),
      }
    },
  })
}
