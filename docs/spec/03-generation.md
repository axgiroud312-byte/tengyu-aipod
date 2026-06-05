# Spec 03 — 生图模块

> 统一生图模块，按业务入口分 5 个 Tab。v1 支持两个生图 provider：`comfyui-chenyu`（晨羽智云 ComfyUI）和 `grsai`（付费模型）。
> 当前 UI 收敛规则：**只合并文生图**；图生图、提取、抠图、提取后抠图仍保留各自路径交互。

## 1. 模块结构

```
┌─ 生图模块 ────────────────────────────────────────────┐
│ Tab 切换：[文生图] [图生图] [提取] [抠图] [提取后抠图] │
│                                                       │
│ 文生图：统一页面 + 右侧生图路径切换（Grsai / ComfyUI） │
│ 图生图：保持 Grsai / ComfyUI 原入口与原交互            │
│ ComfyUI 路径：右侧显示运行云机选择卡                  │
│ 顶部：日志按钮打开命令行式生图运行期日志弹窗           │
└──────────────────────────────────────────────────────┘
```

### 1.1 5 个入口 × 2 个 provider 实现矩阵

| 能力 | comfyui-chenyu | grsai |
|---|---|---|
| 文生图 | ✅（文生图工作流可选）| ✅ |
| 图生图 | ✅（多个工作流可选）| ✅（4 种模式：参考构图/参考风格/构图+风格/自己写）|
| 提取 | ✅（提取工作流 + 提取 Skill）| ✅（图生图 + 同一套提取 Skill）|
| 抠图 | ✅（抠图工作流 / 混合路径）| ❌（不内置）|
| 提取后抠图 | ✅（提取工作流 → 抠图工作流）| ❌ |

### 1.2 输入域

各能力的输入约束：

| 能力 | 输入 | 强约束 |
|---|---|---|
| 文生图 | 纯提示词 | 不接收源图 |
| 图生图 | Grsai：提示词 + 参考图；ComfyUI：图片文件夹 + 工作流 + 尺寸 | ComfyUI 扫描任意文件夹后，外部图片先登记为 `manual-import` 印花 artifact，再注入工作流 |
| 提取 | Grsai：提示词 + 采集图（源）；ComfyUI：图片文件夹 + 工作流 + 尺寸 | ComfyUI 可直接使用任意文件夹扫描到的图片路径作为源图 |
| 抠图 | ComfyUI：图片文件夹 + 抠图工作流 + 尺寸 | 外部图片先登记为 `manual-import` 印花 artifact，再注入直接抠图或混合抠图工作流 |
| 提取后抠图 | ComfyUI：图片文件夹 + 提取工作流 + 抠图工作流 + 尺寸 | 外部图片先登记为 `manual-import` artifact，提取中间图走临时目录，最终图落入抠图目录 |

**铁律**：采集图必须先提取才能成为印花。提取后抠图是“先提取、再抠图”的组合入口；源图先登记为 `manual-import` artifact，中间提取图不作为最终业务图片保留。

### 1.3 输出域

```
02-印花工作区/
├─ 文生图/{任务名}/{印花ID}.png
├─ 图生图/{任务名}/{印花ID}_v1.png ({印花ID}_v2.png ...)
├─ 提取/{任务名}/{印花ID}.png
└─ 抠图/{任务名}/{印花ID}.png         ← 抠图 / 提取后抠图的最终透明底图
```

能力目录下按任务建子文件夹，避免多次运行的图片混在一起。文件名带印花 ID + 版本号。**目录只放最终成品图，中间产物（如黑白遮罩）走 TempFileManager 临时区**。

### 1.4 完整任务调用边界

完整任务最初版复用生图模块已有 runner，不通过 UI 自动点击；当前完整任务页把来源区收成三类入口，`existing_prints` 仍保留在底层兼容层，不作为主入口：

- `collection` 来源：从采集目录扫描图片后调用提取能力，完整任务页里这一支可在 Grsai / 晨羽间切换。
- `txt2img` 来源：完整任务页固定走 Grsai 付费模型直接产生印花。
- `img2img` 来源：完整任务页固定走 Grsai 付费模型直接产生印花，并提供参考构图 / 参考风格 / 构图+风格 / 自己写四种参考方式。
- `existing_prints` 兼容来源：跳过生图，直接扫描已有印花文件夹。
- 抠图是完整任务中的可选 step；局部印花默认开启，满印默认关闭。

完整任务首版不新增生图 provider，不改变各能力目录的输出规则。完整任务在进入 PS 前会额外创建
`02-印花工作区/等待套版/{runId}/`，把最终可套版印花复制为按 **印花货号** 命名的图片副本；
这一步不回写原始印花 ID，也不改动生图模块已登记的 artifact。
完整任务进度会把生图、提取和抠图 runner 返回的产物转成阶段化 `result_sections`，
供完整任务页下方结果区展示；旧的 `preview_images` 字段仅作为兼容字段保留，不再作为 UI 扩展主入口。

## 2. Provider 抽象

### 2.1 Provider 数据结构

```ts
interface PaidProvider {
  id: string                          // "grsai" | future
  name: string                        // 显示名
  base_url: string                    // 主节点
  fallback_url?: string               // 备用节点
  api_style: ApiStyle                 // 决定用哪个 adapter
  endpoints: {
    generate?: string                 // POST 生图
    result?: string                   // GET 异步查询
    chat?: string
  }
  model_options: string[]             // 可选模型列表
  default_params: Record<string, unknown>
  enabled: boolean
  capabilities: ('txt2img' | 'img2img' | 'extract' | 'matting')[]
}

type ApiStyle =
  | 'grsai-native'                    // POST /v1/api/generate
  | 'openai-images'                   // POST /v1/images/generations
  | 'openai-chat'                     // POST /v1/chat/completions
  | 'dashscope-native'                // 阿里云 DashScope
```

### 2.2 ComfyUI Provider 数据结构

```ts
interface ComfyuiProvider {
  id: string                          // "comfyui-chenyu"
  name: string
  cloud_service: 'chenyu'             // 当前只支持晨羽
  api_key_keychain_id: string         // 在 OS keychain 里的 key
  fixed_pod: {
    pod_uuid: string                   // 杭州慎思 POD，主界面不让用户编辑
    default_pod_tag: string
    default_gpu_uuid: string
  }
  default_instance: {
    instance_uuid: string             // 晨羽返回
    comfyui_url: string               // server_map 里 ComfyUI 端口的 url
    status: 'starting' | 'running' | 'shutting_down' | 'stopped' | 'none'
  } | null
  // 关机策略
  auto_shutdown: {
    enabled: boolean
    minutes_after_idle: number        // 默认 60
  }
}
```

### 2.3 Adapter 接口

```ts
// 所有 adapter 实现的统一接口
interface ImageGenerationAdapter {
  generate(req: GenerateRequest): Promise<GenerateResponse>
}

interface GenerateRequest {
  capability: 'txt2img' | 'img2img' | 'extract' | 'matting'
  prompt: string
  reference_images?: { base64: string; mime_type: string }[]
  output: {
    aspect_ratio?: string
    size_px?: { width: number; height: number }
    image_size_label?: '1K' | '2K' | '4K'
    format?: 'jpg' | 'png'
  }
  model?: string                     // provider 内部模型选择
  workflow_id?: string               // comfyui 工作流 ID
  options?: Record<string, unknown>
}

interface GenerateResponse {
  status: 'succeeded' | 'failed' | 'violation'
  images: { url: string; local_path?: string }[]
  raw_response?: unknown             // 原始响应供调试
  error?: AppError
}
```

每个 `ApiStyle` 对应一个 adapter 实现：
- `GrsaiAdapter` (`grsai-native`)
- `OpenAIImagesAdapter` (`openai-images`)
- `ComfyuiAdapter`（特殊，操作晨羽实例 + ComfyUI HTTP）

### 2.4 ComfyUI Adapter 详情

详见 [../../references/generation-comfyui/chenyu-cloud-api.md](../../references/generation-comfyui/chenyu-cloud-api.md)。

```ts
class ComfyuiChenyuAdapter implements ImageGenerationAdapter {
  constructor(
    private chenyu: ChenyuCloudClient,    // 晨羽 API 客户端
    private comfyHttp: ComfyHttpClient,   // ComfyUI 原生 HTTP
    private workflowCache: WorkflowCache  // 本地导入并缓存的工作流
  ) {}

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    // 1. 使用本次任务选择的运行云机；未选择时回退到默认云机
    const instance =
      this.options.selectedInstance ?? (await this.instanceManager.refreshCurrentInstance())
    if (!instance || instance.status !== 'running') {
      throw new AppError({
        code: 'CHENYU_INSTANCE_DOWN',
        message: '请选择运行中的云机',
      })
    }
    const comfyHttp = this.comfyHttpFor(instance.comfyuiUrl)
    
    // 2. 拉取工作流（按 capability + workflow_id）
    const workflow = await this.workflowCache.get(req.workflow_id!, req.capability)
    
    // 3. 上传素材图（如果有参考图）
    if (req.reference_images) {
      for (const img of req.reference_images) {
        await comfyHttp.uploadImage(img.base64, /* filename */)
      }
    }
    
    // 4. 注入参数到 workflow JSON 的 input_slots
    const injected = injectInputs(workflow, req)
    
    // 5. 提交 prompt
    const { prompt_id } = await comfyHttp.queuePrompt(injected)
    
    // 6. 轮询 /history/{prompt_id}
    const result = await this.pollHistory(prompt_id, { intervalMs: 2000, timeoutMs: 600000 })
    
    // 7. 下载输出
    const images = await this.downloadOutputs(result.outputs)
    
    return { status: 'succeeded', images }
  }
  
}
```

### 2.5 Grsai Adapter 详情

详见 [../../references/generation-paid/grsai-api.md](../../references/generation-paid/grsai-api.md)。

```ts
class GrsaiAdapter implements ImageGenerationAdapter {
  constructor(
    private apiKey: string,
    private node: 'global' | 'cn' = 'cn',
  ) {}

  private get baseUrl() {
    return this.node === 'cn' ? 'https://grsai.dakka.com.cn' : 'https://grsaiapi.com'
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    // 1. 把 reference_images 转成纯 base64（去掉 data: 前缀）
    const images = (req.reference_images ?? []).map(img => stripDataUrl(img.base64))
    
    // 2. 调 POST /v1/api/generate
    const response = await this.http.post(`${this.baseUrl}/v1/api/generate`, {
      model: req.model ?? 'gpt-image-2',
      prompt: req.prompt,
      images,
      aspectRatio: req.output.aspect_ratio ?? '1024x1024',
      replyType: 'json',  // 同步模式
    })
    
    // 3. 解析响应
    if (response.status === 'succeeded') {
      const images = await Promise.all(
        response.results.map(r => this.downloadAndSave(r.url))
      )
      return { status: 'succeeded', images }
    }
    if (response.status === 'violation') {
      return { status: 'violation', images: [], error: { code: 'GRSAI_VIOLATION', message: '内容违规', retryable: false }}
    }
    return { status: 'failed', images: [], error: { code: 'GRSAI_FAILED', message: response.error ?? '生成失败', retryable: true }}
  }
}
```

**异步模式**（v1.5）：当 replyType='async' 时返回 task_id，轮询 `/v1/api/result?id=...`。

**节点 fallback**：原节点抛出网络/5xx/429 等可重试错误，或返回 `status=failed` 时，先切到另一个节点重试一次；`status=violation` 不切节点、不重试。

## 3. Skill 系统

### 3.1 Skill 数据结构

```ts
interface PaidSkill {
  id: string                          // "extract-paid-model" 或后台新增的提取 Skill ID
  module: 'generation'                // 模块名
  category: string                    // "txt2img-local-print" | "extract-paid-model" | ...
  version: string                     // "3.0.1"
  enabled: boolean
  system_prompt: string               // LLM 的 systemMessage
  variables: SkillVariable[]          // UI 渲染所需
  recommended_llm: string             // 当前默认 "qwen3.6-flash"
  // 不包含 output_format / output_schema
  // 客户端用通用解析器兜底
}

interface SkillVariable {
  key: string                         // "printMode"
  label: string                       // UI 显示
  type: 'select' | 'number' | 'text' | 'textarea' | 'checkbox'
  options?: { value: string; label: string }[]
  default?: unknown
  min?: number
  max?: number
  required?: boolean
  placeholder?: string
  help?: string                       // 帮助文本
}
```

### 3.2 输出格式约束（Skill 自描述，客户端兜底解析）

文生图和图生图的提示词生成 Skill 应要求模型返回对象数组：

```json
{
  "prompts": [
    { "index": 1, "prompt": "prompt text" },
    { "index": 2, "prompt": "prompt text" }
  ]
}
```

客户端只读取 `prompt` 字段。`index` 只用于单批结果内部排序；当 1000 条提示词被拆成 10 批时，每批都可能返回 `index=1..100`，客户端不会依赖跨批 index 唯一性。

提取 Skill 不走百炼提示词生成，也不要求 JSON。客户端把用户选中的提取 Skill `system_prompt` 直接作为每张源图的提取 prompt，Grsai 和 ComfyUI 共用同一组提取 Skill。

```ts
// 通用解析器
function parsePrompts(text: string, count: number): string[] {
  // 1. 试 {"prompts":[{"index":1,"prompt":"..."}]}
  // 2. 兼容 JSON 数组 / {"prompts":["..."]}
  // 3. 兼容 markdown 代码块里的 JSON
  // 4. 最后按行拆 + 去序号
}
```

### 3.3 提示词批量拆分

百炼只负责给文生图和图生图写提示词，不参与最终生图。客户端负责把用户要求拆成批次并并发调用：

```ts
const total = 1000
const batchSize = 100
const batches = 10
const llmConcurrency = 10
const timeoutMs = 10 * 60_000
const retryOnFailure = true
const model = 'qwen3.6-flash'
```

规则：
- 文生图和图生图提示词生成都默认使用 `qwen3.6-flash`，该模型按当前配置同时承担文本和多模态输入。
- 客户端按 `100 条/批` 拆分，例如 1000 条 = 10 批。
- 10 批并发发送给百炼；单批 10 分钟不返回则视为超时并重试。
- 每批返回后单独解析为 100 条提示词，最后按批次顺序合并成 1000 条进入提示词审稿。
- 程序不在 Skill 之外额外强加业务内容，只负责批次拆分、超时、重试和结果解析。
- 提取能力不走本节的批量提示词生成；提取是一张源图对应一次 provider 运行。

兼容兜底解析：

```ts
function parsePrompts(text: string, count: number): string[] {
  try {
    const parsed = JSON.parse(text)
    const prompts = Array.isArray(parsed) ? parsed : parsed.prompts
    if (Array.isArray(prompts)) {
      return prompts
        .map(item => typeof item === 'object' && item ? item.prompt : item)
        .map(String)
        .filter(Boolean)
        .slice(0, count)
    }
  } catch {}
  
  // 试 markdown 代码块里的 JSON
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
  if (codeBlock) {
    try {
      const parsed = JSON.parse(codeBlock[1])
      const prompts = Array.isArray(parsed) ? parsed : parsed.prompts
      if (Array.isArray(prompts)) {
        return prompts
          .map(item => typeof item === 'object' && item ? item.prompt : item)
          .map(String)
          .filter(Boolean)
          .slice(0, count)
      }
    } catch {}
  }
  
  return text
    .split(/\r?\n/)
    .map(s => s.replace(/^\s*(?:\d+[.、）)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, count)
}
```

### 3.4 Skill 在云端的派发

```
GET /api/skills?module=generation&category=txt2img → [PaidSkill]
GET /api/skills/{id}                                → PaidSkill (full)
```

客户端启动时拉所有 module=generation 的 skill 列表（不含 system_prompt 全文）→ 按需拉单个。

缓存 30 分钟刷新一次。

文生图 / 图生图提示词生成也按同一 category 多条 Skill 管理。客户端根据当前业务组合只展示对应 category 下的 Skill，下拉选择后运行时传 `skillId`；不把四类混在一个大下拉框里。

| 组合 | category | 默认 Skill ID |
|---|---|---|
| 文生图局部 | `txt2img-local-print` | `txt2img-local-print` |
| 文生图满印 | `txt2img-full-print` | `txt2img-full-print` |
| 图生图局部 | `img2img-local-reference` | `img2img-local-reference` |
| 图生图满印 | `img2img-full-reference` | `img2img-full-reference` |

提取能力使用同一组 Skill：`module='generation'`，`category='extract-paid-model'`。这个 category 名称沿用历史 ID，但业务含义是“提取提示词”，不是只给付费模型使用。后台可以创建多条不同 `id` 的提取 Skill，客户端在 Grsai 提取和 ComfyUI 提取里都展示给用户选择。

## 4. 文生图能力（Grsai / ComfyUI）

### 4.1 UI

```
[Tab: 文生图]

模式：
  ┌─────────────────────────────┐
  │ ● 智能生成提示词             │
  │ ○ 自己写提示词               │
  └─────────────────────────────┘

【AI 生成模式】
  ① 印花类型：
     ● 局部（白底居中）  ○ 满印（铺满画面）
  
  ② 提示词数量：[5] (1-1000)
  
  ③ 印花要求：
     [textarea，placeholder: "圣诞风格小熊主题，复古海报感"]
  
  提示词配置：[当前组合下的 Skill ▼]
  语言模型：[qwen3.6-flash ▼]
  
  [生成提示词] ← 调阿里云百炼

【提示词审稿】
  AI 已生成 5 条：
  ┌──────────────────────────────────────────┐
  │ ☑ Cozy Christmas teddy bear ...           │
  │ ☑ Vintage Christmas card style ...        │
  │ ☑ Hand-drawn santa bear illustration ...  │
  │ ☑ ...                                     │
  │ ☐ ...                                     │
  └──────────────────────────────────────────┘
  [编辑]  [重新生成]  [+ 添加自定义]

【右侧：生图设置】
  生图路径：● Grsai  ○ ComfyUI 工作流

  当选择 Grsai：
    生图模型：[gpt-image-2 ▼]
    尺寸：[1024x1024 ▼]
    并发：[3] (1-20)
    右侧显示进度卡：百分比 / 处理 / 成功 / 失败 / 已选提示词

  当选择 ComfyUI 工作流：
    文生图工作流：[workflow ▼]
    尺寸：宽 [1024] × 高 [1024]
    并发：[1] (1-10)
    右侧显示运行云机选择卡：云机 / 实例 UUID / ComfyUI 地址 / 刷新按钮
    不显示原百分比进度卡；错误和完成结果仍显示在页面上

【当前任务图片预览】
  当前任务每成功输出一张图，下方预览区追加一张缩略图；
  点击缩略图可放大，并支持上一张 / 下一张切换。

  [一键运行] [开始生图]

【自己写提示词模式】
  [textarea，每行一条提示词，或粘贴 JSON 数组]
  [解析到审稿列表] → [开始生图]
```

文生图页不再在顶部用“付费 Grsai / ComfyUI 晨羽”按钮区分路径。路径选择只放在右侧“生图设置”里，默认路径是 Grsai。

### 4.2 流程

```
[AI 模式]
  用户填变量 → 软件拉 skill → 注入变量到 systemPrompt → 调阿里云百炼
    ↓
  LLM 返回 JSON：{ "prompts": [{ "index": 1, "prompt": "..." }] }
    ↓
  通用解析器拆成数组 → UI 审稿
    ↓
  用户勾选/编辑/添加 → 在右侧选择 Grsai 或 ComfyUI 工作流 → 点"开始生图"
    ↓
  并发池调对应运行路径 → 落到 02-印花工作区/文生图/{任务名}/

[自己写模式]
  用户填提示词 → 解析到审稿列表 → 直接进入并发池 → 调当前生图路径

[一键运行]
  智能模式：先生成提示词 → 写入审稿列表 → 用已选提示词按当前生图路径生图
  自己写模式：先解析手写提示词 → 写入审稿列表 → 用已选提示词按当前生图路径生图
```

### 4.3 印花 ID 生成

每张生图任务**生成时**分配印花 ID：`pri_{nanoid(12)}`。

数据库 `artifacts` 表登记：
```
{
  id: artifact_id,
  print_id: 'pri_abc123def456',
  step: 'txt2img',
  provider: 'grsai' | 'comfyui-chenyu',
  model_or_workflow: 'gpt-image-2' | 'txt2img-workflow-id',
  skill_id: 'txt2img-local-print',
  skill_version: '1.0.0',
  source_artifact_ids: '[]',  // 文生图无来源
  file_path: '02-印花工作区/文生图/{任务名}/pri_abc123def456.png',
  prompt_snapshot: '...',     // 实际发给 grsai 的 prompt
  params_snapshot: '{...}',
}
```

## 5. 图生图能力

图生图**不做文生图式合并**。顶部实现方式切换继续存在：
- Grsai 图生图：使用参考图、提示词模式、提示词审稿和“生图时带参考图”开关。
- ComfyUI 图生图：选择任意图片文件夹，检索后按图片自然顺序逐张注入本地导入的图生图工作流。

### 5.1 Grsai 图生图模式

| 方式 | 视觉 LLM 看图 | LLM 写提示词 | 备注 |
|---|---|---|---|
| 参考构图 | ✅ 只学版式 | ✅ | "复制构图，画新内容" |
| 参考风格 | ✅ 只学画风 | ✅ | "新内容，原画风" |
| 构图+风格 | ✅ 学全部 | ✅ | "同款" |
| 自己写 | - | ❌ | 跳过 LLM，仍可选择是否把参考图传给生图模型 |

UI：4 个按钮。原“纯文字”选项已删除；纯文字需求应使用文生图 Tab。

### 5.2 参考图传递

腾域内部用 `Buffer` 或纯 base64 字符串。Adapter 在调用前各自加前缀：

- **Grsai**：纯 base64（无 `data:` 前缀），通过 `images: string[]` 字段
- **阿里云百炼**：data URL（`data:image/png;base64,...`），通过 `messages[].content[].image_url`

Grsai 图生图里有一个用户可控开关：
- “生图时带参考图”默认关闭。
- 关闭时：参考图只给百炼视觉模型看，用来生成提示词；最终 Grsai 生图接口只收到提示词和尺寸等参数。
- 开启时：参考图既给百炼视觉模型看，也随 `referenceImages` 发送给 Grsai 生图接口。
- 自己写提示词模式同样遵守这个开关；用户可以只用手写提示词，也可以手写提示词 + 参考图一起发给生图模型。

### 5.3 ComfyUI 图生图

ComfyUI 图生图不使用 Grsai 的参考图上传框，也不需要提示词输入框。用户选择任意图片文件夹后点击“检索图片”，客户端递归扫描 `jpg/jpeg/png/webp`，按自然顺序展示只读缩略图清单；检索到 N 张就运行 N 次。

运行前，主进程把扫描到的外部图片登记为 `manual-import` 印花 artifact，再复用现有 artifact 血缘和 ComfyUI reference image 注入逻辑。文件夹不限制在 `01-采集工作区` 或 `02-印花工作区` 下。

ComfyUI 图生图右侧显示：
- 执行卡：检索图片数量、工作流、开始图生图按钮。
- 运行云机选择卡。
- 错误和完成结果反馈。

不再显示原百分比、处理、成功、失败进度卡。

## 6. 提取能力

提取能力的共用规则：

- 云端可配置多条提取 Skill，客户端在 Grsai 提取和 ComfyUI 提取里都让用户选择其中一条。
- 提取 Skill 的 `system_prompt` 直接作为 provider prompt，不再先交给百炼生成二级提示词。
- N 张源图 = N 次运行。每次运行都用同一条用户选中的提取 Skill。

### 6.1 Comfyui 实现

```
用户选图片文件夹 → 检索图片 → 选提取 Skill、ComfyUI 提取工作流和尺寸 → 选择运行云机 → 上传图 → 调 /prompt
  ↓
工作流执行（一般 30-90 秒）→ 输出印花（带背景或不带，看工作流设计）
  ↓
落到 02-印花工作区/提取/{任务名}/
```

ComfyUI 提取工作流改为客户端本地导入（detail 见 [chenyu-cloud-api.md](../../references/generation-comfyui/chenyu-cloud-api.md)）。

ComfyUI 提取不展示自由提示词输入框，只展示提取 Skill 选择。它和 ComfyUI 图生图一样选择任意图片文件夹并递归检索，检索到 N 张就按自然顺序运行 N 次，扫描到的图片路径直接作为源图传入工作流。

ComfyUI 提取右侧显示运行云机选择卡；不显示原百分比、处理、成功、失败进度卡。错误和完成结果仍在页面可见位置展示。

### 6.2 Grsai 实现（本质是图生图）

```
用户选采集图 → 选云端"提取 Skill"提示词 → Grsai 图生图（带参考图）
  ↓
落到 02-印花工作区/提取/{任务名}/
```

提取 Skill 的 `system_prompt` 直接作为 Grsai 提取提示词。Grsai 提取和 ComfyUI 提取一样，都是一张源图对应一次运行，只是生图渠道不同。

### 6.3 多原图 → 多次运行

用户选择 N 张源图时，客户端提交 N 次提取运行。每次运行保存返回的最终印花。

### 6.4 提取后抠图组合入口

```
用户选图片文件夹 → 检索图片 → 选提取 Skill、提取工作流、抠图工作流和尺寸
  ↓
逐张运行：ComfyUI 提取 → 临时目录 → ComfyUI 抠图
  ↓
只保留最终透明底图，落到 02-印花工作区/抠图/{任务名}/
```

提取后抠图是 ComfyUI-only 入口。扫描到的图片先登记为 `manual-import` artifact；提取阶段输出到 TempFileManager 临时目录且不登记最终 artifact；抠图阶段输出最终透明底图。运行完成后清理临时目录。

## 7. 抠图能力

### 7.1 Comfyui 直接抠图工作流

```
用户选图片文件夹 → 检索图片 → 选抠图工作流和尺寸 → ComfyUI 跑 → 输出透明底 PNG
  ↓
落到 02-印花工作区/抠图/{任务名}/
```

工作流由客户端本地导入和保存，常用 BiRefNet、RMBG 等模型。

ComfyUI 抠图不展示提示词输入框。用户可选择任意图片文件夹；运行前，扫描到的外部图片自动登记为 `manual-import` 印花 artifact，再按自然顺序逐张注入工作流。

ComfyUI 抠图右侧显示运行云机选择卡；不显示原百分比、处理、成功、失败进度卡。错误和完成结果仍在页面可见位置展示。

### 7.2 混合路径（付费 + ComfyUI）

```
用户选图片文件夹并检索 → 外部图片登记为 manual-import 印花 → Grsai 生黑白遮罩图（用"白底黑印花 skill"提示）
  ↓
临时文件 .workbench/tmp/matting/{taskId}/mask.png
  ↓
ComfyUI 工作流"黑白图转 alpha + 与原图混合"
  ↓
透明底图 → 02-印花工作区/抠图/{任务名}/
  ↓
临时 mask.png 自动清理
```

详见 spec/04-detection 关于临时文件管理的策略（同样的 TempFileManager）。

本地执行合同：
- 黑白图 skill：`module='generation'`，`category='matting-mask'`，由后台配置；客户端默认取该分类下第一个 skill，并用该 skill 的 `system_prompt` 调 Grsai。
- 混合工作流：从本地导入的 `matting-mixed` 分类工作流中读取；本地执行时仍登记 `step='matting'`。
- ComfyUI 输入图顺序：`reference_images[0]` 是原印花，`reference_images[1]` 是临时 `mask.png`。`ComfyuiWorkflowSlot.imageIndex` 和 `options.imageSlotIndexes` 都是 **0-based**，所以原图=0、mask=1；未配置时 slot 名含 `mask` 自动取 1，其它 image slot 取 0。
- 临时文件：`mask.png` 只能写到 `.workbench/tmp/matting/{taskId}/mask.png`；单张完成后删文件，任务完成后 `TempFileManager.cleanupTask('matting', taskId)` 清目录。
- artifact provider：混合路径输出登记 `provider='grsai+comfyui-mask'`，直接 ComfyUI 抠图仍登记 `provider='comfyui-chenyu'`。

UI 上让用户选哪种路径：
```
抠图方式：
  ● ComfyUI 直接抠图（推荐，单步）
  ○ 付费生黑白图 + ComfyUI 混合（高质量，慢）
```

直接抠图和混合路径共用同一个文件夹检索入口；检索到 N 张就运行 N 次。

## 8. 并发与队列

### 8.1 并发控制

```ts
// services/generation/concurrency.ts
class GenerationConcurrencyController {
  private workers: number               // 用户配置，默认 3；Grsai 1-20，ComfyUI 1-10
  private active: Set<TaskId> = new Set()
  private semaphore: Semaphore

  async run<T>(taskId: TaskId, fn: () => Promise<T>): Promise<T> {
    return await this.semaphore.acquire(async () => {
      this.active.add(taskId)
      try {
        return await fn()
      } finally {
        this.active.delete(taskId)
      }
    })
  }
}
```

### 8.2 429 自适应降级

```ts
class AdaptiveRateLimiter {
  private consecutive429: number = 0
  private currentWorkers: number = userConfig.workers

  onResponse(status: number) {
    if (status === 429) {
      this.consecutive429++
      if (this.consecutive429 >= 3) {
        this.currentWorkers = Math.max(1, this.currentWorkers - 1)
        notifyUser(`检测到限流，并发已降到 ${this.currentWorkers}`)
        this.consecutive429 = 0
      }
    } else if (status < 400) {
      this.consecutive429 = 0
    }
  }
}
```

### 8.3 重试机制

```ts
interface WorkUnit {
  id: string
  task_id: string
  prompt: string
  reference_images?: ImageRef[]
  attempt: number
  max_retries: number                  // Grsai 本地设置默认 2，范围 0-10
  failure_reason?: 'network' | 'timeout' | 'violation' | 'server' | 'unknown'
}

async function runWithRetry(unit: WorkUnit, adapter: ImageGenerationAdapter) {
  while (unit.attempt <= unit.max_retries) {
    try {
      const result = await adapter.generate({ ... })
      return result
    } catch (e) {
      const error = classifyError(e)
      unit.failure_reason = error.kind
      
      // 只对可重试错误自动重试
      if (!error.retryable || unit.attempt >= unit.max_retries) {
        throw e
      }
      
      unit.attempt++
      const backoff = Math.min(60_000, 2 ** unit.attempt * 1000)
      await sleep(backoff)
    }
  }
}
```

Grsai 自动重试次数在设置页“本地生图设置”里配置，范围 `0-10`，默认 `2`。它只对可重试错误生效，例如网络错误、`429`、`5xx`；`GRSAI_VIOLATION` 这类内容违规不重试。

### 8.3 生图运行期日志

生图模块提供与采集页一致的命令行式日志弹窗，用于用户当场判断当前卡在哪一步。

展示入口：
- 生图页顶部右侧“日志 {count}”按钮。
- 点击后打开“生图日志”弹窗，终端风格逐行展示。
- 弹窗支持清空；打开时自动滚动到底部。

数据来源：
- 主进程通过 `generation:debug-log` 推送 `GenerationDebugLogEntry`。
- 前端只在当前运行期间保留最近 `1000` 条，应用重启后清空。

覆盖阶段：
- 提示词生成：开始、完成、失败。
- 任务提交：provider、模型/工作流、尺寸、并发、参考图数量。
- 运行进度：processed / total、成功数、失败数、当前提示词预览。
- 完成/失败：总数、成功、失败、首张保存路径或错误原因。

安全边界：
- 常规运行期日志不写入 `.workbench/logs/`，不是长期审计日志。
- 生图提示词生成和实际生图调用会额外写入 `.workbench/logs/diagnostics/generation/{taskIdOrRunId}.jsonl`，用于排查空字符、JSON 格式错误、解析失败、provider 原始响应、轮询/重试次数。
- 不记录 API Key。
- 不记录 base64 / data URL / Buffer 图片原文，只记录图片路径、mime、字节数、sha256、data URL 长度等元信息。
- 弹窗里的提示词只展示短预览，避免长文本刷屏；完整请求和原始返回以诊断日志为准。
- 每次任务完成后，结果区域展示本次 `diagnosticsLogPath`，方便用户直接定位文件。

## 9. ComfyUI 云机管理

### 9.1 设置页 UI

```
[晨羽智云设置]

连接信息：
  晨羽 API Key
  连接状态：未配置 / 检测中 / 连接成功 / 连接失败
  说明：主界面不展示余额，只判断 API Key 是否可用。

创建云机（默认收起）：
  摘要：创建杭州慎思云机 · {默认版本} · {默认 GPU}
  展开后：
    固定 POD UUID（只读展示）
    POD 版本：[select]
    GPU：[select]
    [创建云机]

高级设置（默认收起）：
  POD 自动发现
  手动维护固定 POD UUID / 版本列表
  定时关机分钟数
  高级实例操作：重启 / 销毁

实例管理（主工作区）：
  当前 API Key 下的全部实例
  每行展示：实例 UUID、状态、ComfyUI 地址、开机、关机、设为默认云机
```

主列表不展示余额、预估费用、重启、销毁。危险操作只放高级设置。

### 9.2 创建固定杭州慎思 POD 实例

创建入口只服务当前配置的固定 POD，不让普通用户在主界面改 POD UUID。

```ts
async function createFixedPodInstance(input: {
  podTag?: string
  gpuUuid?: string
  gpuNums?: number
  autoShutdownMinutes?: number | null
}) {
  const settings = await readChenyuSettings()
  const podUuid = settings.config.pod_uuid
  const podTag = input.podTag ?? settings.config.default_pod_tag
  const gpuUuid = input.gpuUuid ?? settings.config.default_gpu_uuid

  const created = await chenyu.createByPod({
    pod_uuid: podUuid,
    pod_tag: podTag,
    gpu_uuid: gpuUuid,
    gpu_nums: input.gpuNums ?? 1,
  })

  if (input.autoShutdownMinutes) {
    await chenyu.setShutdownTimer({
      instance_uuid: created.instance_uuid,
      enable: true,
      shutdown_time: Math.floor(Date.now() / 1000) + input.autoShutdownMinutes * 60,
    })
  }

  const ready = await pollUntilRunningAndResolveComfyuiUrl(created.instance_uuid)
  return saveAsDefaultCloudMachine(ready)
}
```

创建成功后新实例会保存为**默认云机**，并进入实例管理列表。

### 9.3 开机 / 关机状态体验

```ts
async function startupFromSettings(instanceUuid: string) {
  setRowStatus(instanceUuid, 'initializing') // UI 文案：初始化等待中
  await chenyu.startup({ instance_uuid: instanceUuid })
  await pollListInstancesUntil(instanceUuid, ['running'])
}

async function shutdownFromSettings(instanceUuid: string) {
  setRowStatus(instanceUuid, 'shutting_down') // UI 文案：关闭中
  await chenyu.shutdown(instanceUuid)
  await pollListInstancesUntil(instanceUuid, ['stopped'])
}
```

开关机期间只禁用当前行按钮，不锁死整个设置页。

### 9.4 运行云机与生图调用

- `chenyu:set-active-instance` 把某个实例保存为默认云机。
- 生图页 ComfyUI 路径读取当前 API Key 下的实例列表，只展示 `running` 且有 ComfyUI 地址的云机。
- 默认云机作为运行云机选择的默认候选；如果默认云机不在可运行列表内，客户端自动选第一个运行中云机。
- 没有运行中云机时，生图模块提示用户先去设置页开机。
- 运行云机没有可用 ComfyUI 地址时，不进入可选列表。
- 生图模块不自动开机，避免用户无感产生云 GPU 费用。

### 9.4.1 生图页运行云机选择卡

只在 ComfyUI 路径页面显示运行云机选择卡：
- 文生图选择“ComfyUI 工作流”时。
- ComfyUI 图生图。
- ComfyUI 提取。
- ComfyUI 抠图（含混合路径的 ComfyUI 输出阶段）。
- ComfyUI 提取后抠图。

选择卡内容：
- 运行状态：有可选云机时显示运行中，否则显示未选择。
- 云机下拉框：只列出运行中且有 ComfyUI 地址的实例。
- 所选实例 UUID。
- 所选 ComfyUI 地址。
- 刷新按钮。

选择卡不放开机/关机按钮。开机、关机、设为默认云机仍只在设置页处理。

刷新按钮调用 `chenyu:list-instances` 重新读取实例列表。用户选择会按生图入口维度记在本地浏览器存储里。

### 9.5 关机策略

创建实例时可立即设定晨羽侧定时关机。这个兜底由晨羽执行，软件崩溃、断网、进程被杀都不影响，最坏只多收设定时长内的费用。

### 9.6 ComfyUI 端口提取

```ts
function resolveComfyuiUrl(info: ChenyuInstanceInfo): string | null {
  const candidates = comfyuiUrlCandidates(info.server_map, info.server_url)
  const confident = candidates.find(candidate => candidate.confidence >= 90)
  if (confident) return confident.url

  for (const candidate of candidates) {
    if (ping(candidate.url, '/system_stats') || ping(candidate.url, '/object_info')) {
      return candidate.url
    }
  }

  return candidates.length === 1 ? candidates[0].url : null
}
```

地址候选来自 `server_map` 和 `server_url`。title / url 含 `comfy` 的候选优先；`frontend` / `web` 类候选次之；无法自动识别时，设置页允许用户手动填 ComfyUI 地址后再设为默认云机。

## 10. 工作流缓存

### 10.1 本地导入

Workflow 不再从云端拉取。用户在客户端设置页导入 ComfyUI API JSON，客户端校验 JSON、识别输入/输出槽位，并保存到 `.workbench/local-workflows/`。

客户端：
- 设置页导入 workflow JSON，按能力分类保存
- 生图页按能力列出本地 workflow
- 选中 workflow 后从本地读取完整 JSON
- 删除 workflow 只影响本机，不影响云端

### 10.2 input_slots / output_slots

```ts
interface ComfyuiWorkflowPack {
  id: string
  category: GenerationCapability
  version: string
  workflow_json: unknown              // ComfyUI 原生 workflow
  input_slots: {
    node_id: string                   // ComfyUI 节点 ID
    field: string                     // 字段名（如 "image"）
    type: 'image' | 'string' | 'number' | 'boolean'
    label: string                     // UI 显示
  }[]
  output_slots: {
    node_id: string
    type: 'image'
    label: string
  }[]
  required_models: string[]           // 工作流依赖的模型，用户自查运行云机是否具备
}
```

注入流程：
```ts
function injectInputs(workflow: any, req: GenerateRequest, slots: InputSlot[]) {
  const cloned = structuredClone(workflow)
  for (const slot of slots) {
    if (slot.type === 'image') {
      const imageRef = req.reference_images?.[0]  // 默认取第一张
      cloned[slot.node_id].inputs[slot.field] = imageRef.uploaded_filename
    } else if (slot.type === 'string') {
      cloned[slot.node_id].inputs[slot.field] = req.prompt
    }
    // ...
  }
  return cloned
}
```

## 11. 数据库

```sql
CREATE TABLE prints (
  id              TEXT PRIMARY KEY,
  source_artifact_id TEXT REFERENCES artifacts(id),
  category        TEXT,                              -- "txt2img" | "img2img" | "extract" 
  notes           TEXT,
  created_at      INTEGER NOT NULL
);

-- artifacts 表已在 spec/00 定义
-- 生图产物的 artifacts 行：
--   step = 'txt2img' | 'img2img' | 'extract' | 'matting'
--   provider = 'grsai' | 'comfyui-chenyu'
--   model_or_workflow = 'gpt-image-2' | 'extract-v3'
--   skill_id, skill_version
--   source_artifact_ids = JSON 数组（图生图/提取/抠图的来源）
--   prompt_snapshot
--   file_path = 02-印花工作区/{能力目录}/{任务名}/{印花ID}.png

CREATE TABLE comfyui_instances (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),  -- 默认云机记录，不是全部实例列表
  provider            TEXT NOT NULL,                       -- 'chenyu'
  instance_uuid       TEXT NOT NULL,
  comfyui_url         TEXT NOT NULL,
  pod_uuid            TEXT,
  gpu_uuid            TEXT,
  gpu_name            TEXT,
  status              TEXT NOT NULL,                       -- 'starting' | 'running' | 'shutting_down' | 'stopped' | 'none'
  pod_price_hour      REAL NOT NULL DEFAULT 0,
  gpu_price_hour      REAL NOT NULL DEFAULT 0,
  auto_shutdown_at    INTEGER,                             -- 计划关机时间戳
  created_at          INTEGER NOT NULL,
  last_used_at        INTEGER
);
```

## 12. IPC 接口

```ts
// 通用
'generation:list-skills'              → { module, category } → PaidSkill[]
'generation:get-skill'                → { skill_id } → PaidSkill (full)

// 本地工作流与源图列表
'generation:list-extract-sources'     → ExtractSourcesResult
'generation:list-img2img-sources'     → Img2imgSourcesResult
'generation:list-comfyui-txt2img-workflows'
                                      → ComfyuiWorkflowSummary[]
'generation:list-comfyui-img2img-workflows'
                                      → ComfyuiWorkflowSummary[]
'generation:list-comfyui-extract-workflows'
                                      → ComfyuiWorkflowSummary[]
'generation:list-comfyui-matting-workflows'
                                      → ComfyuiWorkflowSummary[]
'generation:list-comfyui-mixed-matting-workflows'
                                      → ComfyuiWorkflowSummary[] where category='matting-mixed'
'generation:list-chenyu-workflows'    → ChenyuWorkflowSummary[]
'generation:get-chenyu-workflow'      → ChenyuWorkflow (full)

// LLM 提示词生成
'generation:generate-prompts'         → {
                                          skill_id,
                                          variables,
                                          reference_images?,
                                        } → string[]

// 实际生图
'generation:run-txt2img'              → {
                                          capability?: 'txt2img' | 'img2img',
                                          prompts,
                                          model,
                                          aspectRatio,
                                          referenceImages?,
                                          concurrency
                                        } → TaskId
'generation:run-comfyui-txt2img'      → { prompts, workflowId, workflowVersion?, width, height, concurrency, instanceUuid? } → TaskId
'generation:run-extract'              → { sourceImagePaths, skillId, model, aspectRatio, concurrency } → TaskId
'generation:run-comfyui-img2img'      → { sourceArtifactIds?, sourceImagePaths?, workflowId, workflowVersion?, prompt?, instanceUuid? } → TaskId
'generation:run-comfyui-extract'      → { sourceImagePaths, workflowId, workflowVersion?, skillId, skillVersion?, instanceUuid? } → TaskId
'generation:run-comfyui-extract-matting'
                                      → { sourceImagePaths, extractWorkflowId, mattingWorkflowId, skillId, skillVersion?, instanceUuid? } → TaskId
'generation:run-comfyui-matting'      → { sourceArtifactIds?, sourceImagePaths?, workflowId, workflowVersion?, prompt?, instanceUuid? } → TaskId
'generation:list-comfyui-mixed-matting-workflows'
                                      → ComfyuiWorkflowSummary[] where category='matting-mixed'
'generation:run-mixed-matting'        → {
                                          sourceArtifactIds,
                                          workflowId,
                                          workflowVersion?,
                                          maskSkillId?,
                                          maskSkillVersion?,
                                          maskModel?,
                                          prompt?,
                                          instanceUuid?,
                                        } → TaskId

// 完成事件 result 带 diagnosticsLogPath，可在 UI 结果区展示
'generation:completed'                → { ok: true, result: GenerationRunResult & { diagnosticsLogPath?: string } }

// 运行期日志事件（主进程推送，preload 暴露 onDebugLog）
'generation:debug-log'                → {
                                          id,
                                          timestamp,
                                          level: 'debug' | 'info' | 'warn' | 'error',
                                          message,
                                          taskId?,
                                          capability?,
                                          details?
                                        }

// 晨羽设置和实例管理
'chenyu:get-settings'                 → ChenyuSettingsSnapshot
'chenyu:save-settings'                → { apiKey?, config } → ChenyuSettingsSnapshot
'chenyu:test-connection'              → ChenyuBalance         // UI 只消费成功/失败，不展示余额
'chenyu:discover-pod'                 → { keyword? } → ChenyuPodDiscoveryResult
'chenyu:list-gpus'                    → ChenyuGpu[]
'chenyu:list-instances'               → ChenyuManagedInstance[]
'chenyu:create-fixed-pod-instance'    → { podTag?, gpuUuid?, gpuNums?, autoShutdownMinutes? }
                                      → ComfyuiInstanceSummary
'chenyu:startup-instance'             → { instanceUuid, gpuUuid?, gpuNums? } → ChenyuInstanceInfo
'chenyu:shutdown-instance'            → { instanceUuid } → ChenyuInstanceInfo
'chenyu:set-active-instance'          → { instanceUuid, comfyuiUrl? } → ComfyuiInstanceSummary
'chenyu:get-active-instance'          → ComfyuiInstanceSummary | null
'chenyu:refresh-active-instance'      → ComfyuiInstanceSummary | null

// 高级设置折叠区才暴露
'chenyu:restart-instance'             → { instanceUuid } → ChenyuInstanceInfo
'chenyu:destroy-instance'             → { instanceUuid } → { ok: true }
```

## 13. 错误处理

| 错误码 | 触发 | UI 处理 |
|---|---|---|
| `CHENYU_INSTANCE_DOWN` | 没有可用运行云机，或所选云机缺少 ComfyUI 地址 | 提示用户到设置页开机或刷新实例；不自动开机 |
| `HTTP_4XX` | API Key 缺失、POD/GPU/版本配置缺失、手填 ComfyUI 地址不合法 | 在设置页显示短错误 |
| `HTTP_5XX` | 晨羽实例已运行但无法解析 ComfyUI 地址 | 提示刷新实例；仍失败时允许手动填写地址 |
| `GRSAI_VIOLATION` | Grsai 内容违规 | 不重试，提示用户改 prompt |
| `GRSAI_FAILED` | Grsai 通用失败 | 按本地自动重试次数重试，范围 0-10；仍失败后报错 |
| `BAILIAN_API_KEY_INVALID` | 阿里云百炼 401 | 提示用户重填 API Key |
| `PROMPT_PARSE_FAILED` | 通用解析器无法提取 | 重试 1 次后让用户手动编辑 |

## 14. 性能预算

| 操作 | 预算 |
|---|---|
| 单张 Grsai 生图（1K）| 10-30 秒 |
| 单张 ComfyUI 提取 | 30-90 秒 |
| 单张抠图（直接工作流）| 15-60 秒 |
| 单张抠图（混合路径）| 60-180 秒 |
| LLM 生成 5 条提示词 | 5-15 秒 |
| 同时 3 张并发 | < 1.5GB 内存 |

## 15. 测试

- Grsai 图生图 4 种模式的视觉 LLM 调用差异，以及“生图时带参考图”默认关闭
- 通用解析器对各种 LLM 输出格式的兜底
- 晨羽固定 POD 实例创建、开机、关机、设为默认云机
- 没有运行中云机时，ComfyUI 生图提示先去设置页开机，不自动开机
- 工作流注入参数后的 ComfyUI 提交
- 提取后抠图只保留最终抠图结果，提取中间图走临时目录并清理
- 并发限制 + 429 自适应降级
- 印花 ID 生成的唯一性
- 生图运行期日志格式化、最近 `1000` 条保留、`generation:debug-log` IPC 事件
