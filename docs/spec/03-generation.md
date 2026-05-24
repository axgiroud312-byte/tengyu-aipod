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
| 文生图 | ❌（ComfyUI 用户不做文生图）| ✅ |
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
  current_instance: {
    instance_uuid: string             // 晨羽返回
    comfyui_url: string               // server_map 里 ComfyUI 端口的 url
    status: 'starting' | 'running' | 'idle_close_pending' | 'stopped'
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
    private workflowCache: WorkflowCache  // 云端派发的工作流缓存
  ) {}

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    // 1. 确保实例就绪
    await this.ensureInstanceReady()
    
    // 2. 拉取工作流（按 capability + workflow_id）
    const workflow = await this.workflowCache.get(req.workflow_id!, req.capability)
    
    // 3. 上传素材图（如果有参考图）
    if (req.reference_images) {
      for (const img of req.reference_images) {
        await this.comfyHttp.uploadImage(img.base64, /* filename */)
      }
    }
    
    // 4. 注入参数到 workflow JSON 的 input_slots
    const injected = injectInputs(workflow, req)
    
    // 5. 提交 prompt
    const { prompt_id } = await this.comfyHttp.queuePrompt(injected)
    
    // 6. 轮询 /history/{prompt_id}
    const result = await this.pollHistory(prompt_id, { intervalMs: 2000, timeoutMs: 600000 })
    
    // 7. 下载输出
    const images = await this.downloadOutputs(result.outputs)
    
    return { status: 'succeeded', images }
  }
  
  private async ensureInstanceReady() {
    if (!this.currentInstance) {
      throw new AppError({ code: 'CHENYU_NO_INSTANCE', message: '请先创建 ComfyUI 实例' })
    }
    const info = await this.chenyu.getInstanceInfo(this.currentInstance.uuid)
    if (info.status !== 2) {
      throw new AppError({ code: 'CHENYU_INSTANCE_DOWN', message: '实例未运行' })
    }
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
      model: req.model ?? 'nano-banana-2',
      prompt: req.prompt,
      images,
      aspectRatio: req.output.aspect_ratio ?? '1:1',
      imageSize: req.output.image_size_label ?? '1K',
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
  id: string                          // "extract-prompt-v3"
  module: 'generation'                // 模块名
  category: string                    // "txt2img" | "img2img" | "extract" | "matting" | "matting-mask"
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

## 4. 文生图能力（仅 grsai 实现）

### 4.1 UI

```
[Tab: 文生图]

实现方式：● 付费（Grsai）  ○ ComfyUI 免费（不可用）

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
  生图模型：[nano-banana-2 ▼]
  比例：[1:1 ▼]
  分辨率：[1K ▼]
  并发：[3] (1-10)

  [开始生图]

【自己写提示词模式】
  [textarea，每行一条提示词，或粘贴 JSON 数组]
  [开始生图]
```

### 4.2 流程

```
[AI 模式]
  用户填变量 → 软件拉 skill → 注入变量到 systemPrompt → 调阿里云百炼
    ↓
  LLM 返回文本（JSON 或换行分隔）
    ↓
  通用解析器拆成数组 → UI 审稿
    ↓
  用户勾选/编辑/添加 → 点"开始生图"
    ↓
  并发池调 Grsai → 落到 02-生图/01-文生图/

[自己写模式]
  用户填提示词 → 跳过 LLM → 直接进入并发池 → 调 Grsai
```

### 4.3 印花 ID 生成

每张生图任务**生成时**分配印花 ID：`pri_{nanoid(12)}`。

数据库 `artifacts` 表登记：
```
{
  id: artifact_id,
  print_id: 'pri_abc123def456',
  step: 'txt2img',
  provider: 'grsai',
  model_or_workflow: 'nano-banana-2',
  skill_id: 'txt2img-print-prompt-v3',
  skill_version: '3.0.1',
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
用户选采集图 → 选 ComfyUI 提取工作流 → 启动晨羽实例 → 上传图 → 调 /prompt
  ↓
工作流执行（一般 30-90 秒）→ 输出印花（带背景或不带，看工作流设计）
  ↓
落到 02-生图/03-提取/
```

ComfyUI 提取工作流由腾域云端派发（detail 见 [chenyu-cloud-api.md](../../references/generation-comfyui/chenyu-cloud-api.md)）。

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

工作流由云端派发，常用 BiRefNet、RMBG 等模型。

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
- 混合工作流：从 `generation:list-comfyui-mixed-matting-workflows` 读取，服务端分类为 `matting-mixed`；本地执行时仍登记 `step='matting'`。
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

## 9. Comfyui 实例管理

### 9.1 实例生命周期 UI

```
[ComfyUI 实例 - 设置面板]

当前实例：未创建
  [创建新实例]

[创建实例向导]
  1. 选择应用（Pod）：
     - PyTorch ComfyUI v2.0 [选择]
     - ...
  2. 选择 GPU：
     - RTX 4090 (¥5.50/h) [选择]
     - RTX 3080 (¥3.20/h)
  3. 自动关机：
     ● 1 小时后自动关机（推荐）
     ○ 4 小时后
     ○ 8 小时后
     ○ 不自动关机（不推荐）
  
  预估费用：¥5.50/h × N 小时 = ¥X
  
  [创建并启动]
```

创建后：

```
当前实例：● 运行中 (RTX 4090)
  实例 UUID: inst_xxxx
  ComfyUI 地址: https://xxx.chenyu.team
  已运行：23 分钟 / 1 小时（59 分后自动关机）
  累计费用：¥2.11
  
  操作：
  [立即关机]  [重启]  [延长关机时间]  [销毁实例]
```

### 9.2 关机策略

```ts
// 创建实例时立即设定时关机（晨羽侧执行，不依赖客户端）
async function createInstanceWithAutoShutdown(config: InstanceConfig) {
  const instance = await chenyu.createByPod({ pod_uuid, gpu_uuid, gpu_nums: 1 })
  await chenyu.setShutdownTimer({
    instance_uuid: instance.uuid,
    enable: true,
    shutdown_time: Math.floor(Date.now() / 1000) + config.autoShutdownMinutes * 60,
  })
  return instance
}
```

软件崩了/断网都不影响——晨羽侧会按时关机，最坏多收设定时长内的费用。

### 9.3 ComfyUI 端口提取

```ts
function extractComfyuiUrl(serverMap: ServerMapEntry[]): string | null {
  // 找 port_type=http 且 title 含 "ComfyUI" 的条目
  const entry = serverMap.find(e => 
    e.port_type === 'http' && /comfyui/i.test(e.title)
  )
  return entry?.url ?? null
}
```

如果找不到（不同 Pod 可能用不同 title），fallback 取第一个 `port_type=http` 的 url 并 ping `/system_stats`。

## 10. 工作流缓存

### 10.1 拉取

```
GET /api/comfyui-workflows                  → list with metadata (no full workflow_json)
GET /api/comfyui-workflows/{id}/content     → full workflow_json
```

客户端：
- 启动时拉 list，缓存到 `.workbench/cache/comfyui-workflows/index.json`
- 用户选某个 workflow 时再拉 content，缓存到 `.workbench/cache/comfyui-workflows/{id}/{version}.json`
- 30 分钟刷新一次 list；content 按 version 永久缓存

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
  required_models: string[]           // 工作流依赖的模型，Pod 必须含
  recommended_pod_keywords: string[]  // 推荐用哪些 Pod
  min_vram_gb: number
  enabled: boolean
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
--   model_or_workflow = 'nano-banana-2' | 'extract-v3'
--   skill_id, skill_version
--   source_artifact_ids = JSON 数组（图生图/提取/抠图的来源）
--   prompt_snapshot

CREATE TABLE comfyui_instances (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),  -- 单例
  provider            TEXT NOT NULL,                       -- 'chenyu'
  instance_uuid       TEXT NOT NULL,
  comfyui_url         TEXT NOT NULL,
  pod_uuid            TEXT,
  gpu_uuid            TEXT,
  status              TEXT NOT NULL,                       -- 'starting' | 'running' | 'stopped'
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
'generation:list-providers'           → PaidProvider[]
'generation:list-workflows'           → { category } → ComfyuiWorkflowPack[] (no content)
'generation:get-workflow'             → { id } → ComfyuiWorkflowPack (full)

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

// 晨羽实例管理
'chenyu:list-pods'                    → ChenyuPod[]
'chenyu:list-gpus'                    → ChenyuGpu[]
'chenyu:create-instance'              → { pod_uuid, gpu_uuid, auto_shutdown_minutes } → instance
'chenyu:get-instance-status'          → ChenyuInstanceStatus
'chenyu:shutdown-instance'            → void
'chenyu:restart-instance'             → void
'chenyu:destroy-instance'             → void
'chenyu:get-balance'                  → { balance, card_balance }
```

## 13. 错误处理

| 错误码 | 触发 | UI 处理 |
|---|---|---|
| `CHENYU_NO_INSTANCE` | 用户未创建晨羽实例就跑 ComfyUI | 弹窗引导用户先创建实例 |
| `CHENYU_INSTANCE_DOWN` | 实例状态非 running | 提示用户重新启动实例 |
| `CHENYU_BALANCE_INSUFFICIENT` | 晨羽余额不足 | 提示用户充值，附跳转链接 |
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
- 晨羽实例创建/销毁流程
- 工作流注入参数后的 ComfyUI 提交
- 并发限制 + 429 自适应降级
- 印花 ID 生成的唯一性
