# 0.1.1 会话操作增补

2026-09-28 协调复核：插件 0.1.2 已安装，旧开发行及源码监听没有返回；已装 ASAR 仍没有归档删除接口和标题栏归档按钮。本轮未部署宿主补丁、未修改生产配置，只做隔离回归和只读核验。当前进程的认证状态接口返回 401，原生点击未验收；详见[本轮回执](/Users/missher/Documents/Deepseek-harness-Cordis/coordination/2026-09-28/session-bridge.md)。

历史现场修复（同日较早）：0.1.2 与旧开发行并存导致的启用失败已通过撤销两处旧覆写解决，当时正式组件 active、认证 scratch 查询通过。这里的 active 仅是当时实测，不代表本轮复验。

2026-09-27：0.1.2 另外修复新会话工作区菜单的重复入口。已有临时工作区时隐藏底部的创建快捷入口，通过只读查询返回的工作区 ID 匹配；不按标题推断，不新建工作区或会话。此项完全属于 A，不需要重建桌面应用；下方三项原有的 A/B 边界保持不变。

用户已明确选择：删除聊天记录，点击后再确认；工作区里的实际文件保留。本次三项按以下作用域实现，原始 12 项分诊继续见 REPAIR_REPORT.md。

1. **归档会话删除。诊断：上游缺少删除能力，插件也没有确认入口。作用域 A + B：A 使用已有会话菜单 slot、Modal 和认证 Fetch 路由；B 增加 `sessionController.deleteArchivedSession` → `workspaceRegistry.deleteArchivedSession` → `sessionPersistence.delete`。改动：** 只显示归档行的「删除会话…」，确认后提交选中 ID；宿主先检查归档、活动和派生关系，释放本 API 持有的空闲 Agent，再持写锁删除历史代和当前代日志、清理归属并通知客户端。**如何验证：** 取消不发请求；确认一次；两种日志编码删除和重启不恢复；忙碌、未归档、派生父会话被拒绝；工作区文件保持。**风险：** 永久删除无法撤销；其他进程或插件仍持有会话时需先释放；有派生会话时先处理子会话；旧宿主返回明确的“不支持”提示，不尝试私有目录删除。附件、导出副本和备份不属于会话日志删除范围。

2. **工作区标题栏归档图标。诊断：该位置是宿主硬编码的 toolbar，没有可用插件 slot。作用域 B。改动：** `WorkspaceBrowser` 的视图设置按钮前增加 16px 归档图标，使用现有 `setArchivedFilter`，在「只显示已归档」和「隐藏已归档」间切换，带 tooltip、aria-label 和 aria-pressed。不替换侧栏，不插入外部 DOM。**如何验证：** 现有 WorkspaceBrowser 测试真实渲染、点击两次，验证列表切换且会话归属不变。**风险：** 要重新构建宿主才显示；窄侧栏沿用宿主隐藏操作区的行为。

3. **三点菜单复制。诊断：宿主已提供公开菜单扩展点，插件之前没有贡献入口，不是宿主缺陷。作用域 A。改动：** 注册复制会话 ID、工作目录和 `/bridge` 引用三个条目。读取选中行，归档与未打开的历史会话都可复制；操作不切换当前会话、不唤醒 Agent，独立 Toast 在菜单关闭后仍可见。**如何验证：** 构建产物在真实 React/primitives + JSDOM 中执行三次菜单点击，验证所选行内容和提示；剪贴板在该测试中被模拟。**风险：** 系统剪贴板和原生窗口真实点击尚未验收；目录未知时明确提示，不使用当前会话目录代替。

## 安装与可观察性

插件：`dist/dsh-session-bridge-0.1.2.tgz`。它不包含宿主补丁，不包含上下文管理插件，不修改生产 profile。没有新增 DSH 运行时模块导入；宿主半边继续零 DSH 运行时 import，客户端沿用此前已声明的宿主静态 primitives、React 和 JSX runtime。

当前已装桌面进程仍使用 app.asar 内的 0.1.7-rc.2。源码改变不能让该进程显示 B。完整重新构建的命令为：

```sh
cd '/Users/missher/Documents/Deepseek- Harness-Inter'
pnpm build
pnpm package:desktop:mac:x64
```

构建完成后退出旧应用，使用这次生成的 x64 桌面包。另一种方式是在退出旧应用后从同一 checkout 执行 `pnpm dev:desktop`（或构建后 `pnpm start:desktop`）。本次隔离验收使用新的 DSH_HOME 和公开 `pnpm dsh --profile web`，不等同于重启或替换现用桌面应用。

本次源码 checkout 已包含此前缓存修复和新增功能。独立上游增量补丁在 `/Users/missher/Documents/Deepseek-harness-Cordis/session-actions-20260927/upstream-actions.patch`；相对上游 HEAD 的完整补丁是同目录 `upstream-combined.patch`。不要重复应用到已修改的 checkout；转交干净副本时先 `git apply --check <patch>`。

三处旧临时改动的最终状态：pnpm 绕过已由正常配置取代；开发别名和源码 lib 监听已在此前现场修复中移除，并在本轮只读确认。先前“row 改名只有切换到含缓存修复的宿主后才能撤销”的说法过于绝对：实际已在旧 ASAR 上通过两阶段排空、恢复正式行解决重复实例。移除开发别名不等于修复 Loader 元数据缓存，也不等于以后重建源码会更新 tgz 安装。历史操作证据在 `bridge-duplicate-registration-20260927/`；本轮不重复清理、不恢复旧覆写。

## 验证边界

下列类型检查、全量测试及宿主功能验证是此前交付证据，本轮没有重跑全量。2026-09-28 新执行的单实例、选择器/菜单 DOM、样式生命周期和包边界回归分别记录于 `verification/coordination-20260928/`，不得与原生点击或日常宿主删除能力合并表述。

- 插件严格类型检查、构建和 39 条测试通过。
- 新菜单与确认框在真实 React/primitives + JSDOM 中通过；剪贴板模拟，非 Electron 原生点击。
- 真实 Cordis Loader/已装 client-modules 的样式所有权回归通过。
- 宿主相关 TypeScript 构建、定向源码构建与代码检查通过。归档按钮相关 115 条测试、持久化/Workspace 相关 263 条测试、Agent 生命周期与 fork/rename/cold 回归通过。
- 真实隔离 profile 的最新运行结果与产物审计以证据目录中的 `host-acceptance.json`、`package-boundary.json` 和 `ACCEPTANCE.md` 为准。
- 原生 Electron 窗口、系统剪贴板未验证；现有电脑工具访问 GUI 返回 `ERR_BLOCKED_BY_CLIENT`。没有使用其他控制通道绕过。

## 需要我确认

删除语义已确认，没有待猜测的产品选项。剩余的是将 B 切换到现用桌面应用和原生点击验收；本次未重启正在使用的生产应用。
