# Session Bridge 0.1.5：官方 rc.4 接口与风险

2026-10-28。以下来自 npm 上精确 `0.2.1-rc.4` 包的声明及发布实现，不根据旧版或应用名字推断。版本只用于本次调查；插件运行时仍按能力探测，没有新增最低宿主版本。

## 接口调查

| 官方包 / 文件 | 实际能力与边界 |
| --- | --- |
| `dsh-api-session-controller/lib/typert.remote-client.d.ts:16–36` | 完整 `session` Remote 方法表没有永久删除；公开 Controller 也没有 `deleteArchivedSession`。 |
| `dsh-session-persistence/lib/types/index.d.ts:101–161`、`handle.d.ts:52–105` | 服务只有 create/open/flush/stat/list；句柄只有 read/append/flush/close，没有删除事务。 |
| `dsh-session-persistence-jsonl/lib/index.js:619–733,2520–2539` | 写打开取得进程内 claim 和跨进程 lease，POSIX flock / Windows semaphore；删除锁文件会破坏排他。 |
| `dsh-api-session-controller/lib/index.js:864–898`；`dsh-session-query/lib/index.js:34–46,1184–1187` | fork 先只读父会话，再创建子会话。冷读取不取得写锁；traceSession 是 corpus 快照。 |
| `dsh-session-query-sqlite/lib/index.js:646–700,760–768` | `_deleteSession` 是私有派生索引清理；索引事务不能提交权威日志及工作区状态。 |
| `dsh-storage-domain/lib/types/index.d.ts:84–90` | get 是诊断面；单表删除不提供跨存储一致性。 |
| `dsh-api-workspace-controller/lib/types/types.d.ts:110` | 归档可请求停止活动，但不等待活动停止完成。 |
| `dsh-api-gateway`、插件 `connection.fetch` | HTTP 路由只暴露已有服务能力，不能增加删除事务或所有权语义。 |
| `dsh/lib/bin.js:101,207` | launcher 负责 profile、配置和 plugin/pnpm 分派；没有可移植的 `dsh session delete` 命令。尚未穷举任意 profile 插件自定义参数，不能把未知参数当作安全删除接口。 |
| `dsh-api-workspace-controller/lib/types/client/service.d.ts:67`、`lib/index.js:258–264` | `workspaces.insertBefore(id, anchor?)` 是公开排序 API，省略 anchor 追加末尾；更改 durable registry order。官方 uiWorkspace 无可释放的 `registerTrailingWorkspace`。 |

原始包可从 [npm SessionController rc.4](https://www.npmjs.com/package/@deepseek-ai/dsh-api-session-controller/v/0.2.1-rc.4)、[Persistence rc.4](https://www.npmjs.com/package/@deepseek-ai/dsh-session-persistence/v/0.2.1-rc.4)、[WorkspaceController rc.4](https://www.npmjs.com/package/@deepseek-ai/dsh-api-workspace-controller/v/0.2.1-rc.4) 获取；其余包使用同一精确版本。

## 风险与选择

仅凭“已归档”不能证明会话已停止；即使取得父会话写锁，也封不住已经只读父会话的并发 fork。先查无子会话再删除有竞态。自行删除 JSONL 或只清 SQLite 会造成半删、孤立派生记录或重建索引后重新出现。插件没有公共事务可以消除这些风险，**官方 rc.4 上只改插件做不到符合约束的永久删除**。

0.1.5 使用同一源码和安装包：支持 `sessionController.deleteArchivedSession` 的既有宿主继续执行原流程，由宿主负责写入锁、派生关系、归档与持久化保护；官方 rc.4 返回 GET `supported:false` 及 `session/delete-unsupported` 原因，POST 501，前端显示禁用入口和原因。能力查询失败单独提示，菜单重开重查。确认前不发送删除；POST 501 不再提供无效的重复提交。插件从不触碰 Host 私有日志或索引。

侧栏保留宿主默认顺序，支持临时置底钩子的既有宿主继续使用该钩子。没有用监听器反复调用官方持久化排序 API 覆盖用户拖拽。用户仍可用宿主拖拽调整顺序；新会话选择器末尾的临时工作区入口保持。顶部 ID 控件不重新注册，侧栏完整 ID / 工作目录 / 引用复制保留。

## 验证与交付边界

精确 rc.4 接口静态调查完成。当前构建、离线行为、真实 React/JSDOM 与浏览器降级夹具的结果统一记录在包内 `COMPATIBILITY.json`；夹具不等于官方 Host 安装、真实存储删除或原生 Electron 验收。没有调用模型，也没有改日常 profile、安装目录、Host 或旧缓存/HMR 绕过。

0.1.5 的包结构和 pnpm build/test/check 脚本保持；宿主半边无 DSH 运行时导入，客户端仍只有既有 React、JSX runtime 与宿主 static primitives 三个请求。不新增桌面特供包。

## 安装、保留与回滚

使用同一插件管理入口安装完整 tgz，按 Host 提示重新加载；不要同时启用旧非 scoped 包、开发别名和正式实例。保留先前 tgz 与配置，回滚时正常结束活动后重新安装旧包。能力缺失时没有数据迁移，也无需修复会话库。

若在支持删除的宿主保留可恢复副本，应先正常退出所有使用该数据目录的进程，备份完整 profile 与实际配置的持久化存储。恢复时先正常退出并整体恢复同一快照；不要只恢复单个日志或数据库表。删除功能本身不承诺撤销。
