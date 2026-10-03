/**
 * Evaluate the built client bundle the way DSH does, and fail on a throw.
 *
 * esbuild only *transpiles* — it never runs the module. A missing JSX pragma, a
 * top-level DOM read, or a stray reference to an unimported binding therefore
 * survives the build and only dies in the browser, where DSH drops every one of
 * the plugin's registrations and the chip silently never appears. That failure
 * mode is too quiet to leave to a manual look at the header.
 *
 * This runs the real artifact through a stub `window.__ModuleLoader__.load`
 * with `react` and the JSX runtime stubbed, and asserts the factory returns a
 * plugin with `inject` and `apply`.
 *
 * Usage: node scripts/check-client-load.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = resolve(root, 'lib', 'client', 'index.js')

if (!existsSync(bundle)) {
  console.error(`missing ${bundle} — run \`pnpm build:client\` first`)
  process.exit(1)
}

/** Minimal React surface: the bundle only calls createElement at module scope. */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: value => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useRef: value => ({ current: value }),
  Fragment: Symbol('Fragment'),
}
const jsxRuntimeStub = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  Fragment: Symbol('Fragment'),
}

/**
 * `@deepseek-ai/dsh-client-ui-primitives` is a *static* module: the shell seeds
 * it into the module table (`getStaticModules()`), so a plugin may `require` it
 * without declaring a row of its own. Only the members this bundle destructures
 * at module scope need to exist here.
 */
const iconStub = props => ({ type: 'svg', props })
const primitivesStub = {
  Menu: props => ({ type: 'Menu', props }),
  Modal: props => ({ type: 'Modal', props }),
  Button: props => ({ type: 'Button', props }),
  IconFolderCloseRegular: iconStub,
  IconPlusOutlineRegular: iconStub,
  IconSparkleRegular: iconStub,
}

let loaded
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  window: {
    __ModuleLoader__: {
      /**
       * Capture the factory DSH would call, and materialize it immediately.
       * @param entry - the `{ id, factory }` record the bundle registers.
       */
      load(entry) {
        loaded = { id: entry.id, exports: entry.factory(specifier => {
          if (specifier === 'react') return reactStub
          if (specifier === 'react/jsx-runtime') return jsxRuntimeStub
          if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
          throw new Error(`unexpected require("${specifier}") in the client bundle`)
        }) }
      },
    },
  },
}
sandbox.globalThis = sandbox
sandbox.self = sandbox

runInContext(readFileSync(bundle, 'utf8'), createContext(sandbox), { filename: bundle })

if (loaded === undefined) {
  console.error('the bundle never called window.__ModuleLoader__.load')
  process.exit(1)
}

const problems = []
const expectedId = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).name
if (loaded.id !== expectedId) problems.push(`registered id is "${loaded.id}", expected "${expectedId}"`)
if (typeof loaded.exports.apply !== 'function') problems.push('exports.apply is not a function')
if (!Array.isArray(loaded.exports.inject)) problems.push('exports.inject is not an array')
for (const required of ['slots', 'locale', 'uiWorkspace', 'workspaces', 'sessions']) {
  if (!loaded.exports.inject?.includes(required)) problems.push(`exports.inject omits "${required}"`)
}

if (problems.length > 0) {
  console.error(`client bundle check failed:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}

console.log(`client bundle ok: id=${loaded.id} inject=[${loaded.exports.inject.join(', ')}] apply=function`)
