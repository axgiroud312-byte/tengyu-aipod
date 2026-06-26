# Spec 04 — 侵权检测模块

> 用阿里云百炼的 qwen3-vl-* 视觉模型判断印花是否侵权（商标/卡通/名人/IP 等），输出 0-100 风险值并按阈值归类。

## 1. 输入与输出

### 1.1 输入域

- `02-印花工作区` 任一能力目录下的印花（带背景或透明底）
- 通过“选择文件夹”递归扫描的本地图片文件夹
- 用户外部拖入的图片或文件夹

❌ `01-采集工作区` 的产品图不能直接检测（必须先提取成印花）

说明：文件夹扫描和外部拖入都走同一套检索逻辑，最终汇总成待检测图片列表；外部拖入支持图片文件和文件夹，文件夹会递归扫描。

### 1.2 输出

- 物理：图复制到 `03-检测工作区/{taskId}/{无风险|疑似|高风险}/` 的对应子目录
- 数据库：每张图一条 `detection_results` 记录，含风险值、依据、模型版本、skill 版本
- UI：列表展示每张图的判决结果

```
03-检测工作区/{taskId}/
├─ 无风险/                         ← 风险值 0-39，risk_level = pass
│   └─ {检测前用户可见文件名}.{ext}
├─ 疑似/                           ← 风险值 40-69（需人工复核），risk_level = review
│   └─ {检测前用户可见文件名}.{ext}
└─ 高风险/                         ← 风险值 70-100（高风险拦截），risk_level = block
    └─ {检测前用户可见文件名}.{ext}
```

注：03 是**物理复制**（不是软链接），保证用户用资源管理器看就是图片。检测只改变图片所在风险分类目录，不改用户可见文件名；例如输入 `gyxkj-0001.png`，输出仍为 `无风险/gyxkj-0001.png`。数据库仍记录内部 `print_id = pri_xxx`、检测前 `source_path`、检测后 `output_path` 和 `risk_level`。

## 2. 风险等级

```ts
type RiskLevel = 'pass' | 'review' | 'block'

interface RiskThreshold {
  pass: { min: 0; max: 39 }      // 用户可调
  review: { min: 40; max: 69 }   // 用户可调
  block: { min: 70; max: 100 }
}

function classifyRisk(score: number, threshold: RiskThreshold): RiskLevel {
  if (score >= threshold.block.min) return 'block'
  if (score >= threshold.review.min) return 'review'
  return 'pass'
}
```

## 3. 图像预处理管线

### 3.1 处理步骤（顺序）

```
① 透明底加白（强制，不可关）
   PNG with alpha → RGB JPG with white background
   理由：避免视觉模型黑底渲染导致判断失真
   实现：sharp({ background: '#ffffff' }).flatten()

② 压缩（可选，默认开启）
   最大边长：用户配置（默认 1024，可选 512 / 2048 / 保持原图）
   输出格式：用户配置（默认 JPG q=85，可选 PNG）
   实现：sharp.resize({ width: maxSize, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 })

③ Base64 编码
   读取临时文件 → Buffer.toString('base64')
   按 provider 加前缀（百炼要 data: URL）
```

### 3.2 实现（用 Worker Thread）

```ts
// services/detection/preprocess.ts (在 Worker Thread)
import sharp from 'sharp'
import path from 'path'

export async function preprocessImage(
  inputPath: string,
  options: PreprocessOptions,
  tempDir: string,
): Promise<{ outputPath: string; mimeType: string; sizeBytes: number }> {
  const hash = await hashFile(inputPath)
  const outputPath = path.join(tempDir, `${hash}_preprocessed.${options.format}`)
  
  let pipeline = sharp(inputPath)
  
  // ① 透明底加白
  pipeline = pipeline.flatten({ background: '#ffffff' })
  
  // ② 压缩（如启用）
  if (options.enableCompression) {
    pipeline = pipeline.resize({
      width: options.maxSize,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }
  
  // 编码
  if (options.format === 'jpg') {
    pipeline = pipeline.jpeg({ quality: 85 })
  } else {
    pipeline = pipeline.png()
  }
  
  await pipeline.toFile(outputPath)
  const stat = await fs.stat(outputPath)
  return {
    outputPath,
    mimeType: options.format === 'jpg' ? 'image/jpeg' : 'image/png',
    sizeBytes: stat.size,
  }
}
```

### 3.3 并发与配置档

```ts
// 启动时检测配置
function detectMachineSpec() {
  const cpus = os.cpus().length
  const totalRamGB = os.totalmem() / 1024 ** 3
  
  if (totalRamGB < 4 || cpus < 4) return 'low'
  if (totalRamGB < 8) return 'medium'
  return 'high'
}

const PREPROCESS_CONCURRENCY = {
  low: 1,
  medium: 2,
  high: 4,
}

// 用户可在设置里手动调整（1-8）
```

### 3.4 Worker Thread 池

```ts
// services/detection/preprocess-pool.ts
import { Worker } from 'worker_threads'

class PreprocessPool {
  private workers: Worker[]
  private queue: PreprocessJob[] = []
  
  constructor(size: number) {
    this.workers = Array.from({ length: size }, () => 
      new Worker(path.join(__dirname, 'preprocess-worker.js'))
    )
  }
  
  async process(jobs: PreprocessJob[]): Promise<PreprocessResult[]> {
    // 分发到 worker，等待全部完成
  }
}
```

## 4. Skill 系统

### 4.1 Skill 数据结构

```ts
interface DetectionSkill {
  id: string                          // "infringement-detection"
  module: 'detection'
  version: string
  enabled: boolean
  system_prompt: string               // 含输出格式约束（建议 JSON）
  variables: SkillVariable[]
  recommended_model: string           // "qwen3-vl-flash"
}

// 用户在 UI 上可调的变量（典型）
const TYPICAL_VARIABLES = [
  {
    key: 'focus',
    label: '关注重点',
    type: 'multi-select',
    options: [
      { value: 'brand', label: '知名品牌商标' },
      { value: 'cartoon', label: '卡通形象' },
      { value: 'celebrity', label: '名人肖像' },
      { value: 'art', label: '历史名画' },
      { value: 'sports', label: '体育队徽' },
      { value: 'movie', label: '影视 IP' },
      { value: 'custom', label: '自定义（填关键词）' },
    ],
    default: ['brand', 'cartoon', 'movie'],
  },
  {
    key: 'output_reason',
    label: '输出侵权依据说明',
    type: 'checkbox',
    default: true,
    help: '开启会消耗更多 token，但能看到"为什么判定"',
  },
  {
    key: 'custom_keywords',
    label: '自定义关注关键词',
    type: 'textarea',
    default: '',
    placeholder: '每行一个',
  },
]
```

### 4.2 期望的 LLM 输出格式

skill 在 systemPrompt 里强约束（示例片段）：

```
请严格输出 JSON：
{
  "risk_score": 0-100,
  "reason": "简短中文说明（不超过 50 字）"
}

不要输出 markdown 代码块，不要输出其他文字。
```

### 4.3 通用解析器（兜底）

```ts
function parseDetectionResponse(text: string): { score: number; reason: string } | null {
  // 1. 试 JSON
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed.risk_score === 'number' && typeof parsed.reason === 'string') {
      return { score: clampScore(parsed.risk_score), reason: parsed.reason }
    }
  } catch {}
  
  // 2. 试从代码块抽 JSON
  const cb = text.match(/```(?:json)?\s*({[\s\S]+?})\s*```/)
  if (cb) {
    try {
      const parsed = JSON.parse(cb[1])
      if (typeof parsed.risk_score === 'number') {
        return { score: clampScore(parsed.risk_score), reason: parsed.reason ?? '' }
      }
    } catch {}
  }
  
  // 3. 正则匹配数字
  const scoreMatch = text.match(/(?:risk[_ ]score|风险值|score)\s*[:：]\s*(\d{1,3})/i)
  if (scoreMatch) {
    const reasonMatch = text.match(/(?:reason|依据|理由)\s*[:：]\s*([^\n]+)/i)
    return {
      score: clampScore(parseInt(scoreMatch[1], 10)),
      reason: reasonMatch?.[1]?.trim() ?? '',
    }
  }
  
  return null  // 解析失败，调用方处理
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}
```

## 5. 阿里云百炼调用

详见 [../../references/vision-llm-providers/aliyun-bailian-api.md](../../references/vision-llm-providers/aliyun-bailian-api.md)。

### 5.1 Adapter

```ts
// adapters/aliyun-bailian.ts
class AliyunBailianAdapter {
  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ) {}

  async detectInfringement(req: DetectRequest): Promise<DetectResponse> {
    const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl })
    
    const response = await client.chat.completions.create({
      model: req.model,                       // 'qwen3-vl-flash' 等
      messages: [
        { role: 'system', content: req.skill.system_prompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: req.image.data_url } },
            { type: 'text', text: req.user_prompt },
          ],
        },
      ],
      response_format: { type: 'json_object' },  // 强约束输出 JSON
    })
    
    const text = response.choices[0].message.content
    return { text, usage: response.usage }
  }
}
```

### 5.2 重试

- 由客户端显式控制重试次数（`maxRetries`）
- 仅对可重试错误继续重试；不可重试错误直接结束该图
- 当前 spec 不承诺单独的 429 UI 提示或单张 30 秒超时策略，相关行为以 adapter 和运行时实现为准

### 5.3 诊断日志

每次检测任务默认写 `.workbench/logs/diagnostics/detection/{taskId}.jsonl`，结果区展示 `diagnosticsLogPath`。

记录内容：
- 任务配置快照：图片数量、skill、模型、阈值、预处理设置、并发、maxRetries、forceRetest。
- 每张图的原图元信息：path/name、bytes、sha256、artifactId、printId。
- 缓存跳过决策：命中的 artifact / model / skill / threshold。
- 每次 attempt 的预处理参数、百炼请求 messages、`response_format`、原始 `VisionResponse`、解析结果。
- 解析失败和模型空/异常返回必须先记录原始 response，再记录 `parse_failed` / `attempt_failed`。

安全边界：不记录百炼 API Key；不记录 data URL/base64 图片原文，只记录 mime、bytes、sha256、dataUrl length 等元信息。

## 6. UI 设计

```
┌─ 侵权检测 ────────────────────────────────────────────┐
│                                                       │
│ ① 选择待检测来源                                       │
│    ● 全选 02-印花工作区/提取/ (30 张)                    │
│    ● 全选 02-印花工作区/抠图/ (12 张)                    │
│    ○ 手动勾选（缩略图网格多选）                         │
│    ○ 从外部拖入图片或文件夹                             │
│                                                       │
│ ② 检测设置                                             │
│    模型：[qwen3-vl-flash ▼]                           │
│    Skill：[infringement-detection ▼]                  │
│    阈值：                                              │
│      Pass: 0-[40] | Review: [40]-[70] | Block: [70]-100│
│    关注重点：☑ 商标 ☑ 卡通 ☐ 名人 ☐ 影视 ☐ 自定义       │
│    ☑ 输出侵权依据说明                                  │
│                                                       │
│ ③ 图像预处理                                           │
│    ☑ 自动给透明底加白（强制）                          │
│    ☑ 压缩图片                                          │
│      最大边长：[1024 ▼]  格式：● JPG  ○ PNG           │
│    并发：[3] (1-8)                                     │
│                                                       │
│ ④ 预估                                                 │
│    42 张图，约 ¥0.04（启用压缩）                       │
│                                                       │
│ [开始检测]                                             │
└──────────────────────────────────────────────────────┘

[检测中]
进度：21 / 42（50%）
当前并发：3
[取消]

[完成]
结果统计：
  Pass:    28 张 ✅
  Review:   12 张 ⚠️
  Block:     2 张 ⛔
  失败:     0 张

结果列表（按风险值降序）：
┌──────────────────────────────────────────────────┐
│ 缩略图 | 风险 | 等级 | 依据 | 操作                  │
│ [....] | 85   | ⛔   | 含星巴克商标 | [移动][重测]  │
│ [....] | 72   | ⛔   | 与迪士尼角色相似 | [移][重]   │
│ [....] | 65   | ⚠️   | 卡通风格类似 | [移][重]      │
│ ...                                              │
└──────────────────────────────────────────────────┘

[加入套版清单] 把通过图登记到本地套版候选清单
```

## 7. 加入套版清单

```
用户点 [加入套版清单]
  ↓
弹窗：
  发现 28 张通过印花，将写入本地套版候选清单。
  [确认]
  ↓
执行：
  for row in detection_results where risk_level = 'pass':
    insert/update matting_candidates(artifact_id, task_id, print_id, source_path)
```

**注意**：加入套版清单不复制、不移动文件；源图仍保留在 `03-检测工作区/{taskId}/无风险/`。PS 套版模块从候选清单读取可套版印花。

### 7.1 完整任务调用边界

完整任务最初版把侵权检测作为可选 step。完整任务页默认读取侵权检测模块已保存的 Skill、模型、阈值和变量配置，
但允许用户为本次完整任务覆盖模型、Skill、压缩和通过要求：

- 用户关闭检测时，该 step 记录为 `skipped`，印花直接进入 PS 套版。
- 用户开启检测时，`block` 级别图片被拦截，不进入后续 PS。
- 默认 `pass` 和 `review` 都进入后续 PS；`review` 只是计数和提醒。完整任务页也可切到“仅无风险通过”，此时 `review` 和 `block` 都不进入 PS。
- 完整任务覆盖只影响当前完整任务草稿和本次运行，不反写单独侵权检测模块的默认配置。
- 单独侵权检测页必须在设置面板和执行面板一致展示当前模型，不能出现执行面板硬编码默认模型的情况。
- 完整任务检测结果分为“通过”和“未通过”。`review` 的归属跟随本次通过要求：允许疑似通过时归入通过区，仅无风险通过时归入未通过区。
- 完整任务检测和单独检测允许同时运行，各自使用自己的并发设置；用户需要自行关注百炼请求峰值和费用。
- 完整任务直接使用检测输出路径继续处理，不要求用户点击“加入套版清单”。
- 如果检测后没有任何可继续处理的印花，完整任务失败并停止。

## 8. 重复检测策略

数据库查 `detection_results`：

```ts
async function shouldSkipDetection(
  printArtifactId: string,
  modelVersion: string,
  skillVersion: string,
): Promise<{ skip: boolean; existing?: DetectionResult }> {
  const existing = await db.detection_results.findFirst({
    where: {
      artifact_id: printArtifactId,
      model: modelVersion,
      skill_version: skillVersion,
    },
    orderBy: { created_at: 'desc' },
  })
  
  if (!existing) return { skip: false }
  
  // 模型或 skill 版本变化 → 重测
  // 否则跳过
  return { skip: true, existing }
}
```

用户在 UI 上点"重测"按钮，或本次运行显式传 `forceRetest`，会强制覆盖历史结果。

## 9. 临时文件管理

```
.workbench/tmp/detection/{taskId}/
├─ {图片hash}_preprocessed.jpg
├─ {图片hash}_preprocessed.jpg
└─ ...

生命周期：
  任务启动 → 创建 {taskId}/ 目录
  预处理写文件 → {hash}_preprocessed.{ext}
  调 API 成功 → 任务成功完成后删整个 {taskId}/
  调 API 失败 → 保留任务目录一段时间，供排查和重试复用
  任务完成 → 删整个 {taskId}/
  任务取消 → 删整个 {taskId}/
  启动时清理超 24 小时的孤儿目录
```

## 10. 数据库

```sql
CREATE TABLE detection_results (
  id              TEXT PRIMARY KEY,
  artifact_id     TEXT NOT NULL REFERENCES artifacts(id),
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  risk_score      INTEGER NOT NULL,
  risk_level      TEXT NOT NULL,                   -- 'pass' | 'review' | 'block'
  reason          TEXT,                            -- 模型输出的依据说明
  model           TEXT NOT NULL,
  skill_id        TEXT NOT NULL,
  skill_version   TEXT NOT NULL,
  threshold_snapshot TEXT NOT NULL,                -- JSON: { pass_max, review_max }
  output_path     TEXT NOT NULL,                   -- 03-检测工作区/{taskId}/{无风险|疑似|高风险}/{...}
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_detection_artifact ON detection_results(artifact_id);
CREATE INDEX idx_detection_level ON detection_results(risk_level);
```

### 10.1 检测配置

```sql
CREATE TABLE detection_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pass_max INTEGER NOT NULL,
  review_max INTEGER NOT NULL,
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  model TEXT NOT NULL,
  variables_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- 单行配置，`id = 1`
- `pass_max` / `review_max` 只保存 0-100 的整数，并保持 `pass <= review`
- `variables_json` 保存 `skill.variables` 的实际值，UI 负责按变量定义回填

## 11. IPC 接口

```ts
'detection:get-config'               → DetectionConfig | null
'detection:save-config'              → DetectionConfig → DetectionConfig
'detection:list-input-sources'        → { dirs: string[], counts: Record<string, number> }
'detection:scan-folder'               → { folder } → ImageInfo[]
'detection:scan-paths'                → { paths: string[] } → ImageInfo[]
'detection:list-models'               → string[]
'detection:run'                       → { 
                                          image_paths: string[],
                                          model, 
                                          skill_id,
                                          variables,
                                          threshold,
                                          preprocess: { compress, max_size, format, quality? },
                                          concurrency,
                                          max_retries?,
                                          force_retest?,
                                        } → TaskId

'detection:cancel'                    → { task_id } → { ok: boolean }
'detection:get-result'                → { artifact_id } → DetectionResult | null
'detection:list-results'              → { task_id, risk_level? } → DetectionResult[]
'detection:retest'                    → { artifact_ids } → TaskId
'detection:promote-to-matting'        → { artifact_ids, mode: 'copy' | 'move' } → number
'detection:list-matting-candidates'   → MattingCandidate[]
'detection:delete-result'             → { artifact_id } → number

// 事件
'detection:progress'                  → { task_id, processed, total, succeeded, failed, skipped, diagnosticsLogPath?, current_image?, status? }
'detection:completed'                 → { ok: true, result: DetectionBatchResult & { diagnosticsLogPath?: string } } | { ok: false, taskId, error }
```

检测 Skill 列表不走专用 `detection:list-skills` IPC，而是复用通用 Skill 接口：

```ts
'skill:list' → { module: 'detection' } → SkillSummary[]
```

### 11.1 输入源补充字段

`detection:list-input-sources` 除了 `dirs` / `counts` 外，还返回前端直接可用的 `sources`：

```ts
type DetectionInputSource = {
  key: string        // generation-extract | generation-matting
  label: string      // UI 显示名
  folder: string     // 绝对路径
  count: number      // 当前图片数
}

type DetectionInputSources = {
  dirs: string[]
  counts: Record<string, number>
  sources: DetectionInputSource[]
}
```

### 11.2 结果列表补充字段

`detection:list-results` / `detection:get-result` 返回的结果对象可带 `thumbnailUrl` 和 `imagePath`，方便前端直接渲染缩略图。`delete-result` 会删除该条检测结果记录，并清理其检测输出文件，供结果列表里的“删除”按钮使用。

## 12. 成本估算

```ts
function estimateDetectionCost(
  imageCount: number,
  model: 'qwen3-vl-flash' | 'qwen3-vl-plus' | 'qwen-vl-max',
  withCompression: boolean,
): { yuan: number; tokensPerImage: number } {
  // 大致估算（实测会有偏差）
  const tokensPerImagePixels = withCompression ? 256 : 1024  // 压缩到 1024px 大约用 256 image tokens
  const tokensOutput = 100
  
  const PRICE = {
    'qwen3-vl-flash': { input: 0.15, output: 1.5 },     // 元/百万 token
    'qwen3-vl-plus':  { input: 1, output: 10 },
    'qwen-vl-max':    { input: 1.6, output: 4 },
  }
  const price = PRICE[model]
  const yuan = (
    imageCount * tokensPerImagePixels * price.input / 1_000_000 +
    imageCount * tokensOutput * price.output / 1_000_000
  )
  return { yuan, tokensPerImage: tokensPerImagePixels + tokensOutput }
}
```

这是近似估算思路。当前代码里已有检测成本相关逻辑，但 spec 不把某个固定 UI 展示或价格表当作稳定契约。

## 13. 错误处理

| 错误 | 处理 |
|---|---|
| 模型返回非 JSON | 通用解析器兜底；仍无法解析时标记失败 |
| 网络或模型调用失败 | 若错误可重试且未超过 `maxRetries` 则重试，否则标失败 |
| 内容违规（模型拒答）| 由模型返回内容决定；当前实现没有单独硬编码成固定风险等级 |
| 用户取消 | 停止后续图片处理，当前已完成的结果保留，并返回 `cancelled` |
| 透明底处理失败 | 跳过该图，标"预处理失败" |

## 14. 测试

- 透明底加白处理正确性（visual 对比）
- 压缩前后图片 token 数差异（人工验证）
- 通用解析器对各种 LLM 输出格式的兜底
- 并发限制 + 自适应降级
- 临时文件按时清理
- 重复检测跳过逻辑
