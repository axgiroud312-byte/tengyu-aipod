# Spec 06 — 标题生成模块

> 扫描套版完成的货号文件夹，取第 N 张图调阿里云百炼 VL 模型生成跨境电商标题，写入批次目录的标题 xlsx。当前默认文件名是 `标题.xlsx`，也支持用户自定义文件名。

## 1. 输入和输出

### 1.1 输入

用户在 UI 上填：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| 货号批次目录 | 路径 | ✅ | - | 如 `04-上架工作区/模板1_白T正面/` |
| 平台 | select | ✅ | Temu | 本地拉支持列表 |
| 语言 | select | ✅ | 英语 | 本地拉支持列表 |
| 模型 | select | ✅ | qwen3.6-flash | 用户可换其他可用视觉模型 |
| 标题文件名 | text | ✅ | 标题 | 写入 `{标题文件名}.xlsx`，用户可自定义 |
| 取第几张图 | number | ✅ | 1 | 默认第 1 张 |
| 标题额外要求 | textarea | ❌ | - | "强调原创设计，含 vintage 关键词" |
| 标题前缀 / 后缀 / 分隔符 | text | ❌ | - | 生成标题后拼接，用于批量加固定词 |
| 已有标题策略 | radio | ✅ | 跳过 | 跳过 / 重新生成 |
| 失败重试次数 | number | ✅ | 2 | 0-5 |

### 1.2 输出

```
{批次目录}/{标题文件名}.xlsx     ← 默认 标题.xlsx；A 列：货号  B 列：标题（仅 2 列）

数据库 skus 表：
  code, title, language, platform, ...
```

## 2. 平台与语言（本地配置）

```ts
const TITLE_PLATFORMS = [
  { key: 'temu', label: 'Temu' },
  { key: 'shein', label: 'Shein' },
  { key: 'tiktok', label: 'TikTok Shop' },
  { key: 'shopee', label: 'Shopee' },
  { key: 'amazon', label: 'Amazon' },
  { key: 'ozon', label: 'Ozon' },
  { key: 'mercado', label: 'Mercado Libre' },
]

const TITLE_LANGUAGES = [
  { key: 'en', label: '英语' },
  { key: 'zh', label: '中文' },
  { key: 'es', label: '西班牙语' },
  { key: 'pt', label: '葡萄牙语' },
  { key: 'de', label: '德语' },
  { key: 'fr', label: '法语' },
  { key: 'ja', label: '日语' },
  { key: 'ko', label: '韩语' },
  { key: 'ru', label: '俄语' },
  { key: 'ar', label: '阿拉伯语' },
]
```

支持列表由客户端本地维护，新增平台/语言需要随客户端版本更新。

## 3. Skill 系统

### 3.1 Skill 索引策略

```
按 (module='title', platform, language) 三元组索引最匹配的 skill：

精确匹配优先 → fallback 到通用 skill

例：
  GET /api/skills?module=title&platform=temu&language=en
    → 返回最适合 Temu English 的 skill
  
  客户端传 platform='temu' 时，会依次尝试 temu / temu_pop / temu_full。
  服务端 Skill 查询本身还支持 title 的 generic fallback。
```

### 3.2 Skill 数据结构

```ts
interface TitleSkill {
  id: string                          // "title-temu-en-v2"
  module: 'title'
  platform: string                    // 'temu' | 'temu_pop' | 'temu_full' | 'generic'
  language: string                    // 'en' | 'generic'
  version: string
  system_prompt: string               // 含输出格式约束（建议直接输出标题字符串）
  variables: SkillVariable[]          // 通常只有 "额外要求"
  recommended_model: string           // 'qwen3-vl-plus'
}
```

### 3.3 期望输出

skill 在 systemPrompt 里约束 LLM 输出**单一字符串标题**（不是 JSON），最简单的解析：

```
请直接输出最终标题，不要任何解释、序号、引号、markdown。

例（English）：
Vintage Floral Cotton T-Shirt for Women Casual Summer Wear

绝对不要：
- 加 "Title:" 前缀
- 加双引号包裹
- 加多余说明
```

### 3.4 通用解析器

```ts
function parseTitle(text: string, language: string): string {
  let title = text.trim()
  
  // 去掉可能的 "Title:" 前缀
  title = title.replace(/^(?:Title|标题|titre|título|titel)\s*[:：]\s*/i, '')
  
  // 去掉首尾引号
  title = title.replace(/^["'「『]+|["'」』]+$/g, '')
  
  // 去掉首尾空白
  title = title.trim()
  
  // 平台字数约束（按 byte 或 character 算）
  const maxLen = getPlatformTitleMaxLen(/* platform */)
  if (title.length > maxLen) title = title.substring(0, maxLen)
  
  return title
}
```

## 4. 执行流程

### 4.1 整体流程

```
用户填表 → [开始生成标题]
  ↓
扫描 {批次目录}/ 下所有一级子目录（货号文件夹）
  ↓
读已有 `{标题文件名}.xlsx`（默认 `标题.xlsx`，如存在）
  ↓
对每个货号：
  ├─ "跳过模式" + 已有标题 → 跳过
  ├─ "重新生成" → 处理
  └─ 没有标题 → 处理
  ↓
分配并发任务（默认 3，可调）
  ↓
对每个待处理货号：
  ① 排序文件夹内图片（字典序）
  ② 取第 N 张（默认 1；超出范围用最后一张 + UI 警告）
  ③ 预处理：透明底加白（强制）+ 压缩（推荐）→ base64
  ④ 拉 skill（按 platform+language 匹配）
  ⑤ 注入用户的 extraRequirement → user message
  ⑥ 调阿里云百炼 chat.completions
  ⑦ 解析标题 → 截断到平台长度 → 拼接前缀/后缀 → 保存
  ⑧ 失败 → 重试
  ↓
全部完成 → 写 `{标题文件名}.xlsx`
  ↓
UI 显示 ✅ N 成功 / ⚠️ M 失败
```

### 4.2 取第 N 张图的逻辑

```ts
function getNthImageFromSkuFolder(folder: string, n: number): string | null {
  const files = fs.readdirSync(folder)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort(sortAlphaNum)  // 自然排序
  
  if (files.length === 0) return null
  
  if (n > files.length) {
    log.warn(`SKU folder "${folder}" only has ${files.length} images, but user asked for #${n}; using last image`)
    return path.join(folder, files[files.length - 1])
  }
  
  return path.join(folder, files[n - 1])  // n 是 1-indexed
}
```

### 4.3 已有标题策略

```ts
async function processTitleBatch(config: TitleConfig) {
  const skuFolders = await scanSkuFolders(config.batchDir)
  const xlsxPath = titleXlsxPath(config.batchDir, config.titleFileName)
  const existingTitles = await readExistingTitles(xlsxPath)
  
  const tasks = []
  
  for (const skuFolder of skuFolders) {
    const skuCode = path.basename(skuFolder)
    const existing = existingTitles.get(skuCode)
    
    if (config.existingStrategy === 'skip' && existing) {
      // 跳过
      continue
    }
    if (config.existingStrategy === 'regenerate') {
      // 重新生成（覆盖）
      tasks.push({ skuCode, skuFolder, force: true })
    } else {
      // 跳过模式 + 无现有 → 处理
      tasks.push({ skuCode, skuFolder, force: false })
    }
  }
  
  return await runWithConcurrency(tasks, config.concurrency, async (task) => {
    const imagePath = getNthImageFromSkuFolder(task.skuFolder, config.imageIndex)
    if (!imagePath) return { skuCode: task.skuCode, success: false, error: 'NO_IMAGE' }
    
    const title = await generateTitle({
      imagePath,
      platform: config.platform,
      language: config.language,
      model: config.model,
      extraRequirement: config.extraRequirement,
      skillCache,
      maxRetries: config.maxRetries,
    })
    
    return { skuCode: task.skuCode, success: true, title }
  })
}
```

### 4.4 写入 xlsx

```ts
import ExcelJS from 'exceljs'

async function writeTitlesXlsx(
  xlsxPath: string,
  titles: Map<string, string>,
  existingTitles: Map<string, string>,
) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Titles')
  
  // 表头（A 列：货号，B 列：标题）
  sheet.columns = [
    { header: '货号', key: 'sku', width: 25 },
    { header: '标题', key: 'title', width: 60 },
  ]
  
  // 合并已有 + 新生成（新覆盖旧）
  const merged = new Map(existingTitles)
  for (const [sku, title] of titles) {
    merged.set(sku, title)
  }
  
  // 按字典序写入
  const sorted = Array.from(merged.entries()).sort(([a], [b]) => sortAlphaNum(a, b))
  for (const [sku, title] of sorted) {
    sheet.addRow({ sku, title })
  }
  
  await workbook.xlsx.writeFile(xlsxPath)
}

async function readExistingTitles(xlsxPath: string): Promise<Map<string, string>> {
  if (!await fs.exists(xlsxPath)) return new Map()
  
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(xlsxPath)
  const sheet = workbook.worksheets[0]
  
  const map = new Map<string, string>()
  sheet.eachRow((row, idx) => {
    if (idx === 1) return  // 表头
    const sku = String(row.getCell(1).value ?? '').trim()
    const title = String(row.getCell(2).value ?? '').trim()
    if (sku) map.set(sku, title)
  })
  return map
}
```

### 4.5 文件被锁的处理

```ts
async function writeTitlesXlsxWithRetry(xlsxPath: string, ...) {
  try {
    await writeTitlesXlsx(xlsxPath, titles, existingTitles)
  } catch (e: any) {
    if (e.code === 'EBUSY' || e.message.includes('EBUSY')) {
      throw new AppError({
        code: 'XLSX_LOCKED',
        message: '标题文件被 Excel 占用，请关闭后重试',
        retryable: false,
      })
    }
    throw e
  }
}
```

UI 上若失败：提示关闭标题 xlsx 后重试。
注：当前实现会把 `EBUSY` / `EPERM` / `EACCES` 统一映射为 `XLSX_LOCKED`。

## 5. UI

```
┌─ 标题生成 ─────────────────────────────────────────────┐
│                                                       │
│ ① 套完版的货号文件夹路径                                │
│    [选择...]                                           │
│    /Users/.../04-上架工作区/模板1_白T正面/              │
│    扫描结果：30 个货号文件夹                            │
│    ⚠️ 检测到 标题.xlsx 中已有 5 个标题                  │
│                                                       │
│ ② 平台：[Temu ▼]                                      │
│ ③ 语言：[英语 ▼]                                      │
│ ④ 模型：[qwen3.6-flash ▼]                            │
│                                                       │
│ ⑤ 标题额外要求：                                       │
│    [textarea]                                          │
│    例：强调原创设计、节日主题、含关键词 "vintage"        │
│                                                       │
│ ⑥ 取第几张图：[1] (默认 1)                             │
│ 标题名称：[标题]                                       │
│ 前缀：[可选]  后缀：[可选]  分隔符：[空格]               │
│                                                       │
│ 已有标题策略：● 跳过  ○ 重新生成                        │
│ 失败重试：[2] 次                                       │
│ 并发：[3] (1-10)                                       │
│                                                       │
│ 图像预处理：                                            │
│ ☑ 自动给透明底加白（强制）                              │
│ ☑ 压缩图片节省 token                                   │
│   最大边长：[1024 ▼]                                   │
│                                                       │
│ [开始生成标题]                                          │
└──────────────────────────────────────────────────────┘

[执行中]
进度：15 / 25（60%）
跳过：5 / 30
失败重试中：1
[取消任务]

[完成]
✅ 24 成功
⚠️ 1 失败（货号 SKU007，[查看错误] [重试]）

已写入：04-上架工作区/模板1_白T正面/标题.xlsx
[打开表格]  [打开批次目录]
```

## 6. 边界情况

| 情况 | 处理 |
|---|---|
| 货号文件夹为空（没图）| 跳过 + UI 警告 |
| 第 N 张图不存在 | 用最后一张 + UI 提示"货号 X 只有 K 张图，已用第 K 张" |
| LLM 返回空标题 | 按 `maxRetries` 重试；仍空 → 标记失败 |
| LLM 返回过长标题 | 截断到平台 max len |
| 网络异常 | 自动重试，超过 max_retries 标失败 |
| 用户取消 | 停止后续 SKU 处理，已完成标题仍写入 xlsx，结果带 `cancelled` |
| 标题 xlsx 被 Excel 占用 | 写入失败 → 返回 `XLSX_LOCKED`，UI 提示关闭后重试 |
| 模型/skill 不存在 | UI 提示选别的 |

## 7. 临时文件

```
.workbench/tmp/title/{taskId}/
  └─ {图片hash}_preprocessed.jpg  ← 预处理后临时图（同 detection 策略）

策略：
  单张调 API 完成后 → 删除该张预处理临时图
  任务成功完成 → 删整个 {taskId}/
  有失败项 → 保留任务目录一段时间用于排查
  任务取消 → 删整个 {taskId}/
```

## 8. 数据库

```sql
CREATE TABLE skus (
  code            TEXT PRIMARY KEY,
  template_batch  TEXT,                            -- 所属模板批次目录名
  title           TEXT,
  language        TEXT,
  platform        TEXT,
  title_skill_id  TEXT,
  title_skill_version TEXT,
  title_model     TEXT,
  title_generated_at INTEGER,
  created_at      INTEGER NOT NULL
);

-- 当前实现只登记 skus 表，不登记 title artifact 行。
-- E2E 可通过 TENGYU_SKIP_TITLE_DB_REGISTER=1 跳过数据库登记。
```

## 9. IPC 接口

```ts
'title:list-platforms'                → PlatformOption[]
'title:list-languages'                → LanguageOption[]
'title:list-models'                   → ModelOption[]
'title:choose-batch-dir'              → { ok: true, data: { path } } | { ok: false, error }
'title:scan-batch-dir'                → { batchDir, titleFileName? } → { skuCount, existingTitles: Record<string, string> }
'title:run'                            → {
                                          batchDir: string,
                                          titleFileName?: string,
                                          platform: string,
                                          language: string,
                                          model: string,
                                          imageIndex: number,
                                          extraRequirement?: string,
                                          titlePrefix?: string,
                                          titleSuffix?: string,
                                          titleSeparator?: string,
                                          existingStrategy: 'skip' | 'regenerate',
                                          maxRetries: number,
                                          concurrency: number,
                                          preprocess: PreprocessOptions,
                                        } → TaskId

'title:cancel'                        → { task_id } → { ok: boolean }
'title:retry-failed'                  → { task_id } → TaskId
'title:get-result'                    → { sku_code, batch_dir } → TitleResult | null
'title:open-path'                     → { path } → { ok: true } | { ok: false, error }

// 事件
'title:progress'                      → { task_id, processed, total, succeeded, failed, skipped, status? }
'title:completed'                     → { ok: true, result } | { ok: false, taskId, error }
```

## 10. 平台字数约束（参考，本地调整）

```ts
const PLATFORM_TITLE_MAX_LEN = {
  temu: 150,          // 字符
  shein: 200,
  tiktok: 250,
  shopee: 120,        // 不同区域不一样，按最严
  amazon: 200,
  ozon: 200,
  mercado: 60,
  generic: 150,
}
```

这个约束由本地平台/语言表和 Skill 配置共同决定，本地表是默认来源。

## 11. 成本估算

```ts
function estimateTitleCost(
  imageCount: number,
  model: 'qwen3-vl-flash' | 'qwen3-vl-plus' | 'qwen-vl-max',
  withCompression: boolean,
): { yuan: number } {
  const imageTokens = withCompression ? 256 : 1024
  const outputTokens = 80  // 一个标题约 80 token
  
  const PRICE = {
    'qwen3-vl-flash': { input: 0.15, output: 1.5 },
    'qwen3-vl-plus':  { input: 1, output: 10 },
    'qwen-vl-max':    { input: 1.6, output: 4 },
  }
  const p = PRICE[model]
  return {
    yuan: imageCount * (imageTokens * p.input + outputTokens * p.output) / 1_000_000,
  }
}
```

这是近似估算思路。当前代码里已有标题成本相关逻辑，但 spec 不把某个固定 UI 费用展示或价格表当作稳定契约。

## 12. 测试

- 各平台/语言组合的 skill 索引 fallback，尤其是 `temu` → `temu_pop` / `temu_full`
- 取第 N 张图的边界（n=0, n>len, n=负数）
- xlsx 读取/写入的合并逻辑
- xlsx 被锁时的错误处理
- 通用解析器对 LLM 各种输出的兜底
- 长标题截断
- 自定义标题文件名、前缀、后缀、分隔符
- 取消任务和重试失败 SKU
