# Session Bridge · 会话桥接

中文 | [English](README.en.md) · [桌面端与安装包](https://github.com/Missher12/Missher-DeepseekHarness-Desktop) · [全部插件](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/blob/main/plugins/README.zh.md)

为 DeepSeek Harness 显示与复制完整会话 ID，提供跨会话查询、读取和投递，以及临时工作区。

- 包名：`@missher/dsh-session-bridge`；版本：**0.1.3-local.6**。
- 本版只整理发行包装、许可证和双语文档；`src/` 与 `lib/` 保持已验收 local.5 的字节。
- 独立、可卸载的 Cordis Bundle；不需要另装兼容插件。不是 DeepSeek 官方产品。
- [许可证](LICENSE) · [上游署名](THIRD_PARTY_NOTICES.md) · [兼容记录](COMPATIBILITY.json)

## 安装固定版本

从 [v0.1.3-local.6 Release](https://github.com/Missher12/Missher-DSH-Session-Bridge/releases/tag/v0.1.3-local.6) 下载 `missher-dsh-session-bridge-0.1.3-local.6.tgz` 和 `SHA256SUMS`。发行资产由维护者发布；若该 Release 尚未出现，这个版本仍是发行候选。不要将 GitHub 的自动源码压缩包当作插件 tarball。

下载后可在包含两个文件的目录校验：macOS 用 `shasum -a 256 -c SHA256SUMS`，Linux 用 `sha256sum -c SHA256SUMS`。运行包已包含 `lib`，无需本地构建，也没有安装脚本。

**Desktop：**打开“插件 → 添加插件”，选择本地 `.tgz` 或填写下面固定地址。确认版本及组件 `session-bridge` 已启用；按 Host 提示重新加载，必要时完全退出后重开。Desktop 的 `desktop` profile 由应用管理，使用应用内安装入口。

```text
https://github.com/Missher12/Missher-DSH-Session-Bridge/releases/download/v0.1.3-local.6/missher-dsh-session-bridge-0.1.3-local.6.tgz
```

**已有 DSH CLI 的 Web 用户：**在自己的 Web profile 安装；以下命令不修改 Desktop profile。

```sh
dsh plugin --profile web add https://github.com/Missher12/Missher-DSH-Session-Bridge/releases/download/v0.1.3-local.6/missher-dsh-session-bridge-0.1.3-local.6.tgz
```

也可把 URL 换成本地 tarball 的绝对路径。首次测试使用独立 `DSH_HOME` / `DSH_AGENTS_HOME`。不要同时启用旧 `dsh-session-bridge`、开发别名 `session-bridge-dev` 和当前 scoped 包；它们会重复注册 `session_list` 等工具。升级前保留旧包与配置，等当前任务结束再重新加载。

## 使用

### 会话 ID 与菜单

会话标题栏完整显示包含 `session-` 前缀的 ID，保持一行、原字号、不省略；单击复制完整值。右侧展开按钮提供 ID、工作目录及 `/bridge <session-id> ` 引用的复制入口。侧栏会话的三点菜单也提供这三项，包括归档行；读取被点击会话，不切换当前会话。目录未加载或复制失败会给出提示。

当会话栏窄于完整 ID 和固定按钮的总宽时，存在布局空间限制；本功能不通过缩写 ID 或缩小字号隐藏该限制。

### 「不在工作区」与 scratch

新会话选择器末尾提供“✨ 不在工作区（临时目录）…”。选择后复用配置根目录下的 **`dsh-scratch` 工作区**，默认标题为“不在工作区”；macOS 的默认规范路径是 `/private/tmp/dsh-scratch`。它仍是正式注册的工作区，不是真正无工作区的会话。宿主的 blank 会话输入流程需要工作区。

只打开选择器不会创建目录或会话。重复选择复用规范路径及真实工作区 ID，保留用户重命名；不合并其他同名项目。固定路径若是符号链接、非当前用户所有，或可被组/其他用户写入，创建请求会失败。

模型工具 `session_scratch` 和 `/scratch` 则为每次调用建立独立的一次性目录；这与界面复用 `dsh-scratch` 的行为不同。临时目录可能被操作系统清理，不适合作为重要文件的唯一保存位置。

### 工具与命令

| 模型工具 | 作用 |
| --- | --- |
| `session_list` | 列出会话 ID、标题、目录和运行状态；默认排除子代理会话。 |
| `session_read` | 读取目标最近的用户/助手文本，不含思维链和工具结果；只读，不唤醒目标。 |
| `session_send` | 向目标投递真实 user-role 消息；`steer` 在步骤边界送达、空闲时开始回合，`turn` 排队为独立回合。 |
| `session_scratch` | `session` 模式在独立临时目录创建会话；`directory` 模式不创建会话，但默认仍注册工作区，可用 `registerScratchWorkspace: false` 关闭。 |

目标接受精确 ID、忽略大小写的精确标题或唯一 ID 前缀；歧义会拒绝，不猜测。

| 人类命令 | 作用 |
| --- | --- |
| `/sessions [过滤词]` | 列出会话 ID 与标题。 |
| `/bridge <ID或标题> <消息>` | 给指定会话投递消息；含空格标题按可唯一解析的最长前缀识别。 |
| `/scratch [标签]` | 新建临时目录会话。 |
| `/scratch-clean` | 预览可清理的一次性临时项目。 |
| `/scratch-clean yes` | 真正注销符合条件的项目并删除其目录。 |

清理按规范化 `scratchRoot` 范围、目录名以 `dsh-` 开头、没有非空白会话筛选已注册工作区，始终排除固定 `dsh-scratch`。它不检查插件创建标记，也不使用当前 `scratchPrefix`：其他符合条件的 `dsh-*` 工作区也可能入选，自定义非 `dsh-` 前缀则不会入选。目录内自行保存的文件也会删除；先看预览，保留所需文件。

## Host 与平台边界

没有宿主版本号硬限制，不代表所有版本都兼容。开发 SDK 基线为 rc.2；功能取决于 Host 服务与插槽是否存在。

| 能力 | 官方 DSH 0.2.0-rc.2 | 带对应公共扩展的 Missher Desktop |
| --- | --- | --- |
| ID/复制、跨会话工具、scratch、选择器末尾入口 | 插件提供；历史隔离加载已验收 | 插件提供 |
| 将“不在工作区”组排在侧栏其他工作区之后 | 无扩展时保留普通顺序 | 使用 `uiWorkspace.registerTrailingWorkspace`；不改持久排序 |
| 永久删除归档聊天记录 | 无 `sessionController.deleteArchivedSession`，隐藏入口 | 归档行“删除会话…”二次确认；保留工作区文件 |
| 工作区标题栏独立归档图标 | 官方归档筛选位于视图选项 | 属于 Host 增强，不由本插件包提供 |

永久删除的运行中、其他写入者占用和派生子会话保护由 Host 执行。插件只调用公共删除接口，不推断或修改 Host 私有日志。未安装对应 Host 扩展时，升级插件不能补出该能力。

验证层次见 `COMPATIBILITY.json`：macOS x64 上的 rc.2 定制 Host 是当前集成基线。local.5 曾通过真实浏览器复制及 1280/600px 单行检查；归档删除曾通过确认、取消、文件保留和重启不恢复检查。本版不改变这些运行字节。本轮发行检查不等于重新验收原生 Electron 点击或真实模型；Windows、Ubuntu、Apple Silicon 及官方 0.2.1-alpha.1 未做本插件全功能验收。

## 配置

所有字段可选。Bundle 已声明正式实例，不要再插入第二个插件行。需要覆盖时，在目标 profile patch 中按既有 ID 更新配置：

```yaml
- id: session-bridge
  config:
    scratchRoot: /tmp
    scratchPrefix: dsh-session-
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `scratchRoot` | POSIX `/tmp`；Windows 系统临时目录 | 临时目录的父目录。 |
| `scratchPrefix` | `dsh-session-` | 一次性目录前缀。 |
| `registerScratchWorkspace` | `true` | 将工具创建的临时目录注册为工作区，包含 `session` 与 `directory` 模式。 |
| `maxListedSessions` | `40` | 单次列举上限。 |
| `maxTranscriptTurns` | `20` | 最近转写回合上限。 |
| `maxMessageChars` | `8000` | 单条跨会话消息字符上限。 |
| `wakeColdSessions` | `true` | 允许唤醒冷会话投递；使用 Host 会话创建/恢复流程。 |
| `announceSessionId` | `true` | 系统提示中声明自身 ID 和跨会话工具。 |

## 停用、卸载与数据

在 Desktop 或 Web 的插件管理里关闭该 Bundle，按提示重新加载；重新打开开关即可启用。停用移除本插件的工具、命令、样式与界面入口，侧栏排序恢复 Host 默认行为。

卸载使用同一插件管理入口。Web CLI 用户也可以：

```sh
dsh plugin --profile web remove @missher/dsh-session-bridge
```

停用/卸载不会删除现有聊天记录、已投递消息、工作区或临时目录里的文件，也不会撤销已经开始的目标会话任务。Host 中独立保存的配置覆盖项可在确认不再需要后手动移除。回退时通过同一安装入口装回保留的旧 tarball；无需替换整个会话库。

## 隐私与权限

本插件没有独立遥测或外部上传服务；界面请求使用 Host 自身受鉴权的 HTTP 接口。它能通过 Host 读取会话目录和用户/助手文本，并向其他会话发送真实消息。目标模型处理收到的内容时，仍遵循目标会话的供应商、权限与费用设置。只向有权接收内容的会话投递，先确认目标。

跨会话信封标注来源及“同伴请求”，但没有额外人工审批队列或权限隔离层。它不提供聊天备份、账户间同步或跨 Host 通信。反馈问题时提供版本、步骤及脱敏错误，不提交会话库、API Key 或 Cookie。

## 独立源码开发

本仓库是唯一维护入口。使用 Node `>=22.19` 和 `packageManager` 指定的 pnpm `11.1.3`，并准备已构建的 rc.2 Harness SDK：

```sh
node scripts/link-harness.mjs /absolute/path/to/built-harness
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
node --test --test-concurrency=1 "tests/*.test.mjs"
pnpm pack --pack-destination ./dist
node scripts/check-package-boundary.mjs ./dist/missher-dsh-session-bridge-0.1.3-local.6.tgz
```

SDK 链接只用于开发，不提交或进入 tarball。安装包包含预构建运行文件、对应源码、许可证及用户说明；开发脚本和历史本机回执留在 Git 仓库。Node 半边仅使用结构化 `ctx` 服务，不运行时导入任何 `@deepseek-ai/dsh-*`。客户端保留三个 Host 静态请求：`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`；没有新增运行时依赖。

`build` 包含严格客户端类型检查和客户端模块加载自检；watch 仅转译，不能代替验收。源码 checkout 不等于已安装 app.asar，修改代码后必须核对目标应用实际加载的包；桌面禁用 HMR 或元数据缓存可能要求重启。
