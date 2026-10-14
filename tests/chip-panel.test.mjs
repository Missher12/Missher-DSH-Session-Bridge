/**
 * Behaviour tests for the header identity chip and its overlay panel.
 *
 * These drive the shipped client bundle through the real React renderer and a
 * real DOM (jsdom), so the assertions are about what the control does —
 * measured cap, scrollable id region, panel copy paths, Escape and outside
 * press — rather than about the text of the stylesheet.
 *
 * React, react-dom and jsdom are development inputs of the Harness checkout
 * this plugin is built against, not dependencies of the plugin. They are
 * resolved from a checkout when one is available and the file skips otherwise,
 * so a plain `pnpm test` in a bare clone stays green.
 *
 * Set DSH_SDK_CHECKOUT to an unpacked Harness checkout to force resolution.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

/** Candidate checkouts that carry a workspace-linked React and jsdom. */
const CANDIDATES = [
  process.env.DSH_SDK_CHECKOUT,
  // Sibling checkouts of this repository, which is how the development
  // environment keeps the Harness source it builds against.
  ...ancestors(resolve(import.meta.dirname, '..'), 3).flatMap(root => [
    resolve(root, 'desktop-upgrade/source'),
    resolve(root, 'source'),
  ]),
].filter(candidate => typeof candidate === 'string' && candidate.length > 0)

/** The directory and its nearest ancestors, closest first. */
function ancestors(from, count) {
  const found = []
  let current = from
  for (let step = 0; step <= count; step += 1) {
    found.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return found
}

/** Resolve the whole test toolchain from one checkout, or `null`. */
function resolveToolchain() {
  for (const checkout of CANDIDATES) {
    const anchor = resolve(checkout, 'packages/client/ui-primitives/package.json')
    if (!existsSync(anchor)) continue
    try {
      const require = createRequire(anchor)
      return {
        checkout,
        React: require('react'),
        jsxRuntime: require('react/jsx-runtime'),
        createRoot: require('react-dom/client').createRoot,
        JSDOM: require('jsdom').JSDOM,
      }
    } catch {
      // Try the next candidate: a checkout without a built workspace link is
      // simply not usable for this file.
    }
  }
  return null
}

const toolchain = resolveToolchain()
const SKIP = toolchain === null
  ? 'no Harness checkout with React and jsdom is resolvable; set DSH_SDK_CHECKOUT'
  : false

const source = readFileSync(new URL('../lib/client/index.js', import.meta.url), 'utf8')

const FULL_ID = 'session-12345678-1234-5678-90ab-1234567890ab'
const LONG_CWD = '/Users/someone/a-rather-long-working-directory/that-keeps-going/projects/demo'

/**
 * Load the shipped bundle into a sandbox wired to one stage's realm.
 *
 * The bundle reads `document`, `window` and `navigator` when it renders, so the
 * sandbox has to expose the stage's real window and document. A separate
 * sandbox window would leave the components rendering into a document nothing
 * else can see, which is how a "passing" geometry test can prove nothing.
 *
 * @param stage - the stage whose realm the bundle should run in.
 * @returns the plugin exports, plus the module ids it resolved.
 */
function loadPlugin(stage) {
  let plugin
  const requested = []
  const { window } = stage
  // The loader must exist before the bundle runs: the bundle calls it at load.
  window.__ModuleLoader__ = {
    load({ factory }) {
      plugin = factory(id => {
        requested.push(id)
        if (id === 'react') return toolchain.React
        if (id === 'react/jsx-runtime') return toolchain.jsxRuntime
        // Sibling cells use the primitives package; the identity control and its
        // panel must not, which is what the callers here exercise.
        if (id === '@deepseek-ai/dsh-client-ui-primitives') {
          return { Button: () => null, Menu: () => null, Modal: () => null }
        }
        throw new Error(`Unapproved runtime import: ${id}`)
      })
    },
  }
  runInNewContext(source, {
    fetch,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Response,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    navigator: window.navigator,
    document: window.document,
    getComputedStyle: window.getComputedStyle.bind(window),
    ResizeObserver: window.ResizeObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    // The stage's own window, not a copy: the bundle's effects call
    // addEventListener on it and must see the same size and events as ReactDOM.
    window,
  })
  plugin.requestedModules = requested
  return plugin
}

it('links against exactly the three approved runtime module ids', { skip: SKIP }, async () => {
  const stage = createStage()
  try {
    const plugin = loadPlugin(stage)
    assert.deepEqual([...new Set(plugin.requestedModules)].sort(), [
      '@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime',
    ], 'the browser half resolves only the modules the shell already owns')
  } finally {
    await stage.dispose()
  }
})

/**
 * The geometry jsdom cannot compute, supplied as a controlled model.
 *
 * jsdom has no layout engine: `getBoundingClientRect` returns zeros and
 * `clientWidth` is always 0. So these tests do not claim to test layout, and the
 * plugin's stylesheet is never installed here — class names are selectors, never
 * evidence that a CSS rule applies. What is under test is what the control does
 * with its measurement *inputs*: the flex-grow cluster's content edge, the
 * clipping band's edge, and where the control sits.
 */
function layoutModel({ clusterRight = 471, clipRight = 600, left = 310 } = {}) {
  return { clusterRight, clipRight, left }
}

/**
 * One jsdom stage shared by every component a test mounts.
 *
 * The chip and its panel must observe the same document for outside presses and
 * document-level Escape, so a stage installs one window for the duration and
 * mounts any number of components into it.
 *
 * @param options - `clippingWidth` wraps the mount point in an `overflow:
 * hidden` band whose `clientWidth` and right edge both report that width;
 * `layout` supplies the rect model above; `displayContentsWrapper` inserts a
 * box-less wrapper between the band and the mount point.
 */
function createStage({ clippingWidth = 600, layout = layoutModel(), displayContentsWrapper = false } = {}) {
  const dom = new toolchain.JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const model = { ...layout, boundary: clippingWidth }

  // Only the edges the measurement reads are modelled: the control's left edge,
  // the flex-grow cluster's content edge, and the clipping band's content edge.
  const rectOf = element => {
    const classes = typeof element.className === 'string' ? element.className.split(/\s+/) : []
    const isRoot = classes.includes('dsh-sbc-root')
    const isCluster = element.hasAttribute?.('data-sbc-cluster')
    const isBand = element.hasAttribute?.('data-sbc-band')
    const right = isCluster ? model.clusterRight : isBand ? model.clipRight : isRoot ? model.clipRight : 0
    const left = isRoot ? model.left : isCluster ? 300 : 0
    const width = Math.max(0, right - left)
    return { top: 60, bottom: 84, left, right, width, height: 24, x: left, y: 60, toJSON() { return this } }
  }
  window.HTMLElement.prototype.getBoundingClientRect = function bounds() { return rectOf(this) }
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    // Deliberately null: `offsetParent`-based arithmetic must not be what makes
    // this work, because a `display: contents` wrapper never appears in it.
    get() { return null }, configurable: true,
  })
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

  const previous = new Map()
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    const value = key === 'window' ? window
      : key === 'document' ? window.document
      : key === 'navigator' ? window.navigator
        : key === 'getComputedStyle' ? window.getComputedStyle.bind(window)
          : key === 'requestAnimationFrame' ? window.requestAnimationFrame.bind(window)
            : key === 'cancelAnimationFrame' ? window.cancelAnimationFrame.bind(window)
              : key === 'IS_REACT_ACT_ENVIRONMENT' ? true
                : window[key]
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }

  const root = window.document.getElementById('root')
  const band = window.document.createElement('div')
  band.setAttribute('data-sbc-band', '')
  band.setAttribute('style', 'overflow-x: hidden; display: flex')
  root.appendChild(band)
  // The budget box: it grows to share free space, so the row's remaining width
  // after the trailing utilities is exactly this box's content edge.
  const cluster = window.document.createElement('div')
  cluster.setAttribute('data-sbc-cluster', '')
  cluster.setAttribute('style', 'flex-grow: 1; flex-shrink: 1; flex-basis: 0; min-width: 0; display: flex')
  band.appendChild(cluster)
  let mountPoint = cluster
  if (displayContentsWrapper) {
    const wrapper = window.document.createElement('div')
    wrapper.setAttribute('style', 'display: contents')
    cluster.appendChild(wrapper)
    mountPoint = wrapper
  }

  const roots = []
  const stage = {
    window,
    document: window.document,
    model,
    band,
    root: mountPoint,
    /** Change the controlled boundary and notify the control the way a resize does. */
    resizeTo({ clusterRight, clipRight, left } = {}) {
      // The control's own left edge moves with the layout too, so these move
      // together rather than being derived from one another.
      if (clusterRight !== undefined) model.clusterRight = clusterRight
      if (clipRight !== undefined) model.clipRight = clipRight
      if (left !== undefined) model.left = left
      window.dispatchEvent(new window.Event('resize'))
    },
    band,
    cluster,
    async mount(component, props) {
      const host = window.document.createElement('div')
      mountPoint.appendChild(host)
      const reactRoot = toolchain.createRoot(host)
      roots.push(reactRoot)
      await toolchain.React.act(async () => { reactRoot.render(toolchain.React.createElement(component, props)) })
      await toolchain.React.act(async () => {})
      return {
        host,
        reactRoot,
        async rerender(next) {
          await toolchain.React.act(async () => { reactRoot.render(toolchain.React.createElement(component, next)) })
          await toolchain.React.act(async () => {})
        },
        async unmount() {
          await toolchain.React.act(async () => { reactRoot.unmount() })
          await toolchain.React.act(async () => {})
        },
      }
    },
    /** Flush React work, then the animation frame the re-measure is scheduled on. */
    async flush() {
      await toolchain.React.act(async () => {})
      await new Promise(resolve => window.requestAnimationFrame(() => { resolve() }))
      await toolchain.React.act(async () => {})
    },
    async dispose() {
      for (const reactRoot of roots.reverse()) {
        await toolchain.React.act(async () => { reactRoot.unmount() })
      }
      for (const [key, descriptor] of previous) {
        if (descriptor === undefined) delete globalThis[key]
        else Object.defineProperty(globalThis, key, descriptor)
      }
      dom.window.close()
    },
  }
  return stage
}

/** A clipboard that records what it was asked to write. */
function recorder() {
  const written = []
  return { written, writeText: async text => { written.push(text) } }
}

const renderChipAndPanel = async (stage, { sessionId = FULL_ID, cwd = LONG_CWD, slice } = {}) => {
  const plugin = slice ?? loadPlugin(stage)
  const chip = plugin.createChipPanelActions()
  const chipCell = await stage.mount(plugin.SessionIdChip, {
    sessionId, chip, useSessions: select => select({ byId: { [sessionId]: { cwd } } }),
  })
  const panelCell = await stage.mount(plugin.ChipPanelOverlay, { chip })
  return { plugin, chip, chipCell, panelCell }
}

it('renders the complete session id on one line with a keyboard-reachable scroll region', { skip: SKIP }, async () => {
  const stage = createStage()
  try {
    const { chipCell } = await renderChipAndPanel(stage)
    const id = chipCell.host.querySelector('.dsh-sbc-chipId')
    assert.ok(id, 'the chip renders an id region')
    assert.equal(id.textContent, FULL_ID, 'every character of the durable id is rendered')
    assert.doesNotMatch(id.textContent, /…/, 'no ellipsis is applied to the visible id')
    assert.equal(id.getAttribute('tabindex'), '0', 'the scrollable region is its own tab stop')
    assert.equal(id.getAttribute('role'), 'group')
    assert.equal(id.getAttribute('title'), FULL_ID)
    assert.equal(id.getAttribute('aria-label'), `Full session ID: ${FULL_ID}. Use the left and right arrow keys to scroll.`)
  } finally {
    await stage.dispose()
  }
})

it('budgets against the flex-grow cluster, not the clipping edge', { skip: SKIP }, async () => {
  // Measured 600px layout: the cluster's budget ends at 471 while the band's
  // clip edge is 600. The trailing utilities live between them, so capping to
  // 600 is what let the control run underneath them.
  const stage = createStage({ layout: layoutModel({ clusterRight: 471, clipRight: 600, left: 310 }) })
  try {
    const { chip } = await renderChipAndPanel(stage)
    const root = stage.document.querySelector('.dsh-sbc-root')
    assert.equal(root.style.maxInlineSize, '160px', 'the cluster budget 471 minus the control at 310 leaves 160')
    assert.equal(chip.getSnapshot().available, 160)
  } finally {
    await stage.dispose()
  }
})

it('takes the tighter of the cluster budget and the clipping edge', { skip: SKIP }, async () => {
  // A clip edge inside the cluster must win: the control is clipped there first.
  const stage = createStage({ layout: layoutModel({ clusterRight: 600, clipRight: 420, left: 310 }) })
  try {
    const { chip } = await renderChipAndPanel(stage)
    assert.equal(stage.document.querySelector('.dsh-sbc-root').style.maxInlineSize, '109px', 'the clip edge 420 wins over the cluster 600')
    assert.equal(chip.getSnapshot().available, 109)
  } finally {
    await stage.dispose()
  }
})

it('follows the cluster budget outward again when the window widens', { skip: SKIP }, async () => {
  const stage = createStage({ layout: layoutModel({ clusterRight: 471, clipRight: 600, left: 310 }) })
  try {
    const { chip } = await renderChipAndPanel(stage)
    const root = stage.document.querySelector('.dsh-sbc-root')
    assert.equal(root.style.maxInlineSize, '160px')
    // Widen: the budget moves right, so the cap must grow with it. Nothing here
    // derives from the previous cap, which is what makes this recoverable.
    await toolchain.React.act(async () => { stage.resizeTo({ clusterRight: 989, clipRight: 1280, left: 310 }) })
    await stage.flush()
    assert.equal(root.style.maxInlineSize, '678px', 'the widened budget is 989 minus the control at 310')
    assert.equal(chip.getSnapshot().available, 678)
    // And back: the cap tightens again onto the narrower budget.
    await toolchain.React.act(async () => { stage.resizeTo({ clusterRight: 471, clipRight: 600, left: 310 }) })
    await stage.flush()
    assert.equal(root.style.maxInlineSize, '160px', 'the cap returns to the narrow budget')
  } finally {
    await stage.dispose()
  }
})

it('finds the budget through a display: contents wrapper that offsetParent never reports', { skip: SKIP }, async () => {
  const stage = createStage({ displayContentsWrapper: true, layout: layoutModel({ clusterRight: 471, clipRight: 600, left: 310 }) })
  try {
    const { chip } = await renderChipAndPanel(stage)
    assert.equal(stage.document.querySelector('.dsh-sbc-root').style.maxInlineSize, '160px', 'the cluster budget is found through the box-less wrapper')
    assert.equal(chip.getSnapshot().available, 160)
  } finally {
    await stage.dispose()
  }
})

it('scrolls only the id region with the arrow keys and leaves Enter and Space to the copy button', { skip: SKIP }, async () => {
  const stage = createStage()
  try {
    const { chipCell } = await renderChipAndPanel(stage)
    const { window } = stage
    const id = chipCell.host.querySelector('.dsh-sbc-chipId')
    Object.defineProperty(id, 'scrollWidth', { value: 400, configurable: true })
    Object.defineProperty(id, 'scrollLeft', { value: 0, writable: true, configurable: true })
    const press = key => {
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      id.dispatchEvent(event)
      return event
    }
    assert.equal(press('ArrowRight').defaultPrevented, true)
    assert.equal(id.scrollLeft, 24, 'ArrowRight advances the id region')
    press('ArrowRight')
    assert.equal(id.scrollLeft, 48)
    press('ArrowLeft')
    assert.equal(id.scrollLeft, 24)
    // End and Home are absolute bounds: a browser clamps them, so they land on
    // the true ends from anywhere in the scroll range.
    press('End')
    assert.ok(id.scrollLeft >= 400, 'End reveals the tail of the id')
    press('Home')
    assert.equal(id.scrollLeft, 0, 'Home returns to the head of the id')
    // Enter and Space must reach the enclosing copy button rather than being
    // swallowed by the scroll region.
    assert.equal(press('Enter').defaultPrevented, false, 'Enter is left to the copy button')
    assert.equal(press(' ').defaultPrevented, false, 'Space is left to the copy button')
  } finally {
    await stage.dispose()
  }
})

it('opens the panel from the caret and closes it on Escape with focus returned', { skip: SKIP }, async () => {
  const stage = createStage()
  const clipboard = recorder()
  Object.defineProperty(stage.window.navigator, 'clipboard', { value: clipboard, configurable: true })
  try {
    const { chip, chipCell, panelCell } = await renderChipAndPanel(stage)
    const { window, document } = stage
    const caret = chipCell.host.querySelector('.dsh-sbc-caret')
    assert.equal(caret.getAttribute('aria-expanded'), 'false')
    await toolchain.React.act(async () => { caret.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await stage.flush()
    assert.equal(chip.getSnapshot().open, true, 'the caret opens the shared panel state')
    assert.equal(chipCell.host.querySelector('.dsh-sbc-caret').getAttribute('aria-expanded'), 'true')
    assert.ok(panelCell.host.querySelector('.dsh-sbc-panel'), 'the panel renders from the overlay cell')

    // The panel shows the trimmed bridge reference but copies the exact payload.
    const values = [...panelCell.host.querySelectorAll('.dsh-sbc-rowValue')].map(node => node.textContent)
    assert.deepEqual(values, [FULL_ID, LONG_CWD, `/bridge ${FULL_ID}`], 'the displayed bridge reference carries no trailing space')
    for (const field of ['id', 'cwd', 'bridge']) {
      const button = panelCell.host.querySelector(`.dsh-sbc-row[data-field="${field}"] .dsh-sbc-rowCopy`)
      assert.ok(button, `the ${field} row carries its own copy affordance`)
      await toolchain.React.act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
      await stage.flush()
    }
    assert.deepEqual(clipboard.written, [FULL_ID, LONG_CWD, `/bridge ${FULL_ID} `], 'the copied bridge payload keeps its trailing space')

    const focused = []
    chipCell.host.querySelector('.dsh-sbc-caret').focus = () => { focused.push('caret') }
    const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(escape)
    await stage.flush()
    assert.equal(chip.getSnapshot().open, false, 'Escape closes the panel')
    assert.equal(escape.defaultPrevented, true)
    assert.deepEqual(focused, ['caret'], 'focus returns to the control that opened the panel')
  } finally {
    await stage.dispose()
  }
})

it('dismisses the panel on an outside press but keeps it open for a press inside it', { skip: SKIP }, async () => {
  const stage = createStage()
  try {
    const { chip, chipCell, panelCell } = await renderChipAndPanel(stage)
    const { window, document } = stage
    await toolchain.React.act(async () => { chip.setOpen(true) })
    await stage.flush()
    const panel = panelCell.host.querySelector('.dsh-sbc-panel')
    assert.ok(panel, 'the panel renders through the overlay cell, not inside the header')

    panel.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
    await stage.flush()
    assert.equal(chip.getSnapshot().open, true, 'a press inside the panel keeps it open')
    chipCell.host.querySelector('.dsh-sbc-chip').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
    await stage.flush()
    assert.equal(chip.getSnapshot().open, true, 'a press on the chip keeps it open')
    document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
    await stage.flush()
    assert.equal(chip.getSnapshot().open, false, 'a press elsewhere dismisses the panel')
  } finally {
    await stage.dispose()
  }
})

it('positions the panel as a fixed overlay clamped inside the viewport', { skip: SKIP }, async () => {
  const stage = createStage()
  try {
    const { chip, panelCell } = await renderChipAndPanel(stage)
    await toolchain.React.act(async () => { chip.setOpen(true) })
    await stage.flush()
    const panel = panelCell.host.querySelector('.dsh-sbc-panel')
    assert.ok(panel, 'the panel is mounted')
    assert.equal(panel.style.position, 'fixed', 'fixed positioning is what leaves the header clipping context')
    const left = Number.parseFloat(panel.style.left)
    assert.ok(left >= 12, `the panel keeps a viewport margin, got left=${panel.style.left}`)
    assert.ok(left + Number.parseFloat(panel.style.width) <= stage.window.innerWidth - 11, 'the panel stays inside the right edge')
    assert.ok(Number.parseFloat(panel.style.maxHeight) >= 0)
  } finally {
    await stage.dispose()
  }
})

it('retracts only its own registration when the header control unmounts', { skip: SKIP }, async () => {
  const stage = createStage()
  try {
    const plugin = loadPlugin(stage)
    const chip = plugin.createChipPanelActions()
    const first = await stage.mount(plugin.SessionIdChip, { sessionId: FULL_ID, chip, useSessions: select => select({ byId: {} }) })
    const second = await stage.mount(plugin.SessionIdChip, { sessionId: 'session-second', chip, useSessions: select => select({ byId: {} }) })
    await stage.flush()
    assert.equal(chip.getSnapshot().sessionId, 'session-second', 'the newest control owns the shared registration')
    const firstAnchor = first.host.querySelector('.dsh-sbc-root')
    // Unmounting the stale control must not clear the current owner.
    chip.release(firstAnchor)
    assert.equal(chip.getSnapshot().sessionId, 'session-second', 'a foreign anchor is not released')
    // Unmounting the owner does clear it, and closes any open panel with it.
    chip.setOpen(true)
    chip.release(second.host.querySelector('.dsh-sbc-root'))
    assert.equal(chip.getSnapshot().sessionId, '', 'the owner retracts its own registration')
    assert.equal(chip.getSnapshot().anchor, null)
    assert.equal(chip.getSnapshot().open, false, 'the panel closes rather than anchoring to a detached node')
  } finally {
    await stage.dispose()
  }
})

it('closes the panel and forgets the id when the header control actually unmounts', { skip: SKIP }, async () => {
  const stage = createStage()
  try {
    const { chip, chipCell, panelCell } = await renderChipAndPanel(stage)
    await toolchain.React.act(async () => { chip.setOpen(true) })
    await stage.flush()
    assert.ok(panelCell.host.querySelector('.dsh-sbc-panel'), 'the panel is open before the header unmounts')
    await chipCell.unmount()
    await stage.flush()
    assert.equal(chip.getSnapshot().sessionId, '', 'the unmounted control leaves no stale id')
    assert.equal(chip.getSnapshot().cwd, undefined, 'and no stale working directory')
    assert.equal(panelCell.host.querySelector('.dsh-sbc-panel'), null, 'the panel stops rendering against a detached anchor')
  } finally {
    await stage.dispose()
  }
})
