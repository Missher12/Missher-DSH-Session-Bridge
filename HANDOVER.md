2026-09-28 协调审查：本轮不改生产、不重启、不重建日常 lib、不覆盖包、不执行 Git 写入。插件基线为 0.1.2 / `c9ee52c3c7ac4ddb2cb3274d1089862a817c63b6`；宿主 33 项既有变更逐项匹配历史独立补丁。本轮隔离回归、当前安装状态和未验收层见[会话桥接回执](/Users/missher/Documents/Deepseek-harness-Cordis/coordination/2026-09-28/session-bridge.md)。下方现场修复中的进程、端口、active 状态均为当时证据；当前进程已变，本轮认证状态接口返回 401，未重新确认 active。旧版问题清单与命令保留作历史，不覆盖本轮边界。

2026-09-28 现场启用故障已修复：安装 0.1.2 tgz 后，正式 `session-bridge` 与旧 `session-bridge-dev` 同时启用，造成 `session_list` 重复注册。已备份并从生产 profile 撤销改名行及源码 lib 监听，分两步排空旧实例后启用正式组件；当前真实宿主仅一行，`enabled=true`、`fiberPhase=active`，受鉴权的 scratch GET 正常。194 个其他组件状态、工作区存储与包清单/锁文件均不变，桌面未重启。当前是 tgz 安装，修改工程源码不会更新现用插件。证据见 `/Users/missher/Documents/Deepseek-harness-Cordis/bridge-duplicate-registration-20260927/`。

2026-09-27 选择器修复（0.1.2）：生产数据只有一个 `/private/tmp/dsh-scratch` 工作区，含 3 个会话；重复来自新会话菜单的已有工作区行和底部快捷入口。插件通过受鉴权的只读 GET 查询固定目录对应 ID，在该工作区已列出时隐藏快捷入口；保留改名，不按标题判断。只改插件，未更改宿主或生产数据；验收证据在 `/Users/missher/Documents/Deepseek-harness-Cordis/scratch-picker-dedup-20260927/`。

2026-09-27 后续需求：用户明确选择「删除聊天记录，点击后再确认」。0.1.1 增加三点菜单复制、归档删除确认及宿主删除接口；工作区标题栏归档按钮采用上游最小修改。当前进展与验证以 SESSION_ACTIONS.md 为准，下方是此前 12 项分诊的历史背景。生产 profile 与 app.asar 未改，原生界面仍未签收。

# dsh-session-bridge — 交接文档

2026-09-27 接管确认：样式 owner 修复已正式纳入 Bridge 的补丁、常规回归和独立交付。`pnpm run check` 现为 31 条；Bridge 自己的 `scripts/check-style-ownership.mjs` 用已装 app.asar 的模块系统、真实 Cordis Loader/Entry 和独立夹具验证双向样式隔离。维护与打包边界见 `PLUGIN_BOUNDARIES.md`；上下文任务不再写 Bridge。本轮不扩大宿主修改，不改运行中 profile，原生 Electron 点击仍未核验。

2026-09-27 样式修复补充：`src/client/index.tsx` 已为 effect 注入的 style 加 `data-plugin="dsh-session-bridge"` / `data-plugin-css`，防止 DSH 0.1.7-rc.2 将其认领到后来加载的插件并在后者卸载时删掉。13:25 的后续本地构建已含此修复和并行工作的 HTTP 改动；上下文任务的旧快照桥接安装包仅作隔离验证证据，不应用它覆盖本项目。证据、原文件备份和补丁位于 `/Users/missher/Documents/Deepseek-harness-Cordis/dsh-context-manager/verification/style-ownership/`。后续构建应保留这个归属标记；原生窗口的最终视觉状态尚未直接检查。

给接手的人（或模型）：这份文档自成一体，不需要之前的对话上下文。目标是把**设计与遇到的每个问题**讲清楚，并区分「属于 DSH 上游、应该去改 DSH」和「属于本插件、可以就地改」两类。

- **插件包名**：`dsh-session-bridge`（v0.1.0）
- **Cordis 插件名**：`session-bridge`
- **工程路径**：`~/Documents/Projects/04-Harness-Plugins/dsh-session-bridge/`
- **DSH 源码**：`~/Documents/Deepseek- Harness-Inter/`（monorepo，注意目录名里 `Deepseek-` 后面有个空格）
- **DSH 版本**：0.1.7-rc.2，桌面 profile 跑在 Electron 里，GUI 在 `http://127.0.0.1:50843`
- **平台**：macOS（Intel），这一点在「问题 6」里很关键

---

## 1. 这个插件做什么

两件事：

1. **跨会话沟通**：人在某个会话里能拿到自己的会话 ID，另一个会话能按这个 ID 给它发消息、读它的对话。
2. **在临时目录里干活**：不想在默认工作区里做实验时，能直接在「新会话」界面选一个一次性目录。

## 2. 架构

### 2.1 零运行时依赖（刻意的）

插件**不在运行时 import 任何 `@deepseek-ai/dsh-*` 包**。每项能力都通过 Cordis 交给它的 `ctx` 获取，形状在 `src/dsh.ts` 里结构化声明。整份客户端 bundle 运行时只 `require` 三个：

```
react
react/jsx-runtime
@deepseek-ai/dsh-client-ui-primitives   ← 这是 shell 的 static module，见问题 10
```

理由：不会出现第二份 `dsh-session`、第二个 React 实例、第二套 slot registry；装机不需要解析依赖；不和宿主版本锁步。

**代价**：所有服务签名都是手写的结构类型，DSH 升级时不会编译报错，只会在运行时炸。这是这个设计最大的长期风险，接手时请知悉。

### 2.2 宿主半边（`src/*.ts`，`tsc` → `lib/*.js`）

| 文件 | 职责 |
|---|---|
| `dsh.ts` | 宿主服务的结构签名 + `service()`（不会抛的安全取用，见问题 1） |
| `catalog.ts` | 会话发现、引用解析（ID / 标题 / 唯一前缀）、转写投影 |
| `delivery.ts` | 跨会话投递、冷会话唤醒 |
| `message.ts` | 桥接消息信封与 `source.kind = 'session-bridge'` |
| `scratch.ts` | 临时目录与临时会话 |
| `tools.ts` | 四个模型工具 |
| `commands.ts` | 四条人类命令 |
| `prompt.ts` | 每会话的系统提示段落 |
| `index.ts` | 插件入口、`Config`（手写 Standard Schema，不依赖 Schemastery） |

**模型侧工具**：`session_list` / `session_read` / `session_send` / `session_scratch`
**人类侧命令**：`/sessions`、`/scratch`、`/bridge`、`/scratch-clean`

跨会话投递的核心：

```
目标存活   → ctx.agents.get(id).steer(msg)     // mode: steer（默认）
                                          .followup(msg)  // mode: turn
目标已冷   → ctx.sessionController.create({ sessionId, cwd })  // 走 GUI「新会话」同一条路
             → ctx.agents.get(id).steer/followup
```

`steer` 在对方最近的步骤边界插入，对方空闲时开新回合；`turn` 始终排一个独立新回合。这个「两个动词」的区分是照 Codex 的 `send_message`（"Does not trigger a new turn"）/ `followup_task` 抄的。

### 2.3 客户端半边（`src/client/*.tsx`，esbuild → `lib/client/index.js`）

**a) 会话头部「复制会话 ID」芯片** — 占 `conversation.session.header.actions`（list slot，order 0）。

收起时显示短 ID（`af569227…791a`），点一下把**完整 ID** 写进剪贴板；caret 展开一个面板，三行各自可复制：会话 ID、工作目录、`/bridge <id> ` 前缀。

**b) 「新会话」里的「不在工作区」行** — 占 `conversation.hero.workspace`（single slot，**priority -1** 覆盖自带）。见问题 4/5/6/7，这是整个插件里最脏的一块。

---

## 3. 问题清单

### A 类：属于 DSH 上游

---

#### 问题 1 — 访问未 `inject` 的服务会**抛异常**而不是返回 `undefined`

**现象**：插件激活直接失败。
```
Error: cannot get property "commands" without inject
    at service (…/lib/dsh.js:17:23)
```
同一个坑我踩了两次（`commands`、`sessions`）。

**根因**：Cordis 的 Context 代理对未声明的服务抛错。`ctx.get(name)` 不抛，但 `ctx.name` 抛。

**现在的绕过**：`src/dsh.ts` 的 `service()` 两条路都包 `try/catch`：

```ts
export function service<T>(ctx: HostContext, name: string): T | undefined {
  try { const viaGet = ctx.get?.(name); if (viaGet != null) return viaGet as T } catch {}
  try { const direct = (ctx as Record<string, unknown>)[name]; if (direct != null) return direct as T } catch {}
  return undefined
}
```
所有可选服务都必须走它（`sessionControllerOf` / `sessionQueryOf` / `sessionsOf` / `commandsOf` / `systemPromptOf` / `workspaceRegistryOf`）。**新增任何服务访问都必须走这里，否则插件会整个激活失败**——而且失败点在 `apply` 里，表现是「插件完全没反应」，很难查。

**建议**：DSH 是否该让 `ctx.name` 对未注入的服务返回 `undefined`？或至少在错误信息里给出「你是插件 X，你 inject 了 […]」的提示。

---

#### 问题 2 — `client-modules` **永久缓存**「这个包没有 `dsh.client`」的负面结果

**现象**：给一个**已经装好**的插件补上客户端半边后，本进程内**永远不被发现**。停用/启用 bundle、改 package.json 都没用。

**根因**：`packages/client/modules/src/index.ts` 的 `resolveMeta()`：

```ts
private sourceKey(loaderName: string, baseUrl: string): string {
  return `${baseUrl}\0${loaderName}`          // :934
}

private resolveMeta(loaderName: string, baseUrl: string): ResolvedPkgMeta | null {
  const sourceKey = this.sourceKey(loaderName, baseUrl)
  const cached = this.pkgMeta.get(sourceKey)
  if (cached !== undefined) return cached       // 命中即返回，null 也会命中
  …
  if (decl === undefined || decl.platform !== 'web') {
    this.pkgMeta.set(sourceKey, null)           // :831  负面结果被永久钉死
    return null
  }
  …
}
```

模块头注释自陈：**"Scanning is incremental per package — there is no full-rescan code path."** 而 `pkgMeta` 的生命周期是整个进程。

**影响**：任何「先出宿主半边、后加浏览器半边」的开发流程都会撞上，且几乎无法自查（插件在 boot graph 里就是不出现，没有任何日志）。

**我确认它的方法**（值得保留为排查手段）：`/plugins/events` 是**免鉴权**的 SSE（`EventSource` 发不了 header），能直接读到客户端 boot graph：

```sh
curl -N -H 'Accept: text/event-stream' http://127.0.0.1:50843/plugins/events
# → data: {"type":"graph","graph":{"rev":"…","entries":[{"id":"…","url":"plugins/??…/client.js&rev=…",…}]}}
```

对比 `dsh-reasoning-effort` / `@missher/dsh-usage-statistics`（都是 `link:` 的本地插件、都有 `dsh.client`）在、我的不在，就定位到了。

**现在的绕过**：给 loader row **换名字**，让 `sourceKey` 失效（见 §4）。

**建议的修法**（这是我认为最值得上游改的一条）：`pkgMeta` 的负面结果不该在 loader row 重建后继续有效。可选：
- 不缓存负面结果；
- 缓存 key 带上 package.json 的 mtime/size；
- 监听 loader entry 变化时清掉对应 key。

---

#### 问题 3 — 桌面 profile 把模块监听全关了（`hmr.root: []`）

**现象**：改完 `lib/` 后宿主一直吃 Node 缓存的旧模块，`set_bundle` 停用/启用也没用（同一个 URL 不会重新 import）。

**根因**：桌面 profile（`profiles/desktop/cordis.yml` 第 9-13 行）里的 hmr row：
```yaml
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: !!js '!ctx.get(''profileContext'')'
  config:
    root: []            # ← 一个模块都不监听
```
`HmrConfig.root` 默认是 `['.']`，桌面 profile 显式清空了。

**现在的绕过**：在 profile patch 里加了一段监听本插件 `lib/` 的配置（见 §4）。

**建议**：桌面 profile 是否该自动监听 `link:` 进来的本地插件目录？开发插件时「改完必须重启应用」是很重的摩擦。

---

#### 问题 4 — 「新会话」英雄区**没有任何插件扩展点**

**现象**：想在工作区选择器里加一行，无路可走。

**根因**（三件事叠在一起）：

1. 英雄区四个 slot **全是 `single`**，且都被 DSH 自己占了：

| slot | 状态 |
|---|---|
| `conversation.hero.workspace` | 被自带 `WorkspacePicker` 占 |
| `conversation.hero.workspace.directoryFlow` | 被 `ui-directory-picker-native` 占 |
| `conversation.hero.agentPreset` | 被 agent 预设控件占 |
| `conversation.hero.brand.mark` | 空着，但那是标题前**会游泳的鲸鱼 logo**（`HeroShell` 里带 hover 形变 SMIL 动画） |

2. **`single` 槽位无法「包一层」**。理论上 `StoredEntry.component` 是暴露的（`ui-slots/src/index.ts:841`），能拿到自带组件再套壳。但自带 `WorkspacePicker` 需要 `renderSlot('conversation.hero.workspace.directoryFlow', …)`，而这个 `renderSlot` 是渲染机制**根据条目自己的 `children` 声明**合成的。于是必须声明 `children`：

```ts
// packages/client/ui-slots/src/index.ts:1245
if (childRec?.spec) {
  throw new Error(`slot "${childKey}" is already declared (by ${childRec.declaredBy ?? 'an unknown entry'})`)
}
```

**影子化不会注销被影子的条目**（single 占位检查在 `:1218`，只按 priority 判冲突，旧条目仍在 `rec.entries` 里），所以这个子 slot 已经被声明过，重声明必抛。

3. 没有 list 座，所以也加不进去。

**结果**：我**复刻**了整个选择器（`src/client/ScratchWorkspacePicker.tsx`，约 180 行，照 `packages/client/ui-workspace/src/client/WorkspacePicker.tsx` 写），在 `priority: -1` 覆盖自带的（`single` 槽位**最低 priority 渲染**）。

**代价**：DSH 升级改动自带 picker 时，我这份不会跟着变。它现在丢掉了「目录流 hole」那层间接，改成直调 `uiWorkspace.pickDirectory()`（也就是 native occupant 本来用的东西，行为等价）。

**建议的修法**（按推荐度）：
- 给英雄区加一个 list slot，例如 `conversation.hero.workspace.actions`，让插件往选择器里加入口；
- 或者把 `directoryFlow` 改成 list；
- 或者允许子 slot 重声明（后声明覆盖先声明，配合影子化语义）。

---

#### 问题 5 — **没有工作区的新会话是「惰性」的，输入框禁用**

**现象**：纯临时目录、不注册工作区的会话能建出来，但界面显示「选择一个工作区开始」，**打不了字**。

**根因**（两处配合）：

```ts
// packages/api/session-controller/src/list.ts:49
const blank = state.blank && event.type !== 'turn/start'
```
```ts
// packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx:141
const inert = sessionId === undefined || (hero && chipTitle === undefined)
```

`blank` 只在 `turn/start` 时清除；新会话在用户打第一个字之前必然是 blank → `hero === true`。而 `chipTitle` 在「工作区列表已就绪、但该会话没有归属工作区」时是 `undefined`（`ConversationContent.tsx` 里那段注释的第 5 种情况）。

**合起来**：`turn/start` 需要用户先输入，输入需要 `chipTitle`，`chipTitle` 需要工作区。**死锁。**

**这就是「不在工作区」做不到的原因。** 我的实现只能退让成「注册一个工作区，但只有一个、名字叫『不在工作区』」。

**建议**：带合法 `cwd`、但没有归属工作区的会话，是否应该照常可用（显示 cwd 目录名而不是占位符）？「未分组」这个概念在侧边栏里已经存在了，但它对应的会话恰恰是不能开始新对话的那种——这个组合有点反直觉。

---

#### 问题 6 — `directoryPicker.createDirectory` 依赖 **browse** 能力，本部署装的是 **native**

**现象**：
```
directory browse failed: directory-picker/unavailable:
directoryPicker/createDirectory needs the browse capability; the composed picker serves "native"
```

**根因**：`uiWorkspace.createDirectory()` 转发到 `directoryPicker/createDirectory`，而这个能力只在 `@deepseek-ai/dsh-client-ui-directory-picker-browse` 那一侧存在。本 profile 的 boot graph 里目录选择器只有 `@deepseek-ai/dsh-client-ui-directory-picker-native`。

**后果**：客户端**没有任何能力中立的途径**在宿主上建目录。唯一会隐式建目录的调用是 `session.create({ cwd })`：

```ts
// packages/api/session-controller/src/agent.ts:481
await mkdir(cwd, { recursive: true })
```

**现在的绕过**：靠建会话顺带建目录（并因此引出问题 7）。

**建议**：暴露一个能力中立的 `ensureDirectory(path)` remote（native/browse 都能实现），或把「建会话顺带建目录」这件事明确成公开契约。

---

#### 问题 7 — 路径规范化不一致导致 `session/conflict`

**现象**：
```
session create failed: session/conflict:
session "session-…" belongs to "/tmp/dsh-session-olPaOM", not "/private/tmp/dsh-session-olPaOM"
```

**根因**：工作区注册会对路径做 `realpath`（macOS 上 `/tmp` 是 `/private/tmp` 的符号链接，`packages/workspace/workspace/src/index.ts` 用 `realpathNormalize`），而 `session.create({ cwd })` 存的是**字面拼写**。于是：

- 用 `/tmp/xxx` 建目录的那个会话，`header.cwd === '/tmp/xxx'`；
- 拥有该目录的工作区，`path === '/private/tmp/xxx'`；
- 想用 `session.create({ sessionId, workspaceId })` 把它挂上去 → `ensureSession` 比对 cwd 不相等 → 冲突。

**后果**：**「建目录的那个会话」永远不可能同时是「工作区拥有的那个会话」**，只能丢掉。

**现在的绕过**：建目录用一次性会话 → 注册工作区 → **归档那个一次性会话** → 让 owner 自己的 `onPick` 开工作区真正的空白会话。四次调用，干净但绕。

**建议**：`ensureSession` 的 cwd 比对是否该规范化两侧？或者 `session.create` 的 cwd 就该存 realpath。

---

#### 问题 8 — `workspace.create` 不收标题

```ts
// packages/api/workspace-controller/src/types.ts:65
export interface WorkspaceCreateRequest {
  readonly path: string
}
```

底层 `WorkspaceRegistry.create(path, title?)` **是有 title 参数的**，但 remote 把它丢了。源码里还留着 TODO：

```ts
// packages/workspace/workspace/src/index.ts:231
// TODO: `title` lost its last production caller when the gateway's
// create-by-name branch was deleted …
```

**后果**：想让临时目录有个可读名字，必须 `create` 之后再 `rename` 一次。工作区标题默认取路径最后一段，所以随机目录名会直接变成侧边栏项目名——这正是用户抱怨「乱码」的直接来源。

**建议**：把 `title` 加回 `WorkspaceCreateRequest`。

---

#### 问题 9 — pnpm 11 的构建审批死锁

**现象**：`pnpm install` 与**每一条** `pnpm run` 都失败：
```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```
但 esbuild **本身完全可用**（`require('esbuild').version` 正常，平台二进制由 `@esbuild/darwin-x64` optional dep 提供，那个 install script 只是做链接）。

**踩到的三个坑叠加**：
1. `pnpm.onlyBuiltDependencies` 写在 `package.json` 里 **pnpm 11 已经不读了**（会警告 "no longer read by pnpm"），新家在 `pnpm-workspace.yaml`。
2. 即使搬对了地方，`node_modules/.modules.yaml` 里已经记下了 `ignoredBuilds: ["esbuild@0.28.2"]`，仍然报错；`pnpm rebuild esbuild` 也清不掉。
3. `pnpm run` 会先跑 deps 状态检查 → 检查失败 → **任何脚本都跑不了**，`.npmrc` 里的 `verify-deps-before-run=false` 也没生效。

**现在的绕过**：手工编辑 `node_modules/.modules.yaml` 把 `ignoredBuilds` 清空，并把 `onlyBuiltDependencies` 放进 `pnpm-workspace.yaml`。

**建议**：这是 pnpm 的问题，不是 DSH 的。但如果 DSH 要支持插件作者，值得在文档里写一句，或提供一个不依赖 postinstall 的构建脚手架。

---

### B 类：属于本插件

---

#### 问题 10 — `@deepseek-ai/dsh-client-ui-primitives` 是 **static module**，不是插件行

客户端 bundle 里 `require('@deepseek-ai/dsh-client-ui-primitives')` 能工作，但它在 boot graph 的 `entries` 里**不存在**，所以无法从 graph 反推它可用。真相在：

```ts
// packages/client/web/src/seed.ts:24
export function getStaticModules(): Record<string, unknown> {
  return {
    'react': React, 'react/jsx-runtime': ReactJsxRuntime, 'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    '@deepseek-ai/cordis': Cordis,
    '@deepseek-ai/dsh-client-store': ClientStore,
    '@deepseek-ai/dsh-client-ui-slots': UiSlots,
    '@deepseek-ai/dsh-client-ui-primitives': UiPrimitives,   // ← 这个
    '@deepseek-ai/dsh-client-ui-dockkit': UiDockkit,
  } satisfies Record<PlatformModule, unknown>
}
```

**后果**：想用 DSH 自带的 `Menu` / `Modal` / `Button` / 图标，只能靠读源码发现这条路；`dsh.client.inject` 里写它也没意义（它不是行）。

**本插件状态**：已在用（复刻 picker 需要），`scripts/check-client-load.mjs` 里为它加了 stub。

---

#### 问题 11 — 客户端 store 返回形状不一致，只能防御式解包

- `ClientSessions.create(opts)` → **`Promise<SessionId>`**（裸字符串，内部已经拆了 `{ok,value}` 信封）
  `packages/api/session-controller/src/client/sessions/service.ts:431`
- `IWorkspaces.create({path})` → **`Promise<WorkspaceView>`**（对象）

我一开始按对象解包，结果报 `the session.create call returned no value`（而目录其实已经建好了）。

**本插件状态**：`src/client/index.tsx` 里有个 `unwrapField()`，同时接受裸字符串 / `{field}` / `{value:{field}}` / `{ok:false,error}` 四种形状。**这是防御性代码，不是设计**——如果上游能统一形状，这段可以删掉。

---

#### 问题 12 — 客户端 bundle 是**盲写**的，没有类型检查

`src/client/**` 不参与 `tsc`（`tsconfig.json` 里 `exclude: ["src/client"]`），因为要做到类型检查就得装一整套 `@deepseek-ai/dsh-client-ui-*`，与「零运行时依赖」冲突。

**现在的兜底**：`scripts/check-client-load.mjs` 用 stub loader 真实求值一次构建产物，断言 `inject` / `apply` 存在。它抓到过真问题（新增 primitives 依赖时立刻失败），但**它只能抓「加载期抛异常」，抓不到「注册成功但行为错」**——问题 6/7/11 全是靠真实点击才发现的。

**建议**：如果上游能给客户端插件提供 `types` 包（纯 .d.ts，无运行时），这类插件就能类型检查了。

---

## 4. 现在挂在环境里的临时绕过 —— **修好后请撤销**

全部在 `~/Library/Application Support/DeepSeek Harness Intel/harness/profiles/desktop/cordis.patch.yml` 末尾：

```yaml
# 绕过问题 3：桌面 profile 的 hmr.root 是 []
- id: hmr
  config:
    root:
      - '/Users/missher/Documents/Projects/04-Harness-Plugins/dsh-session-bridge/lib'

# 绕过问题 2：client-modules 的负面缓存
- id: session-bridge
  disabled: true
- insert:
    - id: session-bridge-dev
      name: '/Users/missher/Documents/Projects/04-Harness-Plugins/dsh-session-bridge/lib/index.js'
```

备份：`cordis.patch.yml.bak-1790439736`、`cordis.patch.yml.bak2-1790441050`。

**重启 DSH 应用后**，`pkgMeta`（问题 2）清空，这两段都可以删掉，回到 profile package.json 里那个正常的 `dsh-session-bridge` 行。

其他环境改动：
- `profiles/desktop/package.json`：`dsh-session-bridge: link:…` + `dsh.profile.bundles` 里有它（**这个要留**）。
- 插件工程内 `.npmrc` 的 `verify-deps-before-run=false`、`pnpm-workspace.yaml` 的 `onlyBuiltDependencies`（绕过问题 9）。

**残留数据**（我测试造成的，与代码无关）：侧边栏里 6 个一次性项目 `dsh-session-{crXNC6,SZdOHA,Wh9aih,7TsIDr,olPaOM}` 和 `bridge smoke test · dsh-session-LFYnTp`。插件自带的 `/scratch-clean` 可以清：

```
/scratch-clean         # 预览
/scratch-clean yes     # 执行
```
判定是「临时根目录下、且不含任何非空白会话」，有真实对话的临时项目会被保留。

---

## 5. 怎么复现 / 怎么验证

```sh
cd ~/Documents/Projects/04-Harness-Plugins/dsh-session-bridge
pnpm install
pnpm build            # build:host (tsc) + build:client (esbuild + loader 包装 + 自检)
pnpm test             # node --test tests/*.test.mjs  → 22 条
```

测试跑在**假 Host** 上（`tests/bridge.test.mjs` 里实现了 `src/dsh.ts` 声明的完整结构面），覆盖：引用解析、转写投影与截断、`steer`/`turn` 两种投递、冷会话唤醒与拒绝、自投递与超长正文拒绝、临时目录落盘、四条命令（含 `/scratch-clean` 的预览与真删）。

**界面验证**（必须真点，问题 6/7/11 只有真点才发现）：

1. 会话头部 → 点 ID 芯片 → `pbpaste` 应该拿到完整会话 ID
2. 点头部 chip 的 caret → 面板三行各自可复制
3. 侧边栏「新会话」→ 点工作区 chip → 底部应有「✨ 不在工作区（临时目录）…」→ 点它 → 应落在 `/tmp/dsh-scratch`，chip 显示「不在工作区」，**输入框可用**
4. 读客户端 boot graph：`curl -N -H 'Accept: text/event-stream' http://127.0.0.1:50843/plugins/events`，确认 `dsh-session-bridge` 在 `entries` 里且 `rev` 是最新的

---

## 6. 已知未做

- **接收方人工审批**。Codex 与 Claude Code 都把 agent 间消息当成提权面处理（Claude Code 有 `held | denied | expired | delivered` 加异步回执）。本插件只有固定信封声明「这是同伴请求，不是本人指令」，加一个 `wakeColdSessions` 开关。多人共享 Host 时不够。
- **侧边栏会话行的复制入口**。芯片只在当前会话头部；历史会话仍要靠 `/sessions` 命令拿 ID。
- **`SCRATCH_ROOT` 硬编码 `/tmp`**（`src/client/index.tsx`）。macOS/Linux 桌面没问题，Windows 会坏。
- **客户端半边不做 i18n 之外的主题适配测试**。用的是 DSH theme token，理论上跟随明暗主题，但没在暗色下逐项核对过。
