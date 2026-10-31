# 2026-10-31 宿主会话生命周期补丁（删除 / 移动）

本文件描述 Session Bridge 0.1.6 依赖、但**不包含在插件 tgz 中**的宿主变更。插件在缺少这些接口时明确降级为禁用入口 + 501，不读写宿主私有日志、索引、头或工作区表。

最终状态：Session Bridge 0.1.6 与宿主运行时补丁已安装到日常 desktop profile，
controller 0.1.3 已重启加载。真实会话的删除、归档删除、移动、运行中拒绝和
重启持久性均已验证；测试数据已清理，原有 70 个会话的 ID 全部保留。

## 官方 DSH 0.2.1-rc.4 的实际缺口

- `packages/api/session-controller` 没有 `deleteSession`、`deleteArchivedSession` 或 `moveSession`。
- `packages/session/session-persistence` 只有 create/open/flush/stat/list；JSONL 后端没有删除事务，日志按宿主 README 的说明“由外部移除”。
- Session 头是不可变日志头；`cwd` 属于创建元数据，公开接口不能把会话迁到另一项目目录。
- 工作区成员资格由头 `cwd` 校验，`attachSession` 不能把会话挂到不同路径的工作区。
- 因此只改插件无法同时实现“永久删除（写锁/派生关系/索引一致）”和“移动（保留 ID 与记录、后续工作目录、归属）”。

## 补丁范围（隔离源码副本，基于 `dsh-v0.2.1-rc.4` 标签）

补丁文件：`host-patches/20261031-session-lifecycle.patch`。

1. **持久化删除事务**
   - `SessionPersistence` 新增 `delete(id, options?)`；默认实现抛 `SessionPersistenceDeleteUnsupportedError`，由 JSONL 后端覆盖。
   - JSONL 删除：先取该 Session 的**独立 lineage 锁**，再校验没有派生子会话，再取普通 writer lease；随后写入持久删除墓碑 `session.deleted`，才逐个移除 generation，最后释放。墓碑让中途中断的删除不会以旧 generation “复活”；同 ID 重建会清掉墓碑。
   - 删除期间不再 unlink 正在持有的 `session.lock`；锁文件与目录保留，符合宿主既有的“release 从不删除锁文件”语义。
2. **派生创建与父删除的原子判定**
   - 所有权威子会话创建（fork、subagent 等）最终都走 `sessionPersistence.create`。父 `parentSession` 存在时，创建过程持有父 Session 的同一 lineage 锁，复查父仍存在，并把子头**先落盘**再释放；父删除持同一锁并重新扫子会话。
   - 两者竞争时：子先提交 → 删除看到子会话并拒绝；删除先提交 → 子创建在提交前因父不存在而失败。
3. **删除的可恢复完成**
   - 墓碑是删除意图的提交点；其后的 generation 移除不再响应取消。崩溃后墓碑目录对 `stat/list/open` 不可见，旧 generation 不会被重新识别为当前会话。
4. **工作区移动 journal**
   - `workspaceRegistry.beginSessionMove` 在任何写入前持久化 `pendingMutation.moveSession`（含目标工作区与目标目录）。
   - `completeSessionMove` 在同一个 journal 下先追加 `working-directory/change`（幂等），再更新 source/target 记录与 override，最后清除 marker。
   - 启动恢复对 pending move 执行同一 forward 完成过程，因此有效 cwd 与归属最终一致；存在 forward marker 时不会反向回写旧 cwd。
   - `detachSession` 同样使用 pending marker，删除后的归属/归档/置顶清理可恢复。
5. **空闲会话释放**
   - `ApiSessionAgentController` 保留其创建/恢复得到的 `AgentHandle`，新增 `releaseIdle`；生命周期操作先释放空闲 Agent（运行中的拒绝），再取得 writer lease。这样“使用过但已空闲”的会话可以删除/移动。

## 应用与验证边界

```sh
git clone --depth 1 --branch dsh-v0.2.1-rc.4 https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git apply /path/to/20261031-session-lifecycle.patch
pnpm install --frozen-lockfile
node node_modules/typescript/bin/tsc -b \
  packages/session/session-persistence \
  packages/session/session-persistence-jsonl \
  packages/workspace/workspace \
  packages/api/session-controller/tsconfig.host.json
```

### 本环境实际执行结果

- 上述 `tsc -b` 通过（退出码 0）。
- 用**已安装原始运行时**验证，未复制/重签名/安装任何原生组件：
  - 进程：已安装的 DeepSeek Harness 可执行文件 + `ELECTRON_RUN_AS_NODE=1`，
    在 `/tmp` 的隔离源码副本里运行 vitest；
  - 原生模块：隔离副本的 `native/system/packages/darwin-x64/bin/system.node`
    只是指向
    `.../app.asar.unpacked/dsh/node_modules/@deepseek-ai/node-addon-system-darwin-x64/bin/system.node`
    的**只读符号链接**，未复制、未修改、未签名。
- 目标宿主测试 4 个文件、**94 条通过**（退出码 0）：
  - `session-persistence-jsonl/tests/delete.spec.ts`（真实文件存储的删除/墓碑/同 ID 重建、子会话拒绝、writer 占用拒绝）；
  - `workspace/tests/workspace.spec.ts`（既有工作区回归）；
  - `workspace/tests/session-move.spec.ts`（move journal 的重启恢复、cwd 已提交时幂等、完成后半失败后恢复、失败 marker 未被新操作覆盖）；
  - `session-controller/tests/lifecycle.host.spec.ts`（**真实 AgentLoop + 真实 JSONL 存储**：
    已使用但空闲会话的删除/移动、真实对话事件与标题在移动前后保持前缀一致、未落盘空白会话删除、
    `Promise.all` 并发移动两个真实会话、重启后归属/有效目录、外部 writer 与运行中 Agent 拒绝）。
- 插件侧（0.1.6 tgz）在**隔离 profile**中用同一原始运行时安装并启动，真实 HTTP 路由返回：
  `delete GET={"supported":false,...}`、`move GET={"supported":false,...}`、
  两个 POST 均为 501；没有读取或修改任何私有会话存储。该隔离 profile 在 `/tmp`，不是日常 profile。

### 首次源码交付时的边界（后续安装结果见下文）

- 未把补丁打进日常 DSH、未构建或打包新的 Mac 应用，也未安装到日常 profile。
- 最新 DSH 全量测试没有全部重跑；完整宿主构建、Electron 窗口点击和发布签名验收未执行。
- `lease.spec.ts` 的跨进程 flock 用例在本机未稳定完成；因此**跨进程 fork/delete 的真实并发**未实测。
  代码路径使用与子创建/删除共享的 `flock` lineage 锁，但本报告不把单元测试等同于该场景已验收。
- 空闲会话释放依赖控制器持有的真实 `AgentHandle`；本环境用真实 AgentLoop 验证了正常空闲释放，
  但未覆盖子代理运行时等非本控制器持有的 Agent（这些仍会以 busy 拒绝）。
- 系统曾拦截复制/重签名的原生组件路线；本补丁不再走该路线，也不会要求关闭系统保护或反复点弹窗。

## 2026-10-31 日常 profile 安装状态

实际安装方式（未修改 `app.asar`、Electron 二进制、签名或原生 `system.node`）：

- 插件：`@missher/dsh-session-bridge` 0.1.6 已安装在
  `~/.dsh/profiles/desktop/node_modules`，profile bundle 仍是原来的
  `@missher/dsh-session-bridge`。
- 宿主运行时：`host-patches/runtime/` 的三个包（persistence-jsonl、workspace、
  controller）安装到 `~/.dsh/plugin-packages/sb-host-runtime/`，并在 profile
  `package.json` 中以 `file:` 依赖引用。
- profile 层：`~/.dsh/profiles/desktop/cordis.patch.yml` 禁用官方
  `session-persistence-jsonl`、`workspace`、`session-controller` 三行，再插入
  三个同 service 名、不同 id 的 patched 行。官方原行保留在合成树中但 disabled。
- 没有把测试 fixture 或测试插件加入日常 profile；没有修改用户已有 70 个会话。
- 三个 runtime 包已复制到 `host-patches/runtime/`（与安装内容同 SHA-256），
  不依赖 `/tmp` 路径；`profile-snippet.yml` 是同款替换片段。

### 真实日常 Host 验收（0.2.1-rc.4，HTTP + 持久存储）

- 70 个原有会话全部保留（基线 ID 全部仍在）；新建 4 个 `SB 验证 ...` 临时会话。
- 普通已使用会话删除：HTTP 200，`session/list` 不再出现，日志目录留下
  `session.deleted` 墓碑且 generation 已移除。
- 归档后删除：HTTP 200，归档会话从列表消失。
- 未确认删除/移动：HTTP 400，会话仍存在。
- 真实运行中会话（实际 prompt 正在跑）：删除/移动均 HTTP 409
  `session/delete-active` / `session/move-active`。
- scratch（`/tmp/sb-daily-verify/scratch`，原本无 workspace）会话移动到现有
  Crodis workspace；真实 bash `pwd` 输出
  `<user>/Documents/Deepseek-File/Crodis`；移回 scratch workspace 后再
  移到 Crodis，同一 ID/标题/历史；最终 pwd 仍为 Crodis。
- 清理后仅保留 1 个临时会话供 Codex 重启校验：
  `session-de1bcd2a-846f-451a-beda-1bce4024c650`，标题
  `SB 验证 移动-Crodis`，Crodis workspaceId
  `16fc9ad4-6a7d-40e6-bca9-75eab63d05b8`，历史首轮
  `SB-MOVE-PROBE` 及移动前记录已保留。
- 临时 scratch workspace 已删除；没有动 70 个既有会话。

### 重启前发现的协议回归与修复

首次安装的 controller 是从 tag 源码重建的整类替换，重启后发现旧
`session/events` / `session/state` 404，`session/page` 省略 `throughSeq` 失败。
已改为**继承已安装 SessionController** 的薄子类，只新增生命周期方法，保留原
Remote 方法。隔离 profile 复测：

- `session/events` 200（返回事件记录）；
- `session/page` 省略 `throughSeq` 200；
- `session/state` / `session/wait` 200；
- delete/move GET `supported:true`，实际 delete/move 200。

随后又修正了所有权边界：薄封装只在**原 ApiSessionAgentController 自身**的
`resolve`/`claim`/`createMinted` 和 `fork` 调用内捕获 handle，其他组件直接
调用 `ctx.agents.*` 不会被接管；每次调用使用独立 token，调用 settle 后 token
失活，继承上下文的延迟任务不会再被捕获；替换的 registry 方法和监听只在仍是
本封装 wrapper 时恢复，不会覆盖后续组件的替换；正常 fork 子会话可移动/删除。
专门的 `scope-check` 验证了延迟继承 token 失活、嵌套 token 与外层恢复、以及
后来替换 wrapper 不被 dispose 覆盖。隔离 profile 的最终验证：

- `session/events`、`session/page`（省略 `throughSeq`）、`session/state`、
  `session/wait` 均 200；
- 普通空闲会话删除 200；
- 真实 fork 子会话移动 200、删除 200；
- 真实运行中 prompt 的删除/移动均 409；
- 保留的移动会话仍存在。

最终 controller 产物（版本 0.1.3，sha256
`8ecb19c5d3b7ddf6642db540c2af777299d4425f71a55edbc0c82f561f26f3ce`）已写入：

- `~/.dsh/plugin-packages/sb-host-runtime/controller/`（profile 依赖的真实路径）；
- `~/.dsh/profiles/desktop/node_modules/@missher/sb-host-session-controller/`
  （pnpm 安装出的实体副本，已刷新为同一 SHA）；
- `host-patches/runtime/controller/`，薄封装源码在
  `host-patches/runtime/controller-src/`。

### 最终日常重启与操作验收

Codex 已重启日常 DSH 加载 controller 0.1.3，并独立验证：

- `session/events`、`session/page`（省略 `throughSeq`）、`session/state`、
  `session/wait` 全部 HTTP 200；删除和移动能力均为 `supported:true`。
- 重启后保留会话的 ID、标题、4 个 turn、全部历史标记和 Crodis 工作区归属不变，
  有效目录仍为 `~/Documents/Deepseek-File/Crodis`；之前删除的临时会话没有复现。
- 在最终日常版本执行真实新回合，bash `pwd` 返回 Crodis；该回合运行时删除、
  移动均返回 409。结束后移动到新建临时工作区，再移回 Crodis，均返回 200，
  逐条事件前缀保持一致；未确认移动返回 400。
- 最终版本普通空闲会话删除和已使用归档会话删除均返回 200。
  两个被删会话的 generation 文件均已移除，只保留删除墓碑和锁目录。
- 所有本次临时会话及临时工作区已清理；最终 `session/list` 为 70 条，
  与验收前原有会话 ID 集合完全一致。

### 仍未验证

- 原生 Electron 菜单点击；HTTP 与 DOM 测试不能替代真 UI；
- 完整 Host 重编译/重新打包签名；没有替换 app.asar 或原生组件；
- 多进程 fork/delete 真实竞争。

## 2026-10-31 客户端注册回归（上轮安装未验证前端）

上轮把官方 `session-controller` 行 disabled 后替换为仅 host 的包。Host HTTP
的 delete/move 可用，但 Web 前端启动时加载不到官方
`@deepseek-ai/dsh-api-session-controller/client.js`；该 client 注册
`ClientSessions` 并提供浏览器 `sessions` 服务，导致 36 项 pending，
`modelDirectories` 等连锁失败。上一轮只做了后端 HTTP/持久化验收，没有验证
Electron/Web UI，这是安装验收的遗漏。

### 最小修复

- **保留官方 `session-controller` 行**，不 disable；官方 client 模块继续按原
  module id 注册，`sessions` 服务恢复。
- 仅继续替换 `session-persistence-jsonl` 和 `workspace` 两行。
- 插入 host-only 装饰插件 `@missher/sb-host-session-lifecycle`：在官方
  controller 实例上追加 delete/move，复用 post-patch 的 lifecycle 事务；封装
  只捕获官方 controller 自己的 ApiSessionAgentController 调用，使用独立
  token/作用域，dispose 时按 wrapper 身份恢复，fork 子会话可管理。
- profile 变更已准备为 `host-patches/runtime/profile-snippet.yml` 和窄范围
  `apply-profile-fix.sh`；脚本只校验并替换两个 SB 片段，其余用户 profile
  原文保留，不保存整份 profile 快照或整份备份。Codex 已在所有会话空闲、
  Host 退出后执行该窄范围更新并重启，其他 profile 内容保持不变。

### 隔离 profile 实际 Web UI 验证

用同一真实 Web Host + ego-browser 加载页面：

- `window.__DSH_BOOT__` 含官方 `@deepseek-ai/dsh-api-session-controller` entry
  （22 个依赖方）；`__ModuleLoader__.pendingQueue.length === 0`；
- 页面正常渲染（工作区侧栏、新会话、模型入口均存在）；隔离 profile 没有
  账号，因此显示登录/模型提示，这是预期，不是加载失败；
- 同一隔离 Host 上：`session/events`、`session/page`（省略 `throughSeq`）、
  `session/state` 均 200；空闲删除 200；fork 子会话 move/delete 200；真实
  运行中 prompt 的 delete/move 均 409。

Codex 已在修复后的日常原生 Electron 窗口验证：主界面、工作区与会话列表
正常加载，模型选择菜单可打开并关闭，未改变原模型选择。此后安装插件 0.1.7
并重启，主界面与已有测试会话仍正常显示。原生拖放的单独限制见文末。

最终 decorator SHA-256：
`65c6bbeaa8949a37ee58d05b666ddb1d8363ebad0d9ac8fadc43d2283b4a9a67`。

## 保留临时会话的最终状态

此前保留的 `session-de1bcd2a-846f-451a-beda-1bce4024c650` 已被 Codex 在重启
校验后清理；当时日常 `session/list` 为 **70** 条，磁盘上该 id 目录存在
`session.deleted` 墓碑，原有 70 个会话 ID 均保留。后续拖放验收另建了文末
所列临时会话，该会话不计入这 70 个原有会话。

## 2026-10-31 会话移动改为侧栏拖放（插件 0.1.7）

菜单“移动到工作区…”和工作区选择弹窗已移除；删除功能保留。侧栏会话行可直接拖到
工作区行（包括“未分组”会话拖到 Crodis，以及工作区之间拖动），调用同一个
`sessionController.moveSession` 事务。拖入同一工作区不发送请求；运行中被 Host
拒绝并显示原因；失败不显示成功。`sessionId`、标题、历史和后续有效 cwd 由 Host
事务保留。

实现复用原生 `data-row-key` 行与原生 HTML5 drag 事件，不复制会话、不改视觉分组。
跨工作区 drop 前会用一次合成 `dragover` 将原生内部 hover 重置为源会话本身，
使随后的原生 `dragend` 清理状态而不是提交同组旧排序；同组会话行 drop 完全走
原生排序，不拦截。

验证：

- JSDOM 真 React/primitives：跨工作区 drop 发 1 次 move、同工作区 drop 不发、
  409 显示“仍有活动任务”；`dragAcrossWorkspace/dragSameWorkspaceNoop/dragRefusalShown`
  均通过。
- 真实 Chromium Web UI（隔离 Host，`pendingQueue=0`）：从“未分组”拖到 Crodis、
  工作区之间拖、同工作区头 drop 均实测；在“先经过同组另一会话再放到其他工作区”
  与“放回同工作区头”两种结束路径下，源工作区会话顺序保持不变，无残留高亮，
  随后再次拖动也正常，说明原生拖动状态已清理。
- 原生 Electron 拖放随后由用户手动完成并通过 RPC 独立核验，见下节“原生拖放
  诊断与最终验收”。

## 2026-10-31 原生拖放诊断与最终验收（0.1.7）

- 日常会话 `session-6e904ba8-f38b-416f-b208-4caeda69b3ba` 在展开工作区后
  实际 DOM 为 `draggable="true"`；它不是被 `workspace/insertSessionBefore`
  access 门控卡住的行。
- Crodis 工作区行实际 `data-row-key="workspace:16fc9ad4-6a7d-40e6-bca9-75eab63d05b8"`；
  插件目标判定使用同一 workspaceId，合成 `dragover` 在该行返回
  `defaultPrevented=true` 并出现高亮，说明“目标不匹配”不是当前失败层。
- 文档上实际安装了插件的 capture `dragstart`/`dragover`/`drop`/`dragend`
  监听器；官方 controller/client 正常，`pendingQueue=0`。
- 但用自动化鼠标执行拖放时，没有取得
  `dragstart → dragover → drop` 的实际事件链：ego `dragAndDrop` 在每日页面上
  被指针拦截/选择器不可定位，CDP 页面加载也多次超时，无法把“真实鼠标已产生
  拖动”作为证据。Codex 用 CUA 原生鼠标从标题区、左侧空白处各尝试一次，
  界面无成功反馈，随后 RPC 读到 cwd 仍为 scratch；没有取得原生 DOM
  事件日志，因此不能断言原生 dragstart 或 drop 是否触发。
- 这段记录只说明自动化鼠标工具本身无法给出事件链，不代表最终功能失败。
  随后用户手动原生拖放成功，并由 RPC 独立验证；以该最终验收为准。

Codex 已在日常 0.1.7 的原生三点菜单确认“移动到工作区…”消失、删除入口保留，
点击“删除会话…”显示带准确测试会话 ID 的永久删除确认，取消后会话仍存在。
尚未点击原生“确认删除”。

随后用户明确回报：手动把“SB 拖动验收（临时）”拖到 Crodis 后，**成功移入
Crodis**。Codex 独立通过 RPC 验证：原 sessionId 和标题不变，移动前完整事件
前缀逐条保持一致，`workingDirectory` 已变为
`~/Documents/Deepseek-File/Crodis`。这项原生鼠标成功的证据来自
用户手动操作，不能记为 CUA 自动拖放通过。

Codex 随后调用已安装插件的鉴权删除接口清理该临时会话，返回 HTTP 200，
会话不再出现在列表中。原有 **70 个会话 ID 全部保留**；当时列表为 71 条，
额外会话不属于该测试，未作清理。删除验证覆盖原生确认/取消与真实删除接口，
未声称点击过原生最终删除按钮。


## 0.1.8 精简（仅清理死代码）

日常现已安装 **0.1.8** 并重启。只删除已无调用的旧菜单遗留：

- `readSessionMoveCapability` / `SessionMoveCapability` 及对应测试与导出；
- 7 个旧移动弹窗 CSS；
- 8 个旧菜单/弹窗中英文 locale 键。

拖放实现、宿主装饰器、锁与事务、删除功能、错误处理均未改动。没有操作任何
会话数据。用户手动拖动与 Codex 的 RPC 校验记录保留在本文件前文。

0.1.8 的 `pnpm run check` 为 56 通过、0 失败、12 跳过；现有 React/JSDOM
菜单与拖放检查、安装包边界检查通过。安装后原生主界面和工作区列表正常，
原有 70 个会话 ID 全部保留。用户也确认，所说“消失”的就是此前由 Codex
清理的临时测试会话，并非其他会话在移动中丢失。

## 0.1.9 工作区实时状态（本地已安装）

2026-10-31，DSH 原开发会话实现，Codex 完成代码复核及日用安装验收。本记录
包含 0.1.9 源码、预构建客户端与验收结果；正式 Release 资产另行发布。

- 工作区标题旁显示橙色“等你处理 · N”、蓝色“工作中 · N”、绿色“已完成”
  或灰色“空闲”；折叠后仍可见。等待与运行并存时保留两项计数。
- 订阅现有 uiSession、Session 列表、workspaces 和 connection.generation，统计
  全部成员，按原生状态语义折叠父子活动；断连或列表未同步显示“状态未知”。
- 绿色要求宿主 completionUnread 未读，且 session/events 最后 turn/end 的
  reason.kind 为 completed；取消、失败和中断不算成功。查看后沿用宿主已读清除。
- 完成校验按会话分别跟踪，其他会话更新不会取消它；历史读取限 maxMessages=8。
- 原生验收发现 Remote 返回的是 {ok,value}，旧实现误读 page.records，导致永远
  不变绿。已改为仅 ok=true 时读取 value.records，并用真实返回形状补回归。
  先前把缺少 remote 注入判断为根因的结论不成立；显式依赖声明保留。

验证结果：

- pnpm run check：58 通过、0 失败、12 项原有 SDK 相关跳过。
- React/JSDOM：已有菜单/拖放，以及并发完成、等待/运行优先级、Result 成功和
  ok=false 不变绿均通过。旧实现在真实 Result 形状下失败，修复后通过。
- 隔离 Host 曾观察真实 aborted/error 不变绿；Result 修复后未重复隔离运行，
  原因解析与失败信封由自动检查覆盖。
- 日用原生 Electron：正常启动；Crodis 折叠时蓝色“工作中 · 1”可见；最终修复包
  中真实 SB_GREEN_OK 回合结束后变为绿色“已完成”，点击对应会话后回到“空闲”。
- 未在日用环境主动断连或触发真实审批/提问；对应状态由订阅、聚合和组件检查覆盖。
- 包边界检查通过，70 个文件、三个既有客户端运行时请求，无宿主补丁或运行时导入。
  安装后客户端字节与本地修复构建一致，profile 配置及其他依赖保持不变。
- 安装前 71 条会话 ID 全部保留；最终列表 72 条，额外会话未作清理。

最终运行包为 dist/missher-dsh-session-bridge-0.1.9.tgz；日用安装使用同内容的
0.1.9-result-fix.tgz 文件名以区分同版本候选。本文是安装后的验证记录，未为
仅更新记录而重新构建运行包。
