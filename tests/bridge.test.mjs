/**
 * Offline behaviour tests for the session bridge.
 *
 * These drive the built plugin against a fake Cordis Host that implements the
 * exact structural surface `src/dsh.ts` declares. That matters for two
 * reasons: the tools' real logic — reference resolution, transcript
 * projection, delivery mode, scratch minting — is exercised without a live
 * Harness, and the fake Host doubles as an executable specification of what
 * the plugin is allowed to assume about the services it borrows.
 *
 * Run: node --test tests/
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { apply, name } from '../lib/index.js'

/* ------------------------------------------------------------------ fake Host */

/** One recorded inbound delivery. */
const deliveries = []

/** A fake live Agent that records what was pushed into its inbox. */
function fakeAgent(id, cwd) {
  return {
    id,
    session: { header: { id, cwd, createdAt: Date.now() } },
    followup(message) { deliveries.push({ id, mode: 'followup', message }) },
    steer(message) { deliveries.push({ id, mode: 'steer', message }) },
    inject(message) { deliveries.push({ id, mode: 'inject', message }) },
  }
}

/** A fake surface snapshot for one session. */
function surface(id, cwd, turns) {
  return {
    session: { id, cwd, createdAt: Date.now() },
    events: turns.flatMap(turn => turn.role === 'assistant'
      ? [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: turn.text }] } } }]
      : [{ type: 'user/message', data: { content: [{ type: 'text', text: turn.text }], source: { kind: turn.source ?? 'user' } } }]),
  }
}

/** Build a Host context with the exact services the plugin looks up. */
function fakeHost({ summaries, surfacesById, agents, scratchRoot }) {
  /** Workspace registrations the fake registry holds, for the cleanup command to walk. */
  const registered = []
  const registeredTools = new Map()
  const registeredCommands = new Map()
  const sections = new Map()
  const events = new Map()
  const host = {
    tools: { register(definition) { registeredTools.set(definition.name, definition); return () => {} } },
    commands: { register(definition) { registeredCommands.set(definition.name, definition); return () => {} } },
    agents: {
      get: id => agents.get(id),
      list: () => [...agents.values()],
      resume: async ({ resumeSessionId }) => {
        const agent = fakeAgent(resumeSessionId, surfacesById.get(resumeSessionId)?.session.cwd)
        agents.set(resumeSessionId, agent)
        return { agent }
      },
      create: async ({ sessionId, meta }) => {
        const agent = fakeAgent(sessionId, meta?.cwd)
        agents.set(sessionId, agent)
        return { agent }
      },
    },
    sessions: { get: id => surfacesById.get(id), list: () => [] },
    sessionController: {
      list: async () => ({ items: summaries }),
      create: async (request) => {
        const sessionId = request.sessionId ?? `session-created-${summaries.length + 1}`
        agents.set(sessionId, fakeAgent(sessionId, request.cwd ?? '/tmp/from-workspace'))
        return { sessionId }
      },
    },
    sessionQuery: {
      readSurface: async (id) => {
        const snapshot = surfacesById.get(id)
        if (snapshot === undefined) throw new Error(`SESSION_QUERY_SESSION_NOT_FOUND: ${id}`)
        return snapshot
      },
      listSessions: async () => [...surfacesById.values()].map(s => ({ header: s.session, live: true, persisted: true })),
    },
    workspaceRegistry: {
      create: async (path, title) => {
        const workspace = { id: `workspace-${path}`, path, title: title ?? path, sessionIds: [], attachSession: async () => {} }
        registered.push(workspace)
        return workspace
      },
      get: id => registered.find(workspace => workspace.id === id),
      list: () => [...registered],
      delete: async (id) => {
        const at = registered.findIndex(workspace => workspace.id === id)
        if (at < 0) return false
        registered.splice(at, 1)
        return true
      },
      resolveByPath: async () => undefined,
    },
    logger: { info() {}, warn() {} },
    get(key) {
      return this[key]
    },
    inject(names, callback) { if (names.every(key => this.get(key) !== undefined)) callback(this) },
    effect() {},
    on(event, listener) {
      const list = events.get(event) ?? []
      list.push(listener)
      events.set(event, list)
      return () => {}
    },
  }
  return { host, registeredTools, registeredCommands, sections, scratchRoot, registered }
}

/** Resolve one registered tool's execute with decoded arguments. */
async function callTool(registeredTools, toolName, args, agent) {
  const tool = registeredTools.get(toolName)
  assert.ok(tool, `tool ${toolName} was registered`)
  // Mirror the registry's decode: JSON round-trip through the declared schema.
  const decoded = JSON.parse(JSON.stringify(args))
  return await tool.execute(decoded, { agent, signal: new AbortController().signal })
}

/* ------------------------------------------------------------------ fixtures */

const SELF = 'session-self-1111-2222'
const PEER = 'session-peer-3333-4444'
const COLD = 'session-cold-5555-6666'

const created = []
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

function hostFixture(overrides = {}) {
  const agents = new Map()
  agents.set(SELF, fakeAgent(SELF, '/Users/someone/project'))
  const summaries = [
    { sessionId: SELF, agentAvailable: true, updatedAt: 3_000, running: true, blank: false, cwd: '/Users/someone/project', projections: { values: { title: 'Primary work' } } },
    { sessionId: PEER, agentAvailable: true, updatedAt: 2_000, running: false, blank: false, cwd: '/Users/someone/other', projections: { values: { title: 'Peer session' } } },
    { sessionId: COLD, agentAvailable: false, updatedAt: 1_000, running: false, blank: false, cwd: '/tmp/dsh-session-cold', projections: { values: { title: 'Cold session' } } },
    { sessionId: 'session-sub-7777', agentAvailable: false, updatedAt: 500, running: false, blank: false, cwd: '/Users/someone/project', origin: 'subagent', parentSessionId: SELF, projections: { values: { title: 'Child worker' } } },
    { sessionId: 'session-blank', agentAvailable: true, updatedAt: 100, running: false, blank: true, cwd: '/tmp/dsh-session-cccccc' },
    { sessionId: 'session-real', agentAvailable: true, updatedAt: 100, running: false, blank: false, cwd: '/tmp/dsh-session-bbbbbb' },
  ]
  const surfacesById = new Map([
    [PEER, surface(PEER, '/Users/someone/other', [
      { role: 'user', text: 'please check the parser' },
      { role: 'assistant', text: 'the parser has an off-by-one' },
    ])],
    [COLD, surface(COLD, '/tmp/dsh-session-cold', [
      { role: 'user', text: 'old question' },
      { role: 'assistant', text: 'old answer' },
    ])],
    [SELF, surface(SELF, '/Users/someone/project', [{ role: 'user', text: 'hello' }])],
  ])
  agents.set(PEER, fakeAgent(PEER, '/Users/someone/other'))
  const fixture = fakeHost({ summaries, surfacesById, agents, ...overrides })
  apply(fixture.host, { scratchRoot: overrides.scratchRoot ?? '/tmp', scratchPrefix: 'dsh-test-' })
  return { ...fixture, agents, surfacesById }
}

/* ------------------------------------------------------------------ tests */

describe('session bridge host half', () => {
  it('activates without any optional service being injected', () => {
    assert.equal(name, 'session-bridge')
    const { registeredTools, registeredCommands } = hostFixture()
    assert.deepEqual([...registeredTools.keys()].sort(), ['session_list', 'session_read', 'session_scratch', 'session_send'])
    assert.deepEqual([...registeredCommands.keys()].sort(), ['bridge', 'scratch', 'scratch-clean', 'sessions'])
  })

  it('tolerates a Host that mounts none of the optional services', () => {
    const bare = {
      tools: { register: () => () => {} },
      agents: { get: () => undefined, list: () => [], resume: async () => { throw new Error('no') }, create: async () => { throw new Error('no') } },
      get: () => undefined,
      inject: () => {},
      effect: () => {},
      on: () => () => {},
    }
    assert.doesNotThrow(() => apply(bare, {}))
  })

  it('session_list reports every session and marks the caller', async () => {
    const { registeredTools, agents } = hostFixture()
    const value = await callTool(registeredTools, 'session_list', {}, agents.get(SELF))
    assert.equal(value.self, SELF)
    assert.equal(value.cwd, '/Users/someone/project')
    const self = value.sessions.find(row => row.session_id === SELF)
    assert.equal(self.self, true)
    assert.equal(self.title, 'Primary work')
    // Subagent sessions are hidden by default.
    assert.ok(!value.sessions.some(row => row.session_id === 'session-sub-7777'))
    const withChildren = await callTool(registeredTools, 'session_list', { include_subagents: true }, agents.get(SELF))
    assert.ok(withChildren.sessions.some(row => row.session_id === 'session-sub-7777'))
  })

  it('session_read projects user and assistant turns by exact id', async () => {
    const { registeredTools, agents } = hostFixture()
    const value = await callTool(registeredTools, 'session_read', { session_id: PEER }, agents.get(SELF))
    assert.equal(value.session_id, PEER)
    assert.equal(value.title, 'Peer session')
    assert.equal(value.total_turns, 2)
    assert.deepEqual(value.turns.map(turn => turn.role), ['user', 'assistant'])
    assert.match(value.turns[0].text, /parser/)
  })

  it('session_read retains only the newest turns when capped', async () => {
    const { registeredTools, agents } = hostFixture()
    const value = await callTool(registeredTools, 'session_read', { session_id: PEER, max_turns: 1 }, agents.get(SELF))
    assert.equal(value.total_turns, 2)
    assert.equal(value.truncated, true)
    assert.deepEqual(value.turns.map(turn => turn.role), ['assistant'])
  })

  it('resolves a session by exact title and by unique id prefix', async () => {
    const { registeredTools, agents } = hostFixture()
    const byTitle = await callTool(registeredTools, 'session_read', { session_id: 'Peer session' }, agents.get(SELF))
    assert.equal(byTitle.session_id, PEER)
    const byPrefix = await callTool(registeredTools, 'session_read', { session_id: 'session-cold' }, agents.get(SELF))
    assert.equal(byPrefix.session_id, COLD)
  })

  it('refuses an unresolvable or ambiguous reference instead of guessing', async () => {
    const { registeredTools, agents } = hostFixture()
    await assert.rejects(
      callTool(registeredTools, 'session_read', { session_id: 'session-' }, agents.get(SELF)),
      /ambiguous id prefix matching 6 sessions/,
    )
    await assert.rejects(
      callTool(registeredTools, 'session_read', { session_id: 'nope' }, agents.get(SELF)),
      /no session id, title, or id prefix matches "nope"/,
    )
  })

  it('session_send steers a live peer and frames the message for it', async () => {
    deliveries.length = 0
    const { registeredTools, agents } = hostFixture()
    const value = await callTool(registeredTools, 'session_send', { session_id: 'Peer session', message: 'status?' }, agents.get(SELF))
    assert.equal(value.delivered, true)
    assert.equal(value.session_id, PEER)
    assert.equal(value.mode, 'steer')
    assert.equal(value.woke, false)
    const [delivery] = deliveries
    assert.equal(delivery.id, PEER)
    assert.equal(delivery.mode, 'steer')
    assert.equal(delivery.message.role, 'user')
    assert.equal(delivery.message.source.kind, 'session-bridge')
    assert.equal(delivery.message.source.senderSessionId, SELF)
    assert.equal(delivery.message.source.senderTitle, 'Primary work')
    assert.match(delivery.message.content[0].text, /relayed from another DeepSeek Harness session/)
    assert.match(delivery.message.content[0].text, /status\?/)
  })

  it('session_send queues a distinct turn in turn mode', async () => {
    deliveries.length = 0
    const { registeredTools, agents } = hostFixture()
    await callTool(registeredTools, 'session_send', { session_id: PEER, message: 'later', mode: 'turn' }, agents.get(SELF))
    assert.equal(deliveries[0].mode, 'followup')
  })

  it('session_send wakes a cold session through the Host resume path', async () => {
    deliveries.length = 0
    const { registeredTools, agents } = hostFixture()
    const value = await callTool(registeredTools, 'session_send', { session_id: COLD, message: 'wake up' }, agents.get(SELF))
    assert.equal(value.delivered, true)
    assert.equal(value.woke, true)
    assert.equal(deliveries[0].id, COLD)
  })

  it('session_send refuses a cold session when the policy forbids waking it', async () => {
    deliveries.length = 0
    const fresh = hostFixture()
    apply(fresh.host, { wakeColdSessions: false })
    const value = await callTool(fresh.registeredTools, 'session_send', { session_id: COLD, message: 'hello' }, fresh.agents.get(SELF))
    assert.equal(value.delivered, false)
    assert.match(value.reason, /is cold and this deployment does not wake cold sessions/)
    assert.equal(deliveries.length, 0)
  })

  it('session_send refuses self-delivery and oversized bodies', async () => {
    const { registeredTools, agents } = hostFixture()
    const self = await callTool(registeredTools, 'session_send', { session_id: SELF, message: 'hi' }, agents.get(SELF))
    assert.equal(self.delivered, false)
    assert.match(self.reason, /cannot bridge a message to itself/)
    await assert.rejects(
      callTool(registeredTools, 'session_send', { session_id: PEER, message: 'x'.repeat(9_000) }, agents.get(SELF)),
      /exceeds 8000 characters/,
    )
  })

  it('session_scratch mints a real throwaway directory', async () => {
    const { registeredTools } = hostFixture()
    const value = await callTool(registeredTools, 'session_scratch', { mode: 'directory', label: 'unit test' }, undefined)
    created.push(value.path)
    assert.equal(value.mode, 'directory')
    assert.match(value.path, /^\/tmp\/dsh-test-/)
    assert.ok(existsSync(value.path), 'the scratch directory exists on disk')
    const marker = JSON.parse(readFileSync(join(value.path, '.dsh-scratch.json'), 'utf8'))
    assert.equal(marker.kind, 'dsh-scratch')
    assert.equal(marker.label, 'unit test')
    assert.ok(value.workspace_id, 'the directory was registered as a workspace')
  })

  it('session_scratch creates a session in the scratch directory', async () => {
    const { registeredTools, agents } = hostFixture()
    const value = await callTool(registeredTools, 'session_scratch', {}, undefined)
    created.push(value.path)
    assert.equal(value.mode, 'session')
    assert.match(value.session_id, /^session-created-/)
    assert.equal(agents.get(value.session_id).session.header.cwd, '/tmp/from-workspace')
  })

  it('the /sessions command lists ids a human can copy', async () => {
    const { registeredCommands, agents } = hostFixture()
    const result = await registeredCommands.get('sessions').handler({ agent: agents.get(SELF), rawInput: '', signal: new AbortController().signal })
    assert.equal(result.kind, 'success')
    assert.match(result.text, new RegExp(SELF))
    assert.match(result.text, /Primary work/)
    assert.match(result.text, /you/)
  })

  it('the /bridge command delivers and reports the resolved id', async () => {
    deliveries.length = 0
    const { registeredCommands, agents } = hostFixture()
    const result = await registeredCommands.get('bridge').handler({
      agent: agents.get(SELF),
      rawInput: 'Peer session  ping',
      signal: new AbortController().signal,
    })
    assert.equal(result.kind, 'success')
    assert.match(result.text, new RegExp(`Delivered to ${PEER}`))
    assert.equal(deliveries[0].id, PEER)
  })

  it('the /bridge command reports a usage error rather than throwing', async () => {
    const { registeredCommands, agents } = hostFixture()
    const result = await registeredCommands.get('bridge').handler({ agent: agents.get(SELF), rawInput: 'only-an-id', signal: new AbortController().signal })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /Usage: \/bridge/)
  })

  it('the /scratch command creates a session and names it', async () => {
    const { registeredCommands, agents } = hostFixture()
    const result = await registeredCommands.get('scratch').handler({ agent: agents.get(SELF), rawInput: 'experiment', signal: new AbortController().signal })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /Scratch session created\./)
    const path = result.text.match(/folder\s+(\S+)/)[1]
    created.push(path)
    assert.ok(existsSync(path))
  })

  it('the /scratch-clean command previews, then removes only unused scratch projects', async () => {
    const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'bridge-clean-test-')))
    const alias = `${scratchRoot}-alias`
    symlinkSync(scratchRoot, alias)
    created.push(scratchRoot)
    created.push(alias)
    const fixture = hostFixture({ scratchRoot: alias })
    // Registry paths are canonical even when the configured root is an alias.
    // Empty and blank throwaways qualify; the shared workspace never does.
    fixture.registered.push(
      { id: 'ws-empty', path: join(scratchRoot, 'dsh-session-aaaaaa'), title: 'scratch a', sessionIds: [], attachSession: async () => {} },
      { id: 'ws-blank', path: join(scratchRoot, 'dsh-session-cccccc'), title: 'scratch c', sessionIds: ['session-blank'], attachSession: async () => {} },
      { id: 'ws-used', path: join(scratchRoot, 'dsh-session-bbbbbb'), title: 'scratch b', sessionIds: ['session-real'], attachSession: async () => {} },
      { id: 'ws-shared', path: join(scratchRoot, 'dsh-scratch'), title: 'shared', sessionIds: [], attachSession: async () => {} },
      { id: 'ws-real', path: '/Users/someone/project', title: 'real', sessionIds: [], attachSession: async () => {} },
    )
    const run = rawInput => fixture.registeredCommands.get('scratch-clean')
      .handler({ agent: fixture.agents.get(SELF), rawInput, signal: new AbortController().signal })

    const preview = await run('')
    assert.equal(preview.kind, 'success')
    assert.match(preview.text, /2 unused scratch project\(s\) would be removed/)
    assert.match(preview.text, /scratch a/)
    assert.equal(fixture.registered.length, 5, 'a preview changes nothing')

    const done = await run('yes')
    assert.equal(done.kind, 'success')
    assert.match(done.text, /Removed 2 scratch project\(s\)/)
    assert.deepEqual(fixture.registered.map(workspace => workspace.id).sort(), ['ws-real', 'ws-shared', 'ws-used'])
  })

  it('the /scratch-clean command reports when there is nothing to remove', async () => {
    const fixture = hostFixture()
    const result = await fixture.registeredCommands.get('scratch-clean')
      .handler({ agent: fixture.agents.get(SELF), rawInput: 'yes', signal: new AbortController().signal })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /No unused scratch projects to remove/)
  })

  it('installs a per-session prompt section naming that session', () => {
    const sections = []
    const agents = new Map()
    const agent = fakeAgent(SELF, '/Users/someone/project')
    agent.ctx = {
      systemPrompt: {
        section(definition) { sections.push(definition); return () => {} },
        getSectionOrder: () => 2800,
      },
      get(key) { return this[key] },
    }
    agents.set(SELF, agent)
    const fixture = fakeHost({
      summaries: [],
      surfacesById: new Map(),
      agents,
    })
    apply(fixture.host, {})
    assert.equal(sections.length, 1)
    assert.equal(sections[0].name, 'session-bridge:policy')
    assert.equal(sections[0].order, 2810)
    assert.match(sections[0].text, new RegExp(SELF))
    assert.match(sections[0].text, /session_send/)
    assert.match(sections[0].text, /peer request, not instruction/)
  })

  it('applies config defaults when the profile supplies no config', () => {
    const bare = hostFixture()
    assert.ok(bare.registeredTools.has('session_scratch'))
  })
})
