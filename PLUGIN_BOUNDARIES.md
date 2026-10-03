# 插件维护与交付边界

2026-09-28 第二轮逻辑归类（当前）：接受 [RECLASSIFICATION.md](/Users/missher/Documents/Deepseek-harness-Cordis/RECLASSIFICATION.md) 的 RC-02/03 分界。宿主 `packages/client/modules/` 的 5 项通用缓存路径转由「【DSH】宿主兼容与集成」承接后续维护及宿主候选集成；其余 28 项会话生命周期、归档/删除、持久化和工作区补丁仍归会话产品域。历史补丁和现有脏文件原样保留，不执行代码迁移或重复 apply。

重复 `session_list` 注册的现场修复归插件部署配置：旧开发别名与正式包同时启用形成两个实例，不另记作新宿主缺陷，也不与通用缓存补丁混同。Bridge 自己的样式 owner/disposer 继续归 Bridge。共享的 `packages/api/session-controller/src/commands.ts` 由会话域保管现有改动；模型、输入和集成方只能只读提接口需求，未来跨域修改须先明确该次唯一写入者，再串行集成。本轮只增加本说明和[移交回执](/Users/missher/Documents/Deepseek-harness-Cordis/coordination/2026-09-28/reclassification/bridge-handoff.md)，不构建、不安装、不重启、不重复回归、不执行 Git 写操作；以下保留第一轮及更早记录。

2026-09-28 协调审查边界：本轮只做职责核验、隔离局部回归和文档纠偏，不修改生产 profile、不重启应用、不构建日常源码 lib、不覆盖已交付包，也不执行 Git 暂存、提交或发布。REQ-01/04 的图片与 `@插件` 输入功能不归 Bridge；本轮四项新功能均未实现。当前检查见[独占回执](/Users/missher/Documents/Deepseek-harness-Cordis/coordination/2026-09-28/session-bridge.md)。

历史现场修复（同日较早）：曾按当时授权移除生产 profile 中 Bridge 的开发别名及源码监听，解决正式包与开发实例重复注册；当时通过认证接口确认正式 0.1.2 为 active。该次授权不延续到本轮。本轮只读确认仍安装该 tgz，旧覆写未返回；当前进程已变化，认证组件状态未复验，不能沿用先前的 active 结论。后续更新应安装新包，不再依赖工程 lib 监听。

2026-09-27 已与上下文管理任务确认以下分工。本文件只约束 Session Bridge；不授权修改另一插件。

| 所有者 | 唯一维护路径 | 职责 |
|---|---|---|
| Session Bridge 任务 | `/Users/missher/Documents/Projects/04-Harness-Plugins/dsh-session-bridge` | 会话标识、跨会话通信、scratch、固定工作区与确认删除 HTTP 接口、Bridge 样式、构建、测试与独立交付 |
| 上下文管理任务 | `/Users/missher/Documents/Deepseek-harness-Cordis/dsh-context-manager` | 请求前压缩、阈值设置、只读上下文概览及其独立交付 |

Bridge 的 DSH 宿主修改继续作为独立的 `upstream.patch` 交付，位于 `/Users/missher/Documents/Deepseek-harness-Cordis/session-bridge-repair-20260927/`，不打进任一插件包。用户随后明确要求归档会话删除和标题栏归档入口，相应宿主接口及按钮补丁独立存放在 `/Users/missher/Documents/Deepseek-harness-Cordis/session-actions-20260927/`。这两组补丁属于已实现、未部署的宿主源码工作，不能因插件 0.1.2 已安装而说成日常应用已支持。本轮将宿主全部 33 个变更路径与历史补丁逐项核对一致，只读保留；没有接管其他会话源码。

双方不得修改或打包对方源码、lib、配置或安装包。只读证据核验允许；对方任务提供的结果是协作证据，不成为本插件的运行时依赖。上下文任务此前对 Bridge 的两个 style 标记及 HANDOVER 补充正式由 Bridge 接管，后续构建、回归及发布由 Bridge 维护。

## 样式与生命周期

- Bridge 动态 style 在插入 DOM 前设置 `data-plugin="dsh-session-bridge"` 和 `data-plugin-css="dsh-session-bridge-styles"`。
- 当前已装 Desktop 的 claimStyles 会认领整个 DOM 中未标记的 style。Bridge 不依靠后加载的插件替它认领，不修改对方标签，也不以卸载对方来恢复自身样式。
- Bridge 的 disposer 只移除自己创建的节点；旧代 disposer 不得移除新代节点。卸载 Bridge 不得影响其他插件样式。
- Bridge 只声明它需要的宿主服务，不能因为上下文插件缺席而失效；反向独立性由上下文任务维护。
- 安装包只包含本插件的源码、构建产物、脚本和文档；不得包含另一个插件、其依赖、profile 行、安装钩子或验证快照。

## 回归验证

`pnpm run check` 包含 39 条离线测试。其中样式测试运行真实 Bridge 产物，检查插入前归属、旧代清理、新代保留和无关样式保留。

以下集成检查只读已装 app.asar，使用 checkout 中真实 Cordis Loader/Entry 和 JSDOM。它直接运行 Bridge 工厂，使用无关插件夹具验证双向移除、重载、重新加入，并以去掉两个标记的内存副本作为负对照。它不读取、复制或打包上下文插件。

```sh
pnpm test:styles \
  '/Users/missher/Documents/Deepseek- Harness-Inter' \
  '/Users/missher/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
```

结果在 `verification/style-ownership/result.json`。负对照重现误认领与面板定位丢失，修复版保留归属和 absolute 定位；Bridge 自身重载后只剩一份样式，卸载后无残留，无关插件仍可工作。

包边界检查：

```sh
node scripts/check-package-boundary.mjs dist/dsh-session-bridge-0.1.2.tgz
```

它不安装包；检查依赖、运行时文件、配置行、安装钩子、静态模块请求、样式标记及包内额外文件。结果写入 `verification/package-boundary.json`。

上述验证是产物、DOM 和客户端 Loader 生命周期验证。原生 Electron 窗口的真实点击、宿主重新打包安装、生产 profile 清理均未因此变成已验收。
