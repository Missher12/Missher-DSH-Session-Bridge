/** Check the built Bridge against an installed module system and real Cordis entry lifecycle. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { open, readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const [checkoutArg, archiveArg, outputArg] = process.argv.slice(2)
if (!checkoutArg || !archiveArg) {
  throw new Error('usage: node scripts/check-style-ownership.mjs <DSH checkout> <installed app.asar> [result.json]')
}
const checkout = resolve(checkoutArg)
const archive = resolve(archiveArg)
const pluginRoot = fileURLToPath(new URL('../', import.meta.url))
const output = outputArg ? resolve(outputArg) : join(pluginRoot, 'verification/style-ownership/result.json')
const rootRequire = createRequire(join(checkout, 'package.json'))
const moduleRequire = createRequire(join(checkout, 'packages/client/modules/package.json'))
const reactRequire = createRequire(join(checkout, 'packages/client/ui-workspace/package.json'))
const { JSDOM } = rootRequire('jsdom')
const { Context } = await import(pathToFileURL(moduleRequire.resolve('@deepseek-ai/cordis')).href)
const { default: Loader } = await import(pathToFileURL(moduleRequire.resolve('@deepseek-ai/cordis-plugin-loader')).href)

/** Read only the ASAR header and requested file, following archive-owned links. */
async function readArchiveFile(path) {
  const handle = await open(archive, 'r')
  try {
    const prefix = Buffer.alloc(16)
    await handle.read(prefix, 0, prefix.length, 0)
    const headerSize = prefix.readUInt32LE(4)
    const jsonSize = prefix.readUInt32LE(12)
    assert.ok(jsonSize > 0 && jsonSize <= headerSize && jsonSize < 50_000_000)
    const header = Buffer.alloc(jsonSize)
    assert.equal((await handle.read(header, 0, jsonSize, 16)).bytesRead, jsonSize)
    const tree = JSON.parse(header.toString())
    function find(name, depth = 0) {
      assert.ok(depth < 20, 'cyclic ASAR link')
      let node = tree
      const parts = name.split('/').filter(Boolean)
      for (let index = 0; index < parts.length; index++) {
        node = node.files[parts[index]]
        if (node.link) return find([node.link, ...parts.slice(index + 1)].join('/'), depth + 1)
      }
      return { node, name }
    }
    const { node, name } = find(path)
    if (node.unpacked) return await readFile(join(`${archive}.unpacked`, name), 'utf8')
    const bytes = Buffer.alloc(node.size)
    assert.equal((await handle.read(bytes, 0, bytes.length, 8 + headerSize + Number(node.offset))).bytesRead, bytes.length)
    return bytes.toString()
  } finally { await handle.close() }
}

const packagePath = 'dsh/node_modules/@deepseek-ai/dsh-client-modules'
const manifest = JSON.parse(await readArchiveFile(`${packagePath}/package.json`))
const modulesSource = await readArchiveFile(`${packagePath}/${manifest.exports['./client'].default.replace(/^\.\//, '')}`)
const bridgeSource = await readFile(join(pluginRoot, 'lib/client/index.js'), 'utf8')
const BRIDGE = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8')).name
const PEER = 'dsh-style-owner-fixture'
const STYLE = 'dsh-session-bridge-styles'
const graph = (...ids) => ({
  rev: ids.join(','),
  entries: ids.map(id => ({ id, rev: 'r0', url: `/plugins/??${id}/client.js&rev=r0` })),
  batches: ids.map(id => ({ phase: 'application', url: `/plugins/??${id}/client.js&rev=r0`, rev: 'r0', entries: [id] })),
})

async function scenario(source, expectedOwner) {
  const dom = new JSDOM('<!doctype html><div class="dsh-sbc-panel">panel</div>')
  const document = dom.window.document
  let registration
  const sandbox = vm.createContext({
    window: { __ModuleLoader__: { load: value => { registration = value } } },
    document, fetch, URL, console, setTimeout, clearTimeout, queueMicrotask,
  })
  vm.runInContext(modulesSource, sandbox)
  const bootstrap = registration.factory(() => { throw new Error('bootstrap must be self-contained') })
  vm.runInContext(source, sandbox)
  const bridge = registration
  const target = { mode: 'queue', pendingQueue: [], load() {} }
  const modules = bootstrap.createClientModuleSystem(target, {
    id: '@deepseek-ai/dsh-client-modules', exports: bootstrap,
  }, {
    boot: graph(),
    staticModules: {
      react: reactRequire('react'), 'react/jsx-runtime': reactRequire('react/jsx-runtime'),
      '@deepseek-ai/dsh-client-ui-primitives': {},
    },
    async loadBundle(url) {
      const id = url.split('??')[1].split('/client.js')[0]
      assert.ok(id === BRIDGE || id === PEER)
      target.load(id === BRIDGE ? bridge : { id, factory() {
        const sheet = document.createElement('style')
        sheet.id = PEER
        sheet.dataset.plugin = PEER
        sheet.dataset.pluginCss = PEER
        sheet.textContent = '.fixture { color: blue; }'
        document.head.appendChild(sheet)
        return { apply(ctx) { ctx.effect(() => () => sheet.remove()) } }
      } })
    },
  })
  const ctx = new Context()
  const assertHealthy = () => assert.equal(modules.entries.state.getSnapshot().failures.length, 0)
  try {
    // Retain the real Bridge factory, injection requirements, and stylesheet
    // effect. UI rendering and domain operations are outside this regression.
    ctx.provide('locale', { register: () => () => {} })
    ctx.provide('slots', { inject() {} })
    ctx.provide('uiWorkspace', {})
    ctx.provide('workspaces', { list: { getSnapshot: () => ({ archivedSessionIds: [] }), subscribe: () => () => {} } })
    ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: {} }) } })
    await ctx.plugin(Loader)
    ctx.loader.internal = modules
    await modules.entries.start(ctx.loader, modules.manifest)
    await modules.entries.sync(graph(BRIDGE))
    assertHealthy()
    const sheet = document.getElementById(STYLE)
    assert.ok(sheet)
    assert.equal(dom.window.getComputedStyle(document.querySelector('.dsh-sbc-panel')).position, 'absolute')
    await modules.entries.sync(graph(BRIDGE, PEER))
    assertHealthy()
    assert.equal(sheet.dataset.plugin, expectedOwner)
    await modules.entries.reload(PEER, 'r1')
    const survivesPeerReload = sheet.isConnected
    await modules.entries.sync(graph(BRIDGE))
    const survivesPeerRemoval = sheet.isConnected
    await modules.entries.sync(graph(BRIDGE, PEER))
    const survivesPeerReadd = sheet.isConnected
    assertHealthy()
    for (const survives of [survivesPeerReload, survivesPeerRemoval, survivesPeerReadd]) {
      assert.equal(survives, expectedOwner === BRIDGE)
    }
    const positionAfter = dom.window.getComputedStyle(document.querySelector('.dsh-sbc-panel')).position
    assert.equal(positionAfter === 'absolute', expectedOwner === BRIDGE)
    await modules.entries.reload(BRIDGE, 'r2')
    assert.equal(document.querySelectorAll(`#${STYLE}`).length, 1)
    const peerSheet = document.getElementById(PEER)
    await modules.entries.sync(graph(PEER))
    assert.equal(document.querySelectorAll(`#${STYLE}`).length, 0)
    assert.equal(peerSheet.isConnected, true, 'Bridge removal must not remove peer styles')
    await modules.entries.reload(PEER, 'r3')
    assertHealthy()
    await modules.entries.sync(graph(BRIDGE, PEER))
    assert.equal(document.querySelectorAll(`#${STYLE}`).length, 1)
    await modules.entries.sync(graph())
    assertHealthy()
    assert.equal(document.querySelectorAll('style').length, 0)
    return {
      ownerAfterPeerMount: expectedOwner, survivesPeerReload, survivesPeerRemoval, survivesPeerReadd,
      positionAfter, bridgeReloadSingleSheet: true, bridgeRemovalPreservesPeer: true,
      peerWorksWithoutBridge: true, bridgeReaddSingleSheet: true, finalStyles: 0,
    }
  } finally {
    await ctx.fiber.dispose()
    await ctx.fiber.await()
    dom.window.close()
  }
}

const unowned = bridgeSource.replace(/\s*style\.dataset\.(?:plugin|pluginCss) = [^;]+;/g, '')
assert.notEqual(unowned, bridgeSource, 'build is missing the ownership assignments')
const result = {
  installedModulesVersion: manifest.version,
  installedModulesSha256: createHash('sha256').update(modulesSource).digest('hex'),
  bridgeSha256: createHash('sha256').update(bridgeSource).digest('hex'),
  negativeControl: await scenario(unowned, PEER),
  fixed: await scenario(bridgeSource, BRIDGE),
  realCordisLoader: true, realInstalledModuleSystem: true,
  peerIsSyntheticFixture: true, nativeGuiClicks: false,
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
