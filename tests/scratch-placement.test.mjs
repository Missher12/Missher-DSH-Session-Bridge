import assert from 'node:assert/strict'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/scratch-placement.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
})
const { trackScratchPlacement } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const settle = () => new Promise(resolve => setImmediate(resolve))

function fixture() {
  let snapshot = { items: [], phase: 'ready', state: 'idle' }
  const listeners = new Set()
  const calls = []
  const active = new Set()
  const source = {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
  return {
    source, calls, active, listeners,
    update(items, state = 'idle') { snapshot = { ...snapshot, items, state }; for (const fn of listeners) fn() },
    find(signal) { return new Promise(resolve => calls.push({ signal, resolve })) },
    register(id) { active.add(id); return () => active.delete(id) },
  }
}

it('resolves the canonical identity on first use, survives rename, and releases removal/unload', async () => {
  const f = fixture()
  const stop = trackScratchPlacement(f.source, f.find, f.register)
  f.calls[0].resolve(null)
  await settle()
  assert.equal(f.active.size, 0, 'a lookup does not create or register a missing workspace')
  f.update([{ workspaceId: 'same-title-project' }, { workspaceId: 'scratch' }])
  f.calls[1].resolve('scratch')
  await settle()
  assert.deepEqual([...f.active], ['scratch'])
  f.update([{ workspaceId: 'same-title-project', title: '不在工作区' }, { workspaceId: 'scratch', title: 'Renamed' }])
  assert.equal(f.calls.length, 2, 'titles never select the fixed workspace')
  f.update([{ workspaceId: 'same-title-project' }])
  assert.equal(f.active.size, 0)
  f.calls[2].resolve(null)
  await settle()
  stop()
  assert.equal(f.listeners.size, 0)
})

it('ignores stale lookup replies through reconnect, replacement and unload', async () => {
  const f = fixture()
  f.update([{ workspaceId: 'old' }])
  const stop = trackScratchPlacement(f.source, f.find, f.register)
  f.update([{ workspaceId: 'new' }], 'loading')
  assert.equal(f.calls[0].signal.aborted, true)
  f.calls[0].resolve('old')
  f.calls[1].resolve('new')
  await settle()
  assert.deepEqual([...f.active], ['new'])
  f.update([{ workspaceId: 'new' }])
  stop()
  f.calls[2].resolve('new')
  await settle()
  assert.equal(f.active.size, 0)
  assert.equal(f.calls[2].signal.aborted, true)
})
