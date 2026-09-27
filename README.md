# dsh-session-bridge

DSH 会话功能插件。两件事：

1. **临时目录会话** —— 会话不必待在默认工作区。`session_scratch` 会在 `/tmp` 下开一个一次性目录（`/tmp/dsh-session-XXXXXX`），要么把新会话的 `cwd` 就放在那里（并注册成独立工作区，侧边栏里像一个普通项目），要么把目录路径交回给当前会话使用。
2. **按会话 ID 跨会话沟通** —— `session_list` / `session_read` / `session_send` 让一个会话找到、读取、并给另一个会话发消息。发出去的消息在对方会话里是一条真实的 user-role 回合，来源标注为发送方，所以两边能来回对话。对方是冷会话时会先按 DSH 自己的 resume 路径唤醒。

## 为什么它零运行时依赖

**宿主半边不运行时导入 DSH 包。** 服务通过 Cordis 的 `ctx` 获取，消费的结构声明在 [`src/dsh.ts`](src/dsh.ts)。浏览器保留既有的三个静态请求：`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`；最后一个是宿主 shell 提供的 static module，也是“不导入任何 DSH 包”这句话原本就存在的例外。插件没有新增 DSH 运行时依赖，`dependencies` 为空；`Config` 继续使用手写 Standard Schema。

开发依赖包含 TypeScript、Node/React 类型、esbuild，以及用于类型检查的 primitives 和 Cordis。它们不会打入客户端 bundle，也不会在宿主入口导入。结构声明仍有版本漂移风险，可用 `node scripts/check-host-contracts.mjs '/path/to/DSH checkout'` 对照已构建 checkout 的正式声明。

## 安装

```sh
cd /Users/missher/Documents/Projects/04-Harness-Plugins/dsh-session-bridge
pnpm install
pnpm build          # 宿主编译 + 客户端严格类型检查、打包和加载自检
```

然后在 profile 里注册（桌面端 profile 已经装好）：

```sh
dsh plugin add link:/Users/missher/Documents/Projects/04-Harness-Plugins/dsh-session-bridge
```

或者手写 `~/.dsh/profiles/<name>/package.json` 的 `dsh.profile.bundles` 加一项 `dsh-session-bridge`。插件自带的 [`cordis.patch.yml`](cordis.patch.yml) 负责挂载行。

宿主模块热更新和客户端 bundle 热更新是两条链路。桌面 `hmr.root: []` 禁止宿主代码监听；开发时可显式监听本插件 `lib/`，或在构建后重启应用。已经进入 boot graph 的客户端 bundle 由 `client-hmr` 独立监听。

DSH 0.1.7-rc.2 原版还会跨 Loader 行重载保留 `dsh.client` 正面/负面元数据缓存。新增客户端声明、调整依赖后，重启进程才可靠；本次提供的上游补丁在 Loader 行事件时失效对应缓存，不会自动监听 package.json。补丁只改源码不会影响正在运行的 app.asar。安装正式 tgz 前必须撤销旧的 `session-bridge-dev` 改名配置，正常的 Bundle 依赖和原始行应保留；两行一起启用会重复注册工具。现场已通过 HMR 分两步完成清理（先禁用正式行并移除开发行，待旧实例释放后启用正式行），无需重启；配置备份和实测记录见 HANDOVER.md。具体命令和本次证据见 [REPAIR_REPORT.md](REPAIR_REPORT.md)。

pnpm 11 的设置在 `pnpm-workspace.yaml`，使用 `allowBuilds.esbuild: true`；不再编辑 `node_modules/.modules.yaml`。本项目锁定 pnpm 11.1.3，宿主 checkout 自己的 11.7.0 不变。

## 配置

全部字段可选，都有默认值。在 profile patch 行里覆盖：

```yaml
- id: session-bridge
  name: 'dsh-session-bridge'
  config:
    scratchRoot: /tmp
    scratchPrefix: dsh-session-
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `scratchRoot` | POSIX `/tmp`，Windows 平台临时目录 | 临时目录的父目录 |
| `scratchPrefix` | `dsh-session-` | `mkdtemp` 前缀，后面跟 6 位随机字符 |
| `registerScratchWorkspace` | `true` | 把临时目录注册为持久工作区，使其出现在侧边栏 |
| `maxListedSessions` | `40` | `session_list` 单次返回上限 |
| `maxTranscriptTurns` | `20` | `session_read` 保留的最新回合数 |
| `maxMessageChars` | `8000` | `session_send` / `/bridge` 单条消息字符上限 |
| `wakeColdSessions` | `true` | 允许唤醒冷会话以投递消息 |
| `announceSessionId` | `true` | 在系统提示里告诉每个会话自己的 ID 与跨会话工具 |

## 人类侧界面

### 「新会话」里的「不在工作区」

新建会话时，工作区选择器底部多一行 **「✨ 不在工作区（临时目录）…」**（就在「➕ 添加工作区...」下面）。点一下选择配置根目录下的 `dsh-scratch` 工作区；macOS 默认规范路径为 `/private/tmp/dsh-scratch`，然后由宿主打开会话。实际界面点击验收状态见修复报告。

**只有一个，而且有名字。** 侧边栏里出现的项目固定叫 **「不在工作区」**，反复用也不会多出第二个。早先的版本每次点击都新开一个 `dsh-session-XXXXXX` 目录，于是每点一次侧边栏就多一个随机名的项目——那正是这个功能本来要避免的乱象。

选择器也只保留一个入口：工作区已经注册时，直接使用列表中的现有项目，底部不再重复显示「不在工作区（临时目录）…」。打开菜单只查询配置目录对应的工作区 ID，不创建目录或会话；用户重命名、自定义临时根目录和同名的其他项目都按真实身份区分。

**为什么它还是个工作区（而不是真的「不在工作区」）。** DSH 里 `blank` 只在 `turn/start` 时清除（`api/session-controller/src/list.ts`），而新会话在输入第一个字之前一定是 blank；`ConversationContent` 里 `inert = sessionId === undefined || (hero && chipTitle === undefined)`，而 `chipTitle` 在没有归属工作区时是 `undefined`（注释里第 5 种情况：列表已就绪但没有归属工作区 → 占位符）。合起来就是：**没有工作区的新会话输入框是禁用的**，建出来也打不了字。所以这一行必须注册一个工作区，能做的只是让它只有一个、并且叫得清楚。

**现在的调用链。** 浏览器 POST 固定的 `api/session-bridge/ensure-workspace`，宿主通过 Connection 的 Fetch 注册扩展点接入已有 `/api` 鉴权和来源检查。宿主在配置的 `scratchRoot` 下创建固定的 `dsh-scratch`，取 `realpath`，然后一次 `workspaceRegistry.create(path, title)` 完成注册。已有注册保留其标题，不改掉用户的重命名。客户端随后用工作区 store 的幂等 `create({ path })` 接入这条规范路径，让 owner 的 `onPick(workspaceId)` 能马上找到它。全程不创建、归档一次性会话，也不调用 native 选择器不提供的 browse 能力。

注册路由只接收标题，不接受浏览器指定文件路径。固定目录若是符号链接、非本用户所有或可被组/其他用户写入，接口会明确失败。注册或网络中断可能留下目录或已注册工作区；重试会复用它。真正完全不注册工作区的 GUI 会话没有在本次实现。
每一步宿主调用都包在 `try`/`catch` 里，失败走这个选择器自己的错误对话框——复刻别人的控件就得接管它的失败姿态，异常逃逸会把整个新会话界面拖垮。

### 清理用过的临时项目：`/scratch-clean`

```
/scratch-clean         # 先看会删什么
/scratch-clean yes     # 真删
```

只动**规范化临时根目录下、且里面没有任何非空白会话**的一次性项目（目录一起删）。固定的 `dsh-scratch` 工作区始终排除。判定条件里「空白会话也算」是故意的：点一次「不在工作区」就会留下一个空白会话，只按「零会话」判永远清不掉。

你自己的项目、以及任何有真实对话的临时项目都不会被碰。宿主侧的 `workspaceRegistry.delete()` 本身只注销不删目录，所以这条命令额外做了 `rm`——清理一次性目录是它的全部目的。

### 会话头部的「复制会话 ID」

DSH 原本会在会话头部把 `sessionId` 当成面包屑文本渲染出来（`ConversationSession.tsx`：`{ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}`），但它是**纯文本，没有任何复制入口**。所以 `session_send` 需要的那个 ID，人在界面上拿不到——功能等于半残。

客户端半边补上了这一环，挂在 `conversation.session.header.actions`（会话标题旁那一条动作带，和「创造模式」标签、后台任务计数并排），order 取 `0`，落在 agent-preset(-10) 之后、job-list(20) 之前：

- **收起时**：显示短 ID（`af569227…791a`），点一下即把**完整 ID** 写入剪贴板。这是 Codex 状态面板把 `("Session ID", thread_id)` 当作一等复制目标的做法。
- **展开后**（caret）：三行各自带复制按钮——会话 ID、工作目录、以及 `在其他会话里引用` 给出的 `/bridge <session-id> ` 前缀（粘到另一个会话的输入框就能给它发消息）。
- 复制失败会显示 `复制失败` 而不是静默什么都不做：优先用异步 Clipboard API（loopback 是安全上下文），失败则退回 `execCommand`。

侧栏会话的三点菜单也提供 **复制会话 ID**、**复制工作目录** 和 **复制 /bridge 引用**，包括归档会话。动作读取被点击行的会话信息，不切换当前会话，也不唤醒历史会话；复制结果通过独立提示显示。会话目录尚未加载时会明确提示，不能用当前会话的目录代替。

归档行增加「删除会话…」：先显示确认框，确认后永久删除聊天记录，保留工作区文件。宿主补丁负责释放本 API 持有的空闲会话、删除历史与归属；运行中、其他写入者占用或存在派生子会话时拒绝。旧宿主会明确提示更新，插件不直接读写宿主私有日志。工作区标题栏的归档图标也属于宿主补丁。作用域、验收与升级步骤见 [SESSION_ACTIONS.md](SESSION_ACTIONS.md)。

文案走 DSH 的 client locale 服务注册（`sessionBridge` 命名空间，中英双份），所以跟随应用语言，不从浏览器猜。

### 客户端工程约定

- 源码 `src/client/`，用 esbuild 打包成 CJS，再包进 `window.__ModuleLoader__.load({ id, factory })`——DSH 逐字服务 `exports["./client"]` 并这样求值。
- 仅三个既有静态模块 external：`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`。新增运行时模块会被产物加载自检拒绝。
- `tsconfig.client.json` 严格检查所有客户端 TS/TSX；`pnpm build` 必须先通过这一步。`watch:client` 只是转译监听，提交或验收前仍须执行完整 `pnpm build`。
- `scripts/check-client-load.mjs` 用 stub loader 求值产物并断言 `inject`/`apply`；客户端行为测试覆盖请求失败、规范路径接入顺序和 store 返回类型。它们不能替代真实 Electron 点击。

## 模型侧工具

| 工具 | 作用 |
|---|---|
| `session_list` | 列出所有会话：ID、标题、工作目录、是否 live / 正在跑回合。`include_subagents` 默认 `false`。 |
| `session_read` | 读取另一个会话最近的对话（只有 user / assistant 文本回合，工具结果和思维链被排除）。只读，不会 resume 或打扰对方。 |
| `session_send` | 把消息投进另一个会话。`mode: steer`（默认）在对方最近的步骤边界送达、对方空闲时开启新回合；`mode: turn` 始终排一个独立的新回合。 |
| `session_scratch` | `mode: session`（默认）在临时目录里新建会话；`mode: directory` 只给当前会话一个临时目录。模型开的临时会话仍是每次一个新目录（隔离优先）；人类侧那一行才是复用同一个「不在工作区」。 |

**寻址。** `session_id` 参数接受精确 ID、精确标题、或唯一的 ID 前缀 —— 对应 Codex `codex resume` / `codex queue --thread` 的「UUID 或会话名，UUID 优先」。歧义前缀会被拒绝并列出候选，不做猜测。

## 人类侧命令

| 命令 | 作用 |
|---|---|
| `/sessions [过滤词]` | 列出会话 ID 与标题，方便复制 |
| `/scratch [标签]` | 新建一个临时目录会话 |
| `/bridge <会话 ID 或标题> <消息>` | 直接给另一个会话发消息 |
| `/scratch-clean [yes]` | 清理临时根目录下没在用的一次性项目 |

`/bridge` 的目标可以含空格：它会用**能解析成唯一会话的最长前导词跨度**作为目标，其余部分作为消息体。

## 投递语义

- 消息在接收方日志里是一条真实的 `user/message`，`source.kind` 为 `session-bridge`，携带 `senderSessionId` / `senderTitle` / `messageId`。它因此能被压缩、被回放、在接收方界面上可见。
- 正文外面套一层固定框架，明确说明这是**同伴请求而非本人指令**，并附上回信的 `session_send` 调用方式。
- 冷会话通过 `ctx.sessionController.create({ sessionId, cwd })` 唤醒 —— 也就是 Web 界面「新会话」走的同一条路，因此预设组合与模型选择都被正确安装；没有 controller 时退回 `ctx.agents.resume`。
- 拒绝而不抛错的场景：给自己发、空正文、引用无法解析或歧义、冷会话且 `wakeColdSessions: false`、对方拒绝接收。

## 设计参考

跨会话部分对照了 OpenAI Codex 与 Claude Code 的实现：

- **两个动词，不是一个。** Codex 把 `send_message`（"Does not trigger a new turn"）和 `followup_task`（"trigger a turn if it is idle"）分成两个工具。本插件的 `steer` / `turn` 对应这个区分。
- **UUID 或名字。** 两家的 resume 与 messaging 都同时接受标识符和人类可读名字，标识符优先。
- **不要用文件做传输。** Codex 走共享 app-server 的 JSON-RPC，Claude Code 走带鉴权行的 Unix domain socket；两者都刻意避开了 spool 目录 —— 它没有投递确认、没有鉴权、也无法与回合原子绑定。本插件走 Agent 自己的 inbox，因此消息受接收方回合机制约束，而不是绕过它写历史。
- **发现动词 + 提示词指引。** Claude Code 用强制性的 "you MUST use the SendMessage tool" 段落加 `ListPeers`；本插件用 `session_list` 加每个会话作用域内的 `## Sessions and scratch space` 段落。

尚未实现、但值得下一步做的：接收方人工审批（Claude Code 的 `held | denied | expired | delivered` 加异步回执）—— 目前靠固定框架声明「同伴请求」加 `wakeColdSessions` 开关来约束。

## 测试

插件维护、样式归属和独立交付边界见 [PLUGIN_BOUNDARIES.md](PLUGIN_BOUNDARIES.md)。常规测试包含样式归属回归；真实宿主模块系统的可重跑集成命令也在该文档中。

```sh
node --test "tests/*.test.mjs"
```

39 条离线测试覆盖跨会话逻辑、四条命令、固定工作区规范路径、重试与卸载，以及客户端 store 接入。类型检查、离线测试、真实 Host HTTP 集成和 Electron 点击属于不同验证层，结果见 [REPAIR_REPORT.md](REPAIR_REPORT.md)。

## 目录

```
src/dsh.ts                 宿主服务的结构化签名 + 可选服务 get 查询
src/catalog.ts             会话发现、引用解析、转写投影
src/delivery.ts            跨会话投递与冷会话唤醒
src/message.ts             桥接消息信封与来源标记
src/scratch.ts             临时目录与临时会话
src/scratch-route.ts       固定工作区的受鉴权 HTTP 路由
src/scratch-wire.ts        插件请求与返回边界
scripts/check-host-contracts.mjs  对照宿主正式类型声明
src/tools.ts               四个模型侧工具
src/commands.ts            四条人类侧命令
src/prompt.ts              每会话的系统提示段落
src/index.ts               插件入口、Config、apply
src/client/index.tsx       浏览器半边：slot 注册、样式、locale、宿主调用
src/client/SessionIdChip.tsx  会话头部：会话标识芯片与展开面板
src/client/ScratchWorkspacePicker.tsx  新会话：工作区选择器 + 临时目录行
src/client/clipboard.ts    纯函数：ID 缩写、剪贴板载荷与降级
src/client/locales.ts      中英词典
scripts/build-client.mjs   esbuild + __ModuleLoader__ 包装
scripts/check-client-load.mjs  构建产物求值自检
```

MIT.
