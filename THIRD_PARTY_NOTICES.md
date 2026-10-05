# Third-party notices / 第三方署名

This community plugin is maintained by Missher and is not an official DeepSeek product.
本社区插件由 Missher 维护，不是 DeepSeek 官方产品。

## DeepSeek Harness

- Upstream / 上游：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
- Copyright (c) 2026 DeepSeek. MIT License; the full permission and warranty text is preserved in [LICENSE](LICENSE).
- `src/client/ScratchWorkspacePicker.tsx` adapts the upstream `packages/client/ui-workspace/src/client/WorkspacePicker.tsx`. It retains the picker interaction and error handling while adding the scratch workspace entry and adapting directory selection to the Host service. Its compiled form is included in `lib/client/index.js`.
- `src/client/ScratchWorkspacePicker.tsx` 改写自上游工作区选择器，保留选择与错误处理流程，增加临时工作区入口并适配 Host 目录选择服务；编译形式位于 `lib/client/index.js`。
- License reference / 许可证核对基线：[dsh-v0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/LICENSE), commit `639ed015397290b3745d163aafe02ffee4aa3f84`.

## Host-provided modules / 宿主提供的模块

React, the JSX runtime, and `@deepseek-ai/dsh-client-ui-primitives` are external client modules supplied by the Host. This package does not bundle their implementations. Cordis and DSH development dependencies are used for type checking and are not shipped as Node runtime dependencies. Their upstream licenses continue to apply to their own distributions.

React、JSX runtime 及宿主 static primitives 由 Host 提供，本包不打包它们的实现。Cordis 与 DSH 开发依赖用于类型检查，不作为本包 Node 运行时依赖分发；各自发行版继续适用其原许可证。
