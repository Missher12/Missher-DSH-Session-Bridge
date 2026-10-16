# 官方 alpha.5 增量验收 / Official alpha.5 acceptance

日期：2026-10-17。使用已发布的 Session Bridge **0.1.3 原包**，没有修改源码、构建运行件、重包或改变宿主。包 SHA256：`f722db704af3c5f64ec48452ccdf3d4d7ccade714ccf3fa1b75eb8128af033c3`。

The released **0.1.3 tarball is unchanged**. This is a bounded compatibility increment, not a new release or a claim of complete alpha.5 UI acceptance.

## 来源 / Provenance

- 官方 npm `@deepseek-ai/dsh@0.2.1-alpha.5` 及其现成依赖闭包；Cordis `4.0.5`。不是 Missher 社区扩展宿主。
- 对应[上游发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.5)，提交 `1517a4dbca0a2789ff1d41ba439600f8547d23fa`。
- 运行时 lock SHA256：`c7477a013763bb1360a7f845c09147604801301348ea5c391578fd805d60bf05`。Linux x64，隔离 HOME、配置、缓存与合成会话。
- 私有验收脚本受独立 scope 限制：内存上限 3 GiB、swap 256 MiB、CPU 100%，串行运行；没有重跑此前的 59 项检查或两套社区宿主 UI。

## 结果 / Results

| 层次 / Layer | 本轮证据 / Evidence |
| --- | --- |
| Host Loader | 真实官方 profile/Loader 启动，Bridge 单实例 active，启用组件无失败。 |
| 工具协议 / Tool protocol | 实际 ToolRuntime 的 `session_list`、`session_read`、自投递拒绝；合成转写可读。没有发送跨会话模型请求。 |
| Scratch HTTP | 认证接口创建并复用同一个固定工作区；重复调用保留 ID。 |
| 客户端发现 / Discovery | 真实 SSE boot graph 含一份 Bridge；官方组合路由返回的源文件与原包经宿主标准调试尾注包装后的字节一致。 |
| 缺少删除接口 / No delete API | `supported:false`；强制 POST 得 501 `session/delete-unsupported`，合成聊天记录与工作区文件不变。不是删除功能通过。 |
| 缺少置底接口 / No trailing placement API | 退回普通工作区排序。没有该方法的受控客户端服务不阻止原插件工厂激活；没有做真实排序 UI 验收。 |
| Host 卸载 / Unload | 从所属 Loader tree 移除后，四个工具不再注册，两条 HTTP 路由返回 404，boot graph 移除 Bridge。 |
| Client 生命周期 | 官方客户端模块系统与 Cordis Loader 加载真实冻结工厂，UI 服务为受控夹具；卸载移除自己的 style 与字典。不是浏览器渲染证据。 |

`conversation.session.header.actions` 与 `shell.overlay` 的官方声明及实现仍存在。静态契约与受控工厂加载通过，不证明 alpha.5 下的像素布局或点击。

## 限制 / Limits

- **官方 alpha.5 没有 `deleteArchivedSession`：不能用本插件删除归档聊天记录。** 插件应隐藏入口；服务端拒绝不支持的请求，不寻找私有日志路径。菜单隐藏逻辑沿用既有受控测试，本轮没有 alpha.5 菜单点击证据。
- 官方也没有 `registerTrailingWorkspace`，所以不保证 scratch 组被强制排到最后。
- 本轮没有 alpha.5 浏览器或原生 Electron 点击、真实模型调用、成功跨会话投递、shell/subprocess 工具验收。此前社区版截图只属于其原验收环境。
- 模型调用尝试与外网访问尝试均为 0。宿主有一次 Linux systemd scope 能力子进程探测，被验收守卫阻止；这不构成子进程执行通过。
- 现有两套社区宿主及 59 项测试结果保留，运行件冻结；本记录只增加官方 alpha.5 的明确证据范围，不引入精确版本门禁。

Official alpha.5 has **no archive-delete extension** and no forced trailing-workspace placement. Safe fallback passed; browser/native UI and real-model behavior remain untested in this increment. Client lifecycle evidence uses controlled UI services, while the Host Loader, ToolRuntime, authenticated HTTP and SSE checks use the actual official runtime.
