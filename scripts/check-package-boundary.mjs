/** Audit one local Bridge tarball without installing it or touching another plugin. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.argv[2]) throw new Error('usage: node scripts/check-package-boundary.mjs <bridge.tgz> [result.json]')
const archive = resolve(process.argv[2])
const root = fileURLToPath(new URL('../', import.meta.url))
const output = resolve(process.argv[3] ?? `${root}/verification/package-boundary.json`)
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
const read = name => execFileSync('tar', ['-xOzf', archive, `package/${name}`], { encoding: 'utf8' })
assert.ok(entries.every(name => name.startsWith('package/') && !name.split('/').includes('..')))
assert.ok(entries.every(name => !/dsh-context-manager|(^|\/)node_modules\/|(^|\/)verification\/|\.tgz$|\.patch$/.test(name)))
const manifest = JSON.parse(read('package.json'))
assert.equal(manifest.name, '@missher/dsh-session-bridge')
assert.equal(manifest.license, 'MIT')
assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
for (const name of ['README.md', 'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'COMPATIBILITY.json']) {
  assert.ok(entries.includes(`package/${name}`), `missing release document: ${name}`)
}
assert.match(read('LICENSE'), /Copyright \(c\) 2026 DeepSeek/)
assert.match(read('LICENSE'), /Permission is hereby granted, free of charge/)
assert.equal(JSON.parse(read('COMPATIBILITY.json')).packageVersion, manifest.version)
for (const target of [manifest.main, ...Object.values(manifest.exports).map(value => typeof value === 'string' ? value : value.default)]) {
  assert.equal(typeof target, 'string')
  assert.ok(!target.split('/').includes('..') && !target.startsWith('/'))
  assert.ok(entries.includes(`package/${target.replace(/^\.\//, '')}`), `missing entry point: ${target}`)
}
for (const entry of entries.filter(name => !name.endsWith('/'))) {
  assert.doesNotMatch(read(entry.slice('package/'.length)), /\/Users\/[^\s/]+|\/home\/[^\s/]+|[A-Z]:\\Users\\/,
    `machine-specific path: ${entry}`)
}
assert.ok(entries.every(name => !/\/harness-sdk(?:\/|$)|\/(?:REPAIR_REPORT|PLUGIN_BOUNDARIES|SESSION_ACTIONS)\.md$/.test(name)))
assert.deepEqual(manifest.dependencies ?? {}, {}, 'Bridge must not acquire runtime dependencies')
assert.deepEqual(manifest.peerDependencies ?? {}, {})
for (const name of Object.keys(manifest.scripts ?? {})) {
  assert.ok(!['preinstall', 'install', 'postinstall', 'prepack', 'postpack'].includes(name), `unexpected package lifecycle hook: ${name}`)
}
assert.doesNotMatch(read('cordis.patch.yml'), /dsh-context-manager/)
for (const entry of entries.filter(name => /^package\/(?:lib|src)\/.*\.(?:js|tsx?)$/.test(name))) {
  assert.doesNotMatch(read(entry.slice('package/'.length)), /dsh-context-manager/, `cross-plugin reference: ${entry}`)
}
for (const entry of entries.filter(name => /^package\/lib\/[^/]+\.js$/.test(name))) {
  assert.doesNotMatch(read(entry.slice('package/'.length)), /(?:from\s*|import\s*\(|require\s*\()\s*["']@deepseek-ai\//,
    `Host runtime import: ${entry}`)
}
const client = read('lib/client/index.js')
const runtimeRequests = [...new Set([...client.matchAll(/(?:require|__require)\(["']([^"']+)["']\)/g)].map(match => match[1]))].sort()
assert.deepEqual(runtimeRequests, ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime'])
assert.match(client, /style\.dataset\.plugin = ["']@missher\/dsh-session-bridge["']/)
assert.match(client, /style\.dataset\.pluginCss = STYLE_ID/)
const result = {
  package: manifest.name, version: manifest.version, archive,
  sha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
  fileCount: entries.filter(name => !name.endsWith('/')).length,
  containsContextManagerCodeOrDependency: false, containsVerificationSnapshots: false,
  containsUpstreamPatch: false, packageLifecycleHooks: false,
  runtimeRequests, bridgeStyleOwner: true,
  licenseAndAttribution: true, bilingualReadmes: true, entryPointsPresent: true,
  machineSpecificPaths: false, hostDshRuntimeImports: false,
  bridgeClientSha256: createHash('sha256').update(client).digest('hex'),
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
