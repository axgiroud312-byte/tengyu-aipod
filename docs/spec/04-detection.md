# Spec 04 — 侵权检测模块

> 用阿里云百炼的 qwen3-vl-* 视觉模型判断印花是否侵权（商标/卡通/名人/IP 等），输出 0-100 风险值并按阈值归类。

## 1. 输入与输出

### 1.1 输入域

- 02-生图 任一目录下的印花（带背景或透明底）
- 用户外部拖入的图

❌ 01-采集 的产品图不能直接检测（必须先提取成印花）

### 1.2 输出

- 物理：图复制到 `03-检测/{level}/` 的对应子目录
- 数据库：每张图一条 `detection_results` 记录，含风险值、依据、模型版本、skill 版本
- UI：列表展示每张图的判决结果

```
03-检测/
├─ pass/                          ← 风险值 0-39
│   └─ {印花ID}.jpg
├─ review/                        ← 风险值 40-69（需人工复核）
│   └─ {印花ID}.jpg
└─ block/                         ← 风险值 70-100（高风险拦截）
    └─ {印花ID}.jpg
```

注：03 是**物理复制**（不是软链接），保证用户用资源管理器看就是图片。

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
  id: string                          // "infringement-v2"
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

### 5.2 重试和限流

- OpenAI SDK 自带重试（默认 2 次）
- 429 退避重试 + 触发用户提示
- 单张超时 30 秒，跳过该图标记失败

## 6. UI 设计

```
┌─ 侵权检测 ────────────────────────────────────────────┐
│                                                       │
│ ① 选择待检测印花                                       │
│    ● 全选 02-生图/03-提取/ (30 张)                     │
│    ● 全选 02-生图/04-抠图/ (12 张)                     │
│    ○ 手动勾选（缩略图网格多选）                         │
│    ○ 从外部拖入                                        │
│                                                       │
│ ② 检测设置                                             │
│    模型：[qwen3-vl-flash ▼]                           │
│    Skill：[infringement-v2 ▼]                         │
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
预计剩余：1 分钟
当前并发：3
[暂停] [取消]

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

[一键加入待套版] 把 pass/ 的图复制到 04-待套版印花/
[导出报告 CSV]
```

## 7. 一键加入待套版

```
用户点 [一键加入待套版]
  ↓
弹窗：
  发现 28 张 pass 印花，将复制到 04-待套版印花/
  ● 复制（推荐，保留 03-检测/pass 副本）
  ○ 移动（不保留副本）
  [确认]
  ↓
执行：
  for img in pass/*.jpg:
    copy to 04-待套版印花/{印花ID}.png
    artifact record: step='matting' or 'extract' 关联到 04-待套版印花
```

**注意**：04-待套版印花 是"生产入口"，所以这里实际是数据流的"承诺"——把这些图送进套版生产线。

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

用户在 UI 上点"重测"按钮 → 强制覆盖历史结果。

## 9. 临时文件管理

```
.workbench/tmp/detection/{taskId}/
├─ {图片hash}_preprocessed.jpg
├─ {图片hash}_preprocessed.jpg
└─ ...

生命周期：
  任务启动 → 创建 {taskId}/ 目录
  预处理写文件 → {hash}_preprocessed.{ext}
  调 API 成功 → 立即删除该张临时文件
  调 API 失败 → 保留 1 小时（重试可复用）
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
  output_path     TEXT NOT NULL,                   -- 03-检测/{level}/{...}
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
'detection:list-skills'               → DetectionSkill[]
'detection:list-models'               → string[]
'detection:run'                       → { 
                                          image_paths: string[],
                                          model, 
                                          skill_id,
                                          variables,
                                          threshold,
                                          preprocess: { compress, max_size, format },
                                          concurrency,
                                        } → TaskId

'detection:get-result'                → { artifact_id } → DetectionResult | null
'detection:list-results'              → { task_id, risk_level? } → DetectionResult[]
'detection:retest'                    → { artifact_ids } → TaskId
'detection:promote-to-matting'        → { artifact_ids, mode: 'copy' | 'move' } → number

// 事件
'detection:progress'                  → { task_id, processed, total, current_image }
```

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

UI 上"预估费用"按这个公式即时计算。

## 13. 错误处理

| 错误 | 处理 |
|---|---|
| 模型返回非 JSON | 通用解析器兜底；解析失败 → 重试 1 次；仍失败 → 标"待人工" |
| 网络超时 | OpenAI SDK 自带重试 |
| 限流 429 | 退避重试，UI 提示 |
| 内容违规（模型拒答）| 标"高风险（70+）"或单独 review 分类（按 skill 设计）|
| 余额不足 | 启动前调 /balance/info 提示；运行时收到错误立即停 |
| 单张超时（> 30 秒）| 跳过该图，标失败，继续其他 |
| 透明底处理失败 | 跳过该图，标"预处理失败" |

## 14. 测试

- 透明底加白处理正确性（visual 对比）
- 压缩前后图片 token 数差异（人工验证）
- 通用解析器对各种 LLM 输出格式的兜底
- 并发限制 + 自适应降级
- 临时文件按时清理
- 重复检测跳过逻辑
