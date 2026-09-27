/**
 * Build the browser half into the artifact DSH actually loads.
 *
 * DSH serves a client plugin's `exports["./client"]` file verbatim and evaluates
 * it through `window.__ModuleLoader__.load({ id, factory })`, where `factory`
 * receives a `require` resolving only the modules the shell already owns. So
 * the build has two jobs beyond transpiling: wrap the CJS output in that loader
 * call, and keep the approved static modules external so the bundle never embeds a
 * second copy of a package the shell is already running.
 *
 * Usage: node scripts/build-client.mjs [--watch]
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, context } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const temporary = resolve(root, '.client-build', 'client.cjs')
const output = resolve(root, 'lib', 'client', 'index.js')

await mkdir(dirname(temporary), { recursive: true })
await mkdir(dirname(output), { recursive: true })

/**
 * Wrap compiled CJS in the loader call DSH's bootstrap facade expects.
 * @param compiled - esbuild's CJS output.
 * @returns the exact file contents DSH evaluates.
 */
const wrap = (compiled) => `window.__ModuleLoader__.load({
  id: ${JSON.stringify(packageJson.name)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${compiled}
    return module.exports;
  },
});
`

/** After every emit, rewrite the output with the loader wrapper in place. */
const wrapPlugin = {
  name: 'wrap-module-loader',
  setup(buildApi) {
    buildApi.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const compiled = await readFile(temporary, 'utf8')
      await writeFile(`${output}.tmp`, wrap(compiled), 'utf8')
      await rename(`${output}.tmp`, output)
    })
  },
}

const common = {
  entryPoints: [resolve(root, 'src', 'client', 'index.tsx')],
  outfile: temporary,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: false,
  legalComments: 'none',
  // React and the DSH client packages are supplied by the shell's module table.
  // Bundling any of them would create a second instance — a second React breaks
  // hooks, and a second slot registry would register into a store nobody reads.
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  plugins: [wrapPlugin],
}

if (process.argv.includes('--watch')) {
  const ctx = await context(common)
  await ctx.rebuild()
  await ctx.watch()
  console.log(`watching src/client -> ${output} (wrapped)`)
} else {
  await build(common)
  console.log(`built ${output}`)
}
