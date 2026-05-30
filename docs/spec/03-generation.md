# Spec 03 — 生图模块

> 统一生图模块，按业务能力分 4 个 Tab，每个 Tab 用户可选 provider 实现方式。
> v1 支持两个 provider：`comfyui-chenyu`（晨羽智云 ComfyUI）和 `grsai`（付费模型）。

## 1. 模块结构

```
┌─ 生图模块 ────────────────────────────────────────────┐
│ Tab 切换：[文生图] [图生图] [提取] [抠图]              │
│                                                       │
│ Tab 内：实现方式切换 + 配置表单 + 提示词审稿 + 进度    │
└──────────────────────────────────────────────────────┘
```

### 1.1 4 个能力 × 2 个 provider 实现矩阵

| 能力 | comfyui-chenyu | grsai |
|---|---|---|
| 文生图 | ✅（文生图工作流可选）| ✅ |
| 图生图 | ✅（多个工作流可选）| ✅（5 种生成方式）|
| 提取 | ✅（提取工作流）| ✅（图生图 + 提取 skill）|
| 抠图 | ✅（抠图工作流 / 混合路径）| ❌（不内置）|

### 1.2 输入域

各能力的输入约束：

| 能力 | 输入 | 强约束 |
|---|---|---|
| 文生图 | 纯提示词 | 不接收源图 |
| 图生图 | 提示词 + 参考图 | 参考图必须是**已提取的印花**（不接受采集图直接做图生图）|
| 提取 | 提示词 + 采集图（源） | 接受 01-采集 下的产品图 |
| 抠图 | 印花图 | 输入域：02-生图 的任一带背景产物、外部导入 |

**铁律**：采集图必须先提取才能成为印花。`UI 层` + `编排层`都要校验。

### 1.3 输出域

```
02-生图/
├─ 01-文生图/{印花ID}.png
├─ 02-图生图/{印花ID}_v1.png ({印花ID}_v2.png ...)
├─ 03-提取/{印花ID}.png
└─ 04-抠图/{印花ID}.png         ← 抠图后的最终透明底图
```

文件名带印花 ID + 版本号。**目录只放最终成品图，中间产物（如黑白遮罩）走 TempFileManager 临时区**。

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
    // 1. 刷新默认云机；不自动创建或开机
    const instance = await this.instanceManager.refreshCurrentInstance()
    if (!instance || instance.status !== 'running') {
      throw new AppError({
        code: 'CHENYU_INSTANCE_DOWN',
        message: '默认云机未运行，请先到设置页开机',
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
  id: string                          // "extract-paid-model"
  module: 'generation'                // 模块名
  category: string                    // "txt2img-local-print" | "extract-paid-model" | ...
  version: string                     // "3.0.1"
  enabled: boolean
  system_prompt: string               // LLM 的 systemMessage
  variables: SkillVariable[]          // UI 渲染所需
  recommended_llm: string             // "qwen3.6-plus" | "qwen3-vl-plus" | ...
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

```ts
// 通用解析器
function parsePrompts(text: string, count: number): string[] {
  // 1. 试 JSON 数组
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map(String).slice(0, count)
    }
  } catch {}
  
  // 2. 试 markdown 代码块里的 JSON
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
  if (codeBlock) {
    try {
      const parsed = JSON.parse(codeBlock[1])
      if (Array.isArray(parsed)) return parsed.map(String).slice(0, count)
    } catch {}
  }
  
  // 3. 按行拆 + 去序号
  return text
    .split(/\r?\n/)
    .map(s => s.replace(/^\s*(?:\d+[.、）)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, count)
}
```

### 3.3 Skill 在云端的派发

```
GET /api/skills?module=generation&category=txt2img → [PaidSkill]
GET /api/skills/{id}                                → PaidSkill (full)
```

客户端启动时拉所有 module=generation 的 skill 列表（不含 system_prompt 全文）→ 按需拉单个。

缓存 30 分钟刷新一次。

## 4. 文生图能力（Grsai / ComfyUI）

### 4.1 UI

```
[Tab: 文生图]

实现方式：● 付费（Grsai）  ○ ComfyUI 晨羽

模式：
  ┌─────────────────────────────┐
  │ ● AI 生成提示词              │
  │ ○ 自己写提示词               │
  └─────────────────────────────┘

【AI 生成模式】
  ① 印花类型：
     ● 局部（白底居中）  ○ 满印（铺满画面）
  
  ② 提示词数量：[5] (1-20)
  
  ③ 印花要求：
     [textarea，placeholder: "圣诞风格小熊主题，复古海报感"]
  
  Skill：[txt2img-print-prompt-v3 ▼]（用户可选其他版本）
  LLM：[qwen3-vl-plus ▼]
  
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

【生图设置】
  生图模型：[gpt-image-2 ▼]
  尺寸：[1024x1024 ▼]
  并发：[3] (1-20)

  [开始生图]

【ComfyUI 生成设置】
  工作流：[文生图工作流 ▼]
  尺寸：宽 [1024] × 高 [1024]
  并发：[1] (1-10)

  [开始生成]

【自己写提示词模式】
  [textarea，每行一条提示词，或粘贴 JSON 数组]
  [开始生图]
```

### 4.2 流程

```
[AI 模式]
  用户填变量 → 软件拉 skill → 注入变量到 systemPrompt → 调阿里云百炼
    ↓
  LLM 返回 JSON：{ "prompts": ["..."] }
    ↓
  通用解析器拆成数组 → UI 审稿
    ↓
  用户勾选/编辑/添加 → 选择 Grsai 或 ComfyUI → 点"开始生图"
    ↓
  并发池调对应运行路径 → 落到 02-生图/01-文生图/

[自己写模式]
  用户填提示词 → 跳过 LLM → 直接进入并发池 → 调对应 provider
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
  file_path: '02-生图/01-文生图/pri_abc123def456.png',
  prompt_snapshot: '...',     // 实际发给 grsai 的 prompt
  params_snapshot: '{...}',
}
```

## 5. 图生图能力

### 5.1 5 种生成方式

| 方式 | 视觉 LLM 看图 | LLM 写提示词 | 备注 |
|---|---|---|---|
| 纯文字 | - | ✅ 看用户文字要求 | 等同于文生图 |
| 参考构图 | ✅ 只学版式 | ✅ | "复制构图，画新内容" |
| 参考风格 | ✅ 只学画风 | ✅ | "新内容，原画风" |
| 构图+风格 | ✅ 学全部 | ✅ | "同款" |
| 自己写 | - | ❌ | 跳过 LLM |

UI：4 个 toggle 按钮 + "自己写"独立 Tab。

### 5.2 参考图传递

腾域内部用 `Buffer` 或纯 base64 字符串。Adapter 在调用前各自加前缀：

- **Grsai**：纯 base64（无 `data:` 前缀），通过 `images: string[]` 字段
- **阿里云百炼**：data URL（`data:image/png;base64,...`），通过 `messages[].content[].image_url`

### 5.3 "真 img2img"接口预留（v1 UI 不开）

ComfyuiChenyuAdapter 和 GrsaiAdapter 已支持把参考图传给生图模型（不只是给 LLM 看）。v1 UI 上不暴露这个选项，**代码层保留接口**：

```ts
interface GenerateRequest {
  // ...
  pass_reference_to_image_model?: boolean  // v1 UI 默认 false
}
```

v1.5 加 UI toggle "把参考图也传给生图模型"。

## 6. 提取能力

### 6.1 Comfyui 实现

```
用户选采集图 → 选 ComfyUI 提取工作流 → 确认默认云机运行 → 上传图 → 调 /prompt
  ↓
工作流执行（一般 30-90 秒）→ 输出印花（带背景或不带，看工作流设计）
  ↓
落到 02-生图/03-提取/
```

ComfyUI 提取工作流改为客户端本地导入（detail 见 [chenyu-cloud-api.md](../../references/generation-comfyui/chenyu-cloud-api.md)）。

### 6.2 Grsai 实现（本质是图生图）

```
用户选采集图 → 用云端"提取 skill"提示词 → Grsai 图生图（带参考图）
  ↓
落到 02-生图/03-提取/
```

提取 skill 提示词约束 LLM 写出"识别图中的印花元素，生成白底居中的印花"这种提示词。

### 6.3 多原图 → 多印花

一张采集图可能提取出 0、1、N 个印花，由 skill 控制（用户可在变量里设"每张图提取几个印花"）。

## 7. 抠图能力

### 7.1 Comfyui 直接抠图工作流

```
用户选印花（02-生图 任一目录的图）→ 选抠图工作流 → ComfyUI 跑 → 输出透明底 PNG
  ↓
落到 02-生图/04-抠图/
```

工作流由客户端本地导入和保存，常用 BiRefNet、RMBG 等模型。

### 7.2 混合路径（付费 + ComfyUI）

```
用户选印花 → Grsai 生黑白遮罩图（用"白底黑印花 skill"提示）
  ↓
临时文件 .workbench/tmp/matting/{taskId}/mask.png
  ↓
ComfyUI 工作流"黑白图转 alpha + 与原图混合"
  ↓
透明底图 → 02-生图/04-抠图/
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

## 8. 并发与队列

### 8.1 并发控制

```ts
// services/generation/concurrency.ts
class GenerationConcurrencyController {
  private workers: number               // 用户配置，默认 3，范围 1-10
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
  max_retries: number                  // v1 默认 0；v1.5 可配 2
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

### 9.4 默认云机与生图调用

- `chenyu:set-active-instance` 把某个实例保存为默认云机。
- 生图模块只读取默认云机，不扫描全部实例挑一台。
- 默认云机不是 `running` 时，生图模块提示“默认云机未运行，请先到设置页开机”。
- 默认云机没有可用 ComfyUI 地址时，提示用户刷新实例或手动填写地址。
- 生图模块不自动开机，避免用户无感产生云 GPU 费用。

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
  required_models: string[]           // 工作流依赖的模型，用户自查默认云机是否具备
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
'generation:run-txt2img'              → { prompts, params, concurrency } → TaskId
'generation:run-img2img'              → { prompts, reference_images, mode, params } → TaskId
'generation:run-extract'              → { source_images, provider, workflow_id?, params } → TaskId
'generation:run-matting'              → { source_images, mode: 'comfyui' | 'mixed' } → TaskId
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
                                        } → TaskId

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

// 高级设置折叠区才暴露
'chenyu:restart-instance'             → { instanceUuid } → ChenyuInstanceInfo
'chenyu:destroy-instance'             → { instanceUuid } → { ok: true }
```

## 13. 错误处理

| 错误码 | 触发 | UI 处理 |
|---|---|---|
| `CHENYU_INSTANCE_DOWN` | 默认云机不存在、未运行或正在关机 | 提示用户到设置页选择默认云机并开机；不自动开机 |
| `HTTP_4XX` | API Key 缺失、POD/GPU/版本配置缺失、手填 ComfyUI 地址不合法 | 在设置页显示短错误 |
| `HTTP_5XX` | 晨羽实例已运行但无法解析 ComfyUI 地址 | 提示刷新实例；仍失败时允许手动填写地址 |
| `GRSAI_VIOLATION` | Grsai 内容违规 | 不重试，提示用户改 prompt |
| `GRSAI_FAILED` | Grsai 通用失败 | 重试 N 次后报错 |
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

- 5 种生成方式（图生图）的视觉 LLM 调用差异
- 通用解析器对各种 LLM 输出格式的兜底
- 晨羽固定 POD 实例创建、开机、关机、设为默认云机
- 默认云机未运行时，ComfyUI 生图提示先去设置页开机，不自动开机
- 工作流注入参数后的 ComfyUI 提交
- 并发限制 + 429 自适应降级
- 印花 ID 生成的唯一性
