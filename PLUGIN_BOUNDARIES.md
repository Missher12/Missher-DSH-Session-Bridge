# 插件维护与交付边界

2026-09-28 状态更新：用户报告实际安装包启用失败后，本任务已按授权修正生产 profile 中仅属于 Bridge 的两处旧临时配置，清除重复开发实例。此操作取代下文 2026-09-27 当时“不改 profile”的执行范围；未重启桌面、未改其他插件。当前正式 0.1.2 tgz 组件为 active，后续升级应安装新包，不再依赖工程 lib 监听。详见 HANDOVER.md 与现场验收记录。

2026-09-27 已与上下文管理任务确认以下分工。本文件只约束 Session Bridge；不授权修改另一插件。

| 所有者 | 唯一维护路径 | 职责 |
|---|---|---|
| Session Bridge 任务 | `/Users/missher/Documents/Projects/04-Harness-Plugins/dsh-session-bridge` | 会话标识、跨会话通信、scratch、固定工作区与确认删除 HTTP 接口、Bridge 样式、构建、测试与独立交付 |
| 上下文管理任务 | `/Users/missher/Documents/Deepseek-harness-Cordis/dsh-context-manager` | 请求前压缩、阈值设置、只读上下文概览及其独立交付 |

Bridge 的 DSH 宿主修改继续作为独立的 `upstream.patch` 交付，位于 `/Users/missher/Documents/Deepseek-harness-Cordis/session-bridge-repair-20260927/`，不打进任一插件包。此前修复已完成；用户随后明确要求归档会话删除和标题栏归档入口，因此新增必要的宿主接口及按钮补丁，独立存放在 `/Users/missher/Documents/Deepseek-harness-Cordis/session-actions-20260927/`。不改运行中 profile，也不重启生产应用。

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
