# Session Bridge 修复与分诊记录（2026-09-27）

历史记录说明（2026-09-28）：本文保留最初分诊时的版本、无 Git 元数据、两处 profile 覆写与验收结果，不作为当前状态。后续已建立独立 Git 仓库、交付 0.1.2，并在一次已完成的现场修复中移除开发别名及源码监听；下文旧清理命令和“尚未撤销”描述不应再次执行或沿用。本轮按协调约束只做隔离回归与文档纠偏，当前源码、33 项宿主变更归属和部署限制见[独占回执](/Users/missher/Documents/Deepseek-harness-Cordis/coordination/2026-09-28/session-bridge.md)。

已通读插件原始 HANDOVER.md，并重读涉及的宿主实现。插件源码与构建产物已修改；上游只修改 client-modules 的元数据失效逻辑。**未重新打包或替换正在运行的应用；真实 Electron 点击验收未完成。**

证据目录：`/Users/missher/Documents/Deepseek-harness-Cordis/session-bridge-repair-20260927/`。下文补丁、备份和 JSON 文件均位于此目录。

## 目标与边界

- 插件：`/Users/missher/Documents/Projects/04-Harness-Plugins/dsh-session-bridge`，没有 Git 元数据，修改前副本在本记录目录的 `before-plugin/`。
- 上游：`/Users/missher/Documents/Deepseek- Harness-Inter`，初始分支 `codex/intel-mac-build`，初始 HEAD `e3409377ac873963595b76c0eb9afd8a8aa241af`；初始工作树干净。本次只改 `packages/client/modules` 的 5 个文件。
- 正在运行：`/Users/missher/Applications/DeepSeek Harness.app` 内的 `app.asar/dsh/node_modules`。没有向 ASAR 写入补丁。已只读确认包内 Connection 有 Fetch 路由注册、共享 API 分发及鉴权实现。
- A = 插件内可修，不要求宿主重新打包；A 的宿主半边仍须被重新加载。B = 宿主源码修改，旧 ASAR 不会因此变化。
- 产品结果：固定注册一个可复用的工作区，首次标题为「不在工作区」。真正无工作区的 GUI 会话本次做不到，没有伪称已解决。
- 不修改用户选择的模型或推理级别，不发送模型请求，不删除现有临时项目，不修改运行中 profile。

## 影响与成本排序

这是相对工程排序，不是计时估算。没有缺陷的项目排在实际阻塞之后。

| 优先级 | 问题 | 实际归属 | 影响 / 修复成本 |
|---|---:|---|---|
| 1 | 9 | 插件的 pnpm 11 配置错误 | 阻断全部脚本 / 低 |
| 2 | 12 | 插件缺少客户端类型检查 | 多类运行错误漏检 / 低至中 |
| 3 | 11 | 插件误读明确的 store 返回类型 | 点击失败 / 低，随新链路删除 |
| 4 | 1 | 插件违反 Cordis 注入约定 | 激活或功能缺失 / 低 |
| 5 | 6 | 插件使用了当前部署没有的 browse 能力 | 临时工作区入口失败 / 中 |
| 6 | 7 | 宿主存在路径身份不一致，插件又按非规范路径查找 | macOS 冲突与重复操作 / 低，合并进 6 |
| 7 | 8 | 宿主 remote API 缺少便利参数，插件可用 registry | 多次调用、标题风险 / 低，合并进 6 |
| 8 | 2 | 宿主 client-modules 缓存失效缺陷 | 新增客户端及元数据变更不可见 / 中，需宿主生效 |
| 9 | 3 | 有意的宿主开发监听配置，不是客户端监听总开关 | 宿主开发反馈慢 / 低，文档与重载步骤 |
| 10 | 5 | 宿主 GUI 硬约束与既定产品取舍 | 限制无工作区会话 / 产品决定已明确 |
| 11 | 4 | 宿主扩展点不足、插件既有替换实现有维护成本 | 维护风险 / 增加通用扩展点成本高 |
| 12 | 10 | static module 的正常设计，文档认知错误 | 排查成本 / 低 |

## 逐项诊断、修复和验证

以下小 diff 是行为摘要；精确可应用的完整改动见 `plugin-source.patch`、`upstream.patch`，宿主生产代码的最小版本另存 `upstream-minimal.patch`。

**问题 9。诊断：不同意“pnpm 自身死锁”。** 原配置同时含 `allowBuilds.esbuild: "set this to true or false"` 和旧 `onlyBuiltDependencies`；`.npmrc` 中的项目设置在 pnpm 11 不再是正确入口。错误提示是真的，配置根因可以在插件内消除。**作用域 A。改动：** `- onlyBuiltDependencies: [esbuild]`、`- .npmrc verify-deps-before-run=false`，改为 `+ allowBuilds: { esbuild: true }`，其余 pnpm 设置放 workspace 文件，锁定项目 pnpm 11.1.3。**验证：** 全新临时目录、无 node_modules、`pnpm install --offline --frozen-lockfile` 通过，esbuild postinstall 实际执行成功，随后构建通过；不是仅调用 esbuild.version。**风险：** 只批准 esbuild 的安装脚本；宿主自己的 pnpm 11.7.0 不变。官方依据：[pnpm 11 release notes](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md)。

**问题 12。诊断：同意客户端漏检，不同意“类型检查与零运行时依赖冲突”。** 类型依赖、开发依赖、产物运行时导入是三个不同层面。**作用域 A。改动：** `+ tsconfig.client.json`；`build:client` 前置严格 `tsc`；加入 React/宿主 primitives 的开发类型与 `scripts/check-host-contracts.mjs`；两个组件复用完整的英语词典；打包只允许原有三个静态模块外置，并原子替换 client.js。**验证：** 用新配置回放旧源码检出 archiveSession 声明缺失、两份 fallback 字典缺键共三处错误；现有严格检查与构建通过，正式宿主声明兼容检查通过，产物加载和行为测试通过。**风险：** 手写结构不是完整宿主接口；对照器依赖 checkout 已生成的 lib/types，换版本要重新执行；watch:client 仍只是转译监听；类型和 stub 测试不代替真实点击。

**问题 11。诊断：不同意这是上游缺陷。** `ClientSessions.create` 明确返回 `Promise<SessionId>`（`packages/api/session-controller/src/client/sessions/service.ts:431`），`IWorkspaces.create` 明确返回 `Promise<WorkspaceView>`（`packages/api/workspace-controller/src/client/service.ts:55`）。不同业务可以返回不同类型，四种猜测式解包掩盖了契约错误。**作用域 A。改动：** `- unwrapField(...)`，`+ ctx.workspaces.create({ path })` 直接使用其返回值；新路径不创建一次性 Session，因而不再读取 session.create 的返回值。**验证：** 客户端测试验证返回对象身份、失败不进入后续接入、规范路径按顺序接入 store；真实 Host 验证了工作区 Remote 的幂等接入。**风险：** 宿主升级后的返回类型变化必须由正式声明检查发现，不能再增加兼容猜测。

**问题 1。诊断：不同意把 Cordis 的严格访问规则当作 DSH 缺陷。** `vendor/cordis/src/reflect.ts:144` 故意拒绝未注入的属性访问；同文件 `get(name, strict = true)` 明确是“不要求 inject、只读 active provider”的查询。**作用域 A。改动：** `- try get / catch / try ctx[name] / catch`，`+ return ctx.get(name)`；需要等到 commands 可用才注册的部分改成 `ctx.inject(['commands'], ...)`；新路由独立等待 connection 与 workspaceRegistry。**验证：** 严格代理测试确认从未读未注入属性，真实查询故障不再吞掉；可选服务全无时原有工具仍能激活；真实 Host 本体及新接口可用。**风险：** `get` 是非响应式快照，不代表服务永远在场；需要持有服务注册副作用时仍应使用注入子作用域。

**问题 6。诊断：同意 native 部署没有 createDirectory，归因改为插件调用了错误能力。** `packages/api/workspace-controller/src/directory-picker.ts:97` 明确要求 browse.createDirectory。宿主插件能够直接使用 Node 文件系统，不必用创建会话来获得目录。**作用域 A。改动：** 删除浏览器的“建临时会话→注册→重命名→归档”链，新增 `src/scratch-route.ts`：`mkdir → lstat 检查 → realpath → workspaceRegistry.create(path, title)`。浏览器 POST 固定路径，随后通过工作区 store 的幂等 create 接入，再交给原 owner 的 onPick；没有裸写宿主数据库。**验证：** 真实独立 DSH profile 的受鉴权 HTTP 调用通过，重复请求同 ID，工作区 Remote 再次接入仍同 ID 且 created=false，额外路径参数被拒绝；未认证返回 401。**风险：** 最后一步 Electron 选择器与输入框点击未验证；目录或注册提交后网络中断不做破坏性回滚，重试复用；异常固定目录会明确拒绝。

**问题 7。诊断：同意宿主的 cwd 身份比较存在缺陷，但不同意“一次性会话必然只能丢掉”。** registry 用 realpath（`packages/workspace/workspace/src/index.ts:236`），ensureSession 最后仍比较字符串（`packages/api/session-controller/src/agent.ts:270`）。预先规范化路径即可避免本插件触发冲突，旧浏览器还用 /tmp 拼写查 /private/tmp 记录导致复用失败。**作用域 A；宿主通用问题保留。改动：** `- SCRATCH_ROOT 字面路径查找及建会话`，`+ 使用 Host 返回的 canonical path`；清理命令也先规范化根目录，并排除共享 dsh-scratch。**验证：** 符号链接根目录测试、重复注册测试、别名根目录清理测试均通过；真实 Host 的二次接入通过。**风险：** 其他调用方传混合拼写依然可能撞宿主冲突；未修改既有 Session header、未迁移旧会话、未执行用户数据清理。

**问题 8。诊断：同意 remote 只收 path，但它不强迫这个插件多调用 rename。** `WorkspaceCreateRequest` 在 `packages/api/workspace-controller/src/types.ts:65`，底层 registry 在 `packages/workspace/workspace/src/index.ts:236` 支持 title。**作用域 A。改动：** `- create 后 rename`，`+ Host registry.create(canonicalPath, title)`。**验证：** 真实首次创建返回「不在工作区」，后续两次调用同一个工作区；没有新增随机标题项目。**风险：** 已存在的工作区保留当前标题（尊重已有重命名）；自动改掉既有标题没有实施；通用 Workspace Remote 的签名未扩展。

**问题 2。诊断：同意，而且正面缓存也会过期。** `pkgMeta` 按 baseUrl 与 Loader name 缓存 null 或元数据，行重新加载未失效；同 sourceKey 的 reconciliation 原本还忽略 metadata 变化。实时旧应用的客户端 bundle 已更新，但 graph.inject 仍为旧数组，是第二项实证。**作用域 B。改动：** 在现有 internal/plugin 事件上删除匹配 entryName 的缓存项；相同 sourceKey 只有在 metadata 也相同时才跳过，约 11 行生产代码差异；没有 timer、全量重扫或第二套缓存。**验证：** 新回归覆盖“先无 client，后添加，原名发现”以及“正面依赖修改、撤销声明”；client-modules 与 client-hmr 相关 6 文件 160 条测试通过；模块 TypeScript 构建通过；中英 README 配对检查与 git diff --check 通过。**风险：** 单改 package.json 不产生 Loader 事件，仍需重建/停启该行或重启；当前 app.asar 尚未加载补丁。准确生效命令在下文。

**问题 3。诊断：不同意把 hmr.root: [] 视为客户端总开关。** `packages/bundle/base/cordis.patch.yml:28` 配置的是宿主模块监听；`packages/client/hmr/src/index.ts:31,149` 单独默认 500ms 检查已发现的客户端产物。问题 2 使未发现的模块无从进入后者的监听，两者会叠加，但不是同一机制。**作用域 A（开发配置说明），没有 B 代码改动；diff=∅。** 保留有意的生产默认；开发期间保留已存在的 lib 监听，开发结束可撤销并改用重启。**验证：** 当前旧应用服务出的组合脚本包含本次完整 client.js，仅多出宿主 source-map trailer；graph revision 改变。**风险：** 删除 lib 监听后修改宿主插件源码必须重启；本次 B 缓存补丁不能替代宿主代码监听。

**问题 5。诊断：同意硬约束。** blank 在 turn/start 前为 true（`packages/api/session-controller/src/list.ts:49`）；无归属时 chipTitle 不存在，`ConversationContent.tsx:141` 设置 inert。**作用域 A，采用用户已决定的产品行为。改动：** `+ 固定注册且复用 scratchRoot/dsh-scratch`，首次标题「不在工作区」；共享目录不参与临时项目清理。**验证：** registry 与 Remote 接入已经验证；输入框可输入仍属于未完成的真点击项目。**风险：** 它确实是一个 Workspace，多次使用共享同一目录，并非每次文件隔离。真正无工作区的 GUI 会话本次做不到；没有篡改 blank、伪造 turn/start 或改 Session header。

**问题 4。诊断：部分同意。** single 只渲染一个优先项、重复子 slot 声明会报错是契约，不是实现 bug；缺少追加菜单项的公开扩展点属于宿主可扩展性不足。证据：`ui-workspace/src/client/index.ts:307` 的子 slot 声明，`ui-slots/src/index.ts:1035` 的重名拒绝。**作用域 A。改动：** 保留已存在的 priority=-1 picker 替换，不再尝试包裹原 picker 并重复声明 children；实际修改限定于严格类型、词典及上面的工作区动作。宿主新增菜单扩展点 diff=∅，因 A 已能满足本机需求。**验证：** 编译及产物注册/行为测试通过；native 选择器按钮仍需真点。**风险：** 复制实现仍有随宿主 UI 漂移的维护成本，对 browse-only 部署不声称兼容；并未把这一风险掩盖成彻底修复。

**问题 10。诊断：同意它是 static module，不同意这本身是缺陷。** `packages/client/web/src/seed.ts:36` 直接把 primitives 放入静态模块表；不应从 boot graph.entries 推断所有模块。另须纠正文档矛盾：旧源码和产物已经运行时 require 这个 DSH 包。**作用域 A。改动：** 改 README 的绝对零导入表述；external 白名单固定为已有 react、react/jsx-runtime、primitives 三项；清理 dsh.client.inject 中非动态 row 的错误条目，保留实际 provider rows。**验证：** 产物加载检查只接受这三项，宿主半边没有任何 DSH value import。**风险：** static module 由宿主提供，依然属于版本契约；本次没有新增例外或打入第二份 React/Cordis。

## 新发现：通用 RPC 注册的作用域问题

集成过程中，`connection.rpc.handle()` 的注册子 fiber 在 required services 包含 webServer 时，仍报 `cannot get property "webServer" without inject`。`packages/client/connection/src/rpc-host.ts` 的 rpc getter 捕获了带 provider shadow 的上下文，register 随后读 owner.webServer；Connection 自己不注入 webServer，而是由另一个 child 装配。离线普通对象 stub 无法覆盖 Cordis 的这种追踪行为。

没有给 profile 添入注入覆写，也没有偷偷修改宿主 Connection。最终用已有 `connection.fetch.register()` 注册固定 `/api/session-bridge/ensure-workspace`，同一个共享 API carrier 在分发前执行 Host/Origin 检查与浏览器认证。这是插件自己的 JSON 端点，非手写 Typert Remote；请求和返回仅在本插件拥有的边界验证。它不接受任意路径。真实 HTTP 集成已通过，旧 ASAR 的对应扩展点也已只读核验。

## 验证账本

| 层次 | 结果 | 证据 |
|---|---|---|
| 插件类型与构建 | `pnpm run check` 通过，内含主机/客户端严格检查、构建、加载自检及 31 条测试 | 本次工具记录；源文件与构建产物 |
| 宿主声明契约 | `node scripts/check-host-contracts.mjs '/Users/missher/Documents/Deepseek- Harness-Inter'` 通过 | Host Connection Fetch / workspace create / native picker 声明 |
| 干净依赖状态 | 新目录 install frozen/offline + build 通过，postinstall 真执行 | `clean-install-result.json` |
| 上游回归 | 6 文件 160 测试通过；client-modules TypeScript 构建通过 | `pnpm exec vitest run packages/client/modules packages/client/hmr`；`pnpm exec tsc -b packages/client/modules --pretty false` |
| 上游文档与差异 | 翻译配对、git diff --check 通过 | `upstream.patch` |
| 真实 Host HTTP | 独立临时 DSH_HOME，实际 Loader/profile、认证、工作区注册、重复复用、Remote 接入 | `source-smoke.py` 与 `source-smoke-result.json` |
| 当前已装应用 | 已发现 client bundle，服务内容包含本次产物；graph.inject 仍旧，符合未修缓存 | `live-client-evidence.json` |
| 当前包能力 | ASAR 内有 Fetch 注册、API 分发和鉴权实现 | `packaged-connection-evidence.json` |
| 原生界面 | **未完成** | 当前 IAB 访问本机 GUI 返回 ERR_BLOCKED_BY_CLIENT；没有可用原生浏览器控制。未以脚本测试冒充点击 |
| 上游重新打包/安装 | **未执行** | 当前运行的 app.asar 未替换 |

真点击待验项目按原 HANDOVER §5 保留：ID 芯片复制完整 ID；caret 内三行分别复制；新会话工作区菜单中的临时入口能进入规范路径且 chip 标题正确、输入框可用；重复点击不增工作区；普通「添加工作区」仍能调起 native chooser。随后核对 boot graph。输入框与剪贴板都不能由上述 HTTP 测试证明。

## 让 B 改动实际可见

源码已经修改，无需重复 apply patch。精确上游 diff 在本目录 `upstream.patch`。两种方式任选其一，均先退出原来正在使用同一数据目录的应用。

**从源码运行并使用已有 desktop profile（推荐用于这次验收）：**

```sh
cd '/Users/missher/Documents/Deepseek- Harness-Inter'
DSH_HOME='/Users/missher/Library/Application Support/DeepSeek Harness Intel/harness' \
DSH_DESKTOP_USER_DATA_DIR='/Users/missher/Documents/Deepseek-harness-Cordis/session-bridge-repair-20260927/desktop-user-data' \
pnpm dev:desktop
```

已核对 dev.ts：dev:desktop 自动构建仓库与桌面壳，再启动开发应用；start:desktop 使用已有构建，不会替你编译。以上使用既有 profile 以保留插件 link，同时把 Electron userData 放在单独目录。不要同时启动两个访问此 DSH_HOME 的 Host。若选择隔离 DSH_HOME，则需要在那个 profile 中重新挂载插件，不能把插件缺席当作修复失败。

**重新打包 macOS x64：**

```sh
cd '/Users/missher/Documents/Deepseek- Harness-Inter'
pnpm build
pnpm package:desktop:mac:x64
```

构建产物目录由当前源码确定为 `apps/desktop/.desktop-build/targets/mac-x64/artifacts/`。成功后安装/打开新产物，并确认运行栈来自新包中的 app.asar；继续打开原来的旧 app 不算验证。此处给出命令，没有声称打包、签名、安装已经通过。

## 三处临时改动的撤销

1. **pnpm 绕过：已被本次 A 修复取代。** `.npmrc` 中绕过键、workspace 的旧 onlyBuiltDependencies 已移除，手改 .modules 的做法停止。官方重建路径为：

```sh
cd '/Users/missher/Documents/Projects/04-Harness-Plugins/dsh-session-bridge'
pnpm install --frozen-lockfile
pnpm rebuild esbuild
pnpm build
```

无需再次手改 .modules.yaml。干净目录的验证已经证明新配置可从零安装。

2. **改 row name 绕过：被 B 的缓存失效修复取代；一次全进程重启也会清空旧缓存。** 当前旧进程尚未切换，所以没有在运行中移除它。先退出旧应用，再运行下面命令，之后启动修复后的源码应用或新包：

```sh
python3 '/Users/missher/Documents/Deepseek-harness-Cordis/session-bridge-repair-20260927/restore-profile.py' \
  --remove-renamed-row --apply
```

脚本只删除已核对的禁用 session-bridge 和插入 session-bridge-dev 那段，自动在 profile 旁备份。它不会移除 profile/package.json 中的 link 依赖或 bundles 项，也不会覆盖其他插件设置。若文件结构有变化，它会拒绝写入而非猜测。去掉 --apply 是预览，预览已通过。

3. **hmr lib 监听：没有被缓存修复取代。** 它是开发期间有效且必要的宿主代码监听选择；若结束热更新开发并改用构建后重启，退出应用后精确撤销：

```sh
python3 '/Users/missher/Documents/Deepseek-harness-Cordis/session-bridge-repair-20260927/restore-profile.py' \
  --remove-host-watch --apply
```

两段都要撤销时一次执行 `--remove-renamed-row --remove-host-watch --apply`，然后启动新进程。已提供确切步骤，但本次未擅自关闭正在使用的桌面应用，也未声称 profile 已清理。

回滚 profile 时用脚本打印的备份路径覆盖原文件，并重启 Host。回滚宿主源码先在 checkout 执行 `git apply --check -R '/Users/missher/Documents/Deepseek-harness-Cordis/session-bridge-repair-20260927/upstream.patch'`，确认仍适用后去掉 --check 执行；插件修改前原件保存在 before-plugin。不要用全仓 reset 覆盖随后产生的其他工作。

## 需要用户确认

- 尚未确定切换/重启现有应用的时间，因此两个运行中 profile 覆写未实际撤销；具体 diff 与撤销命令已经备齐。
- 真实 Electron 点击仍须在可访问的本机界面完成，不能用构建或 HTTP 成功代替。
- 对于已存在且被手工改名的固定 scratch 工作区，目前保留标题；若要求把这些既有标题也强制改回「不在工作区」，需要明确这一数据修改意图。

除此之外未虚构版本兼容性、未把旧 app 的缓存说成已经修好，也未扩大到 Windows/Linux 原生验收。

## 追加：与上下文管理任务的边界及样式修复接管

本轮已明确接受文件所有权：Bridge 任务独立维护本插件的源码、lib、HTTP 接口、样式、测试和交付；上下文管理任务独立维护 `/Users/missher/Documents/Deepseek-harness-Cordis/dsh-context-manager` 的压缩、阈值与概览。Bridge 没有修改或重新打包上下文项目。双方先前交叉写入的两个 style 标记和 HANDOVER 补充由 Bridge 正式接管。后续约束见本插件 `AGENTS.md` 与 `PLUGIN_BOUNDARIES.md`。

已现查 `installStyles()`，两个标记及注释已存在于本插件源码、构建产物和主修复补丁中；构建产物 SHA-256 为 `4bd40b71bfea0f0d00efaf5da59d1091dc5b92e32f796bdf67703d02b7a85e1d`。本轮未再改动这段已正确的生产代码。

**诊断：宿主 claimStyles 的全 DOM 认领行为与插件迟到的无归属样式叠加。作用域 A。diff：style 插入前增加 `dataset.plugin = 'dsh-session-bridge'` 与 `dataset.pluginCss = STYLE_ID`；新增长期回归和交付检查。验证：** 常规测试现在为 31 条，覆盖归属先于插入、旧代 disposer 不删除新代、卸载不删除无关样式；真实已装 client-modules + Cordis Loader/Entry 集成的负对照重现误认领及 `absolute → static`，修复版在无关插件重载、移除、重装时保留样式，并验证 Bridge 自身重载、移除、重新加入的双向隔离。**风险：** 集成使用 JSDOM 和无关插件夹具，未复制上下文插件，也未因此完成原生 Electron 点击验收。

独立可重跑入口为 `scripts/check-style-ownership.mjs`，结果在本插件 `verification/style-ownership/result.json`；已装模块版本 0.1.7-rc.2，其提取脚本 SHA-256 为 `6fa57df9f12225ea0644ed22bc149eadf7c21e5b0b43a8683c4081567b96374f`。这项脚本只读宿主 ASAR，运行时仍无跨插件依赖。

Bridge 的独立交付候选为 `dist/dsh-session-bridge-0.1.0.tgz`，版本保持原值，校验值和包边界审计单独记录在 `verification/package-boundary.json`。上下文 0.2.1 包由其任务维护，本任务不提供副本。宿主补丁继续独立存放在修复证据目录，本轮没有扩展它，也没有改动 profile 或重启应用。打包完成不代表已安装，也不代表原生点击验收。
