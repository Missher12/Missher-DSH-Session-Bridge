# Session Bridge 项目约束

- 本目录独立维护会话标识、跨会话通信、scratch 和插件 HTTP 接口。先读 README.md 与 PLUGIN_BOUNDARIES.md；原始问题及验证限制在 HANDOVER.md、REPAIR_REPORT.md。
- 不修改、打包或发布 dsh-context-manager，不引入其运行时依赖、配置行或验证快照。DSH 上游修复单独交付，不混入插件包。
- 保留宿主半边无 DSH 运行时导入的边界。客户端只有 React、JSX runtime 和宿主 static primitives 三个既有运行时请求；开发类型依赖不等于运行时依赖。
- 动态 style 插入前必须标明本插件的 data-plugin 和 data-plugin-css；清理只移除自己持有的节点，不能接管或删除其他插件样式。
- 修改后执行匹配范围的验证。客户端修改需 pnpm run check；样式生命周期改动再执行 test:styles；交付 tgz 执行 check-package-boundary.mjs。命令参数见 PLUGIN_BOUNDARIES.md。
- 区分严格类型、离线测试、真实 Loader/HTTP、DOM 与原生 Electron 点击。不能以构建或 DOM 验证替代真点击；不能测试时明确记录限制。
