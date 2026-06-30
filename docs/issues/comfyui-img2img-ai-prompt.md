# ComfyUI 图生图 AI 提示词 — 本地 Issue 任务清单

> 来源：`docs/spec/03-generation.md`。每个 issue 都应能独立验证，避免一次性大改。
> 状态：已完成。实现见 `packages/client/src/main/lib/generation-service.ts`、`packages/client/src/main/lib/comfyui-chenyu-adapter.ts`、`packages/client/src/main/lib/pipeline-service.ts`、手动页和完整任务页。
> 验证：`pnpm -F @tengyu-aipod/client exec vitest run src/main/lib/comfyui-chenyu-adapter.test.ts src/main/lib/generation-service.test.ts src/main/lib/pipeline-service.test.ts`；`pnpm -F @tengyu-aipod/client type-check`；触碰文件 `biome check`。

## Issue 1 — 补齐规格与完整任务口径

目标：让 `ComfyUI 图生图` 的 AI 提示词模式在 spec 和完整任务口径里一致。

范围：

- 更新 `docs/spec/03-generation.md` 的 ComfyUI 图生图说明。
- 明确 3 种提示词模式：`AI 看图写提示词` / `工作流默认` / `手动填写`。
- 明确完整任务里的 ComfyUI 图生图也支持 AI 模式和工作流默认模式。
- 明确失败策略、日志策略、主提示词框覆盖规则。

验收：

- spec 不再写“ComfyUI 图生图不需要提示词输入框”这种旧口径。
- spec、手动页、完整任务页的能力描述一致。

## Issue 2 — 主进程 ComfyUI 图生图提示词模式最小闭环

目标：主进程支持 `promptMode`，并能在 ComfyUI 图生图里按模式决定是否生成和注入提示词。

范围：

- 扩展 `generation:run-comfyui-img2img` 输入参数。
- 新增 `promptMode = 'ai' | 'workflow' | 'manual'`。
- `ai`：每张图单独调用一次百炼视觉模型，生成 1 条 prompt。
- `workflow`：不生成 prompt，保留工作流默认提示词。
- `manual`：整批共用 1 条手写 prompt。
- 保留现有 `batchSize` 和逐张提交工作流的语义。

验收：

- 单测覆盖三种模式的分支。
- `ai` 模式每张图最多生成 1 条 prompt。
- `workflow` 模式不调用百炼。

## Issue 3 — 主提示词框识别与注入规则

目标：只替换 ComfyUI 工作流里的主提示词框，不破坏其他工作流自带提示词。

范围：

- 在 ComfyUI 输入注入链路里支持“只覆盖主提示词框”。
- 主提示词框定义为第一个非负面提示词输入框。
- `negative / 负面 / 反向` prompt 保留原值。
- 其他额外正向提示词框保留原工作流内容。

验收：

- 单测覆盖多 prompt 槽工作流。
- 单测证明 negative prompt 不会被覆盖。
- `workflow` 模式下一个提示词槽都不改。

## Issue 4 — 手动 ComfyUI 图生图表单改造

目标：手动页 `ComfyUI 图生图` 支持和 Grsai 接近的提示词体验，同时保留 ComfyUI 的工作流心智。

范围：

- 将当前 `提示词来源` 改成 3 选 1：
  - `AI 看图写提示词（推荐）`
  - `工作流默认`
  - `手动填写`
- `AI` 模式显示：
  - 印花模式
  - 参考方式
  - 提示词配置
  - 提示词模型
  - 其他要求
- `手动填写` 模式只显示手写提示词框。
- `工作流默认` 模式隐藏 AI 和手写字段。
- 右侧执行卡显示当前提示词模式。

验收：

- 默认选中 `AI 看图写提示词`。
- `手动填写` 模式整批图片共用 1 条 prompt。
- `工作流默认` 模式不要求 Skill、模型、其他要求。

## Issue 5 — 完整任务 ComfyUI 图生图表单改造

目标：完整任务里的 `ComfyUI 图生图` 也支持 AI 提示词模式，但保持简化表单。

范围：

- 增加 `提示词方式`：
  - `AI 看图写提示词（推荐）`
  - `工作流默认`
- `AI` 模式显示：
  - 印花模式
  - 参考方式
  - 提示词配置
  - 提示词模型
  - 其他要求
- `工作流默认` 模式隐藏 AI 字段。
- 更新完整任务表单校验逻辑。

验收：

- 完整任务 `ComfyUI 图生图` 选 `AI` 时必须校验 Skill 和提示词模型。
- `工作流默认` 模式不校验 Skill 和提示词模型。
- 仍使用原有完整任务启动按钮，不新增独立按钮。

## Issue 6 — 单张失败隔离与错误码

目标：AI 写 prompt 出错时，只影响当前图片，不拖垮整批。

范围：

- 为 ComfyUI 图生图 `ai` 模式补单张失败隔离。
- 当前图片 prompt 生成失败时，记录明确错误并继续后续图片。
- 新增或统一错误码/错误消息映射。
- 不自动回退到工作流默认提示词。

验收：

- 单测覆盖“第一张失败，第二张继续成功”。
- UI 结果里能看到失败数量增加。
- 不存在偷偷降级为工作流默认提示词的行为。

## Issue 7 — 运行期日志、诊断日志与结果预览

目标：让 AI 生成的 prompt 在排障和结果回看时可见。

范围：

- 运行期日志记录每张图的 prompt 摘要。
- 诊断日志记录每张图的 prompt、模型、Skill、源图索引。
- 保持 API Key、图片 base64、data URL 原文脱敏。
- 结果预览继续显示每张结果图实际使用的提示词。

验收：

- 单测证明日志不含图片 base64 和密钥。
- 手动页跑完后能在结果预览里看到每张图的实际提示词。
- 运行期日志可区分是 `AI`、`workflow` 还是 `manual` 模式。

## Issue 8 — 端到端回归与最小验收

目标：手动页和完整任务页都能跑通新的 ComfyUI 图生图 AI 提示词链路。

范围：

- 手动页跑通：
  - `AI 看图写提示词`
  - `工作流默认`
  - `手动填写`
- 完整任务页跑通：
  - `ComfyUI 图生图 + AI 看图写提示词`
  - `ComfyUI 图生图 + 工作流默认`
- 验证结果预览、失败隔离、日志输出。

验收：

- 三种手动模式都能启动并完成最小闭环。
- 完整任务的 ComfyUI 图生图两种模式都能启动。
- 失败隔离、日志、结果预览与 spec 一致。
