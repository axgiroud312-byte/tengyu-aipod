# Spec 07 — 上架模块

> 通过 Playwright + 比特浏览器 CDP 自动操作店小秘后台批量上架。
> 直接 Port `一键pod/上架程序` 的**框架代码**；重写每个平台的店小秘 DOM 操作代码（按 [listing-automation-builder SKILL](../../references/photoshop/open-source-references.md) 严格分层）。

## 1. 总体策略

### 1.1 Port 范围

| 源（一键pod/上架程序）| 目标（腾域）| 处理 |
|---|---|---|
| `packages/client/src/main/adapters/` （BitBrowser + CDP）| `pod-workbench/src/main/adapters/{bit-browser,cdp}.ts` | 跨模块共享，几乎原样 port |
| `packages/client/src/worker/listing/runner.ts` （批量调度框架）| `pod-workbench/src/modules/listing/runner.ts` | 几乎原样 port |
| `packages/client/src/main/ListingAdapter.ts` | `pod-workbench/src/modules/listing/adapter.ts` | 改 IPC 风格 |
| `packages/shared` 相关类型 | `pod-workbench/src/shared/listing-types.ts` | 迁移 |
| `data/dianxiaomi-template-groups.playwright.json` | **不 port**（v1 用户手填模板 ID）| - |
| `packages/client/src/worker/listing/platforms/temu-pop/` | `pod-workbench/src/modules/listing/platforms/dianxiaomi-temu-pop/` | **重写**（屎山代码不要）|
| `packages/client/src/worker/listing/platforms/shein/` | `pod-workbench/src/modules/listing/platforms/dianxiaomi-shein/` | **重写** |

### 1.2 v1 支持的平台

| 平台 | v1 | v1.5 |
|---|---|---|
| Temu PopTemu | ✅ | - |
| Shein | ✅ | - |
| Temu Full | - | ✅ |
| TikTok Shop | - | ✅ |
| Ozon | - | ✅ |
| Mercado Libre | - | ✅ |

每加一个平台 = 重写一套 selectors/parser/executor/workflow + 真实页面验证。

## 2. listing-automation-builder SKILL 强制规范

每个平台目录严格按 4 层分文件：

```
modules/listing/platforms/dianxiaomi-temu-pop/
├─ selectors.ts          ← 静态规则、字段语义、selector 候选定位
├─ page-parser.ts        ← 读真实 DOM 返回 observed_state
├─ action-executor.ts    ← 按 parser 输出重新定位元素 + 执行动作 + 验证 target_state
├─ workflow.ts           ← 业务状态机，11 个 stage 顺序推进
├─ smoke.ts              ← 真实页面验证脚本
└─ evidence/             ← 截图/DOM/日志（运行时产物）
```

### 2.1 selectors.ts 职责

只放静态规则，**不访问页面**：

```ts
export const SELECTORS = {
  title_input: [
    'css=input[name="title"]',                     // 优先
    'placeholder=请输入商品标题',                  // 次选
    'label=商品标题 >> input',                     // 兜底
  ],
  sku_input: [...],
  material_image_section: [...],
  publish_button: [...],
  success_toast: [
    'text=发布成功',
    'css=.success-toast',
  ],
  login_indicators: [
    '欢迎登录 简单生意就在店小秘',
    '拖动下方拼图完成验证',
    '找回密码',
  ],
}
```

支持的 selector 前缀：`css=` / `text=` / `label=` / `placeholder=` / `role=`，按顺序 fallback。

### 2.2 page-parser.ts 职责

读 DOM 返回**状态**（不传 ElementHandle 出来）：

```ts
export interface DraftPageState {
  url: string
  page_title: string
  shop_context: 'dianxiaomi-temu-pop' | 'unknown'
  is_login_required: boolean
  is_loading: boolean
  is_blocking_modal: boolean
  title_field: {
    found: boolean
    current_value: string | null
    is_disabled: boolean
  }
  material_section: {
    found: boolean
    current_image_count: number
    can_upload: boolean
  }
  publish_button: {
    found: boolean
    enabled: boolean
  }
}

export async function parseDraftPage(page: Page): Promise<DraftPageState> {
  return {
    url: page.url(),
    page_title: await page.title(),
    shop_context: detectShopContext(page),
    is_login_required: await checkLoginRequired(page),
    is_loading: await checkLoading(page),
    // ...
  }
}
```

### 2.3 action-executor.ts 职责

按 parser 输出**重新定位**元素 + 执行动作 + 重新 parser 验证：

```ts
export async function fillTitle(page: Page, title: string): Promise<void> {
  // 1. 解析当前状态
  const state = await parseDraftPage(page)
  if (!state.title_field.found) {
    throw new ListingActionError({
      code: 'SELECTOR_NOT_FOUND',
      action: 'fillTitle',
      state,
      retryable: false,
    })
  }
  
  // 2. 重新定位元素
  const input = await locateBySelectors(page, SELECTORS.title_input)
  
  // 3. 执行动作（清空再填）
  await input.fill('')
  await input.fill(title)
  
  // 4. 重新 parser 验证 target_state
  const afterState = await parseDraftPage(page)
  if (afterState.title_field.current_value !== title) {
    throw new ListingActionError({
      code: 'FIELD_VALUE_MISMATCH',
      action: 'fillTitle',
      expected: title,
      actual: afterState.title_field.current_value,
      retryable: true,
    })
  }
}
```

### 2.4 workflow.ts 职责

业务状态机，11 个 stage 顺序推进：

```ts
const STAGES = [
  'enter_page',             // openDraft
  'page_ready',             // 等加载完成
  'confirm_shop_context',   // 确认店铺
  'fill_title_and_sku',
  'upload_material_images',
  'upload_video',           // 可选
  'process_color_skc',      // clothing 类
  'reuse_size_chart',       // 可选
  'generate_sku_code',
  'process_description',    // 可选
  'submit_publish',
  'publish_result',         // 验证发布成功
] as const

export async function runListingItem(
  page: Page,
  item: ListingItem,
  config: ListingConfig,
): Promise<ListingResult> {
  const stages: StageResult[] = []
  
  for (const stage of STAGES) {
    try {
      const stageResult = await runStage(page, stage, item, config)
      stages.push(stageResult)
      // 每个 stage 都保存证据
      await evidence.saveStageEvidence(page, stage, stageResult)
    } catch (e) {
      const error = classifyListingError(e)
      stages.push({ stage, ok: false, error })
      
      if (!error.retryable) throw e
      // 可重试，外层 runner 处理
      throw e
    }
  }
  
  return { sku_code: item.sku_code, success: true, stages }
}
```

## 2.5 _commons 共用基础层

`platforms/_commons/` 下集中放跨平台共用的基础函数：

- `page-locator`：多选择器降级定位 + 单 selector 转 Locator
- `page-wait`：通用等元素可见 / 编辑器就绪 / 状态轮询
- `file-upload`：文件上传含 file chooser、菜单入口、全局 input 兜底
- `page-feedback`：toast 等页面反馈读取
- `error-utils`：错误分类与判定
- `test-helpers`：测试夹具与 fixture（仅 `.test.ts` 使用）

每个平台（`dianxiaomi-temu-pop` / `dianxiaomi-shein` / 未来新增）必须调用 `_commons`，不得重新实现这些基础函数。业务 action 仍保留在平台层，只有前置状态、目标状态、成功证据和失败策略一致时才继续抽共用。

selector 用 `SelectorRecord[]` 形式存储，含 `key` / `name` / `primary` / `fallbacks` / `version` / `createdAt`，再派生平台内部兼容 map 给 parser/executor 使用。这个形态为 v1.5 `v15-selectors-dispatch` 云端派发铺路，但当前仍只读取客户端本地 record。

## 3. 比特浏览器 + CDP 共享适配器

```ts
// adapters/bit-browser.ts（与 collection 共享）
class BitBrowserClient {
  private baseUrl = 'http://127.0.0.1:54345'
  
  async listProfiles(): Promise<Profile[]> { ... }
  async openProfile(profileId: string): Promise<{ http: string }> { ... }
  async closeProfile(profileId: string): Promise<void> { ... }
}

// adapters/cdp.ts
import { chromium } from 'playwright-extra'

class CDPClient {
  async connectToProfile(profileId: string): Promise<Browser> {
    const { http } = await bitBrowser.openProfile(profileId)
    return await chromium.connectOverCDP(http)
  }
}
```

## 4. Profile 锁（跨模块互斥）

```ts
// adapters/browser-profile-lock.ts
class BrowserProfileLock {
  private locks: Map<string, ProfileHolder> = new Map()
  
  async acquire(
    profileId: string,
    module: 'collection' | 'listing',
    taskId: string,
  ): Promise<ProfileHandle | null> {
    if (this.locks.has(profileId)) return null
    
    const handle = new ProfileHandle(profileId, () => this.locks.delete(profileId))
    this.locks.set(profileId, { module, taskId, acquired_at: Date.now() })
    return handle
  }
  
  list(): Map<string, ProfileHolder> {
    return new Map(this.locks)
  }
}
```

## 5. 输入：从 04-上架工作区 转 ListingItem[]

```ts
async function loadBatchAsListingItems(
  batchDir: string,
): Promise<{ items: ListingItem[]; warnings: string[] }> {
  const warnings: string[] = []
  
  // 1. 读标题表，优先 标题.xlsx，兼容旧 titles.xlsx
  const { fileName, titles } = await readListingTitles(batchDir)
  
  // 2. 扫一级子目录（货号文件夹）
  const skuFolders = await fs.readdir(batchDir, { withFileTypes: true })
    .then(es => es.filter(e => e.isDirectory()))
  
  const items: ListingItem[] = []
  
  for (const folder of skuFolders) {
    const skuCode = folder.name
    const title = titles.get(skuCode)
    if (!title) {
      warnings.push(`货号 ${skuCode} 在 ${fileName} 中无标题，跳过`)
      continue
    }
    
    const skuFolder = path.join(batchDir, skuCode)
    const images = (await fs.readdir(skuFolder))
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort(sortAlphaNum)
      .map(f => path.join(skuFolder, f))
    
    if (images.length === 0) {
      warnings.push(`货号 ${skuCode} 文件夹为空，跳过`)
      continue
    }
    
    items.push({
      sku_code: skuCode,
      title,
      material_image_paths: images,  // 默认作为轮播 / 素材图
      // 用户可在 UI 上调整图片分配
    })
  }
  
  return { items, warnings }
}
```

## 6. UI

```
┌─ 上架 ──────────────────────────────────────────────┐
│                                                    │
│ ① 货号批次目录                                       │
│    [选择...]                                        │
│    /Users/.../04-上架工作区/模板1_白T正面/           │
│    扫描结果：30 个货号                               │
│    ✅ 标题表中 28 个有标题                           │
│    ⚠️ 2 个货号无标题 [去标题模块补全]                │
│                                                    │
│ ② 平台                                              │
│    [Temu PopTemu ▼] (v1: Temu/Shein)               │
│                                                    │
│ ③ 店铺环境（多店铺）                                  │
│    ☑ profile-001 (店铺A - Temu主店) ● 已登录         │
│    ☑ profile-002 (店铺B - Temu备店) ● 已登录         │
│    ☐ profile-003 (Shein 店) ⚠️ 平台不匹配             │
│    [刷新比特浏览器列表] [profile 状态]               │
│                                                    │
│ ④ 草稿模板 ID                                        │
│    [输入框，单行] 12345678                          │
│    提示：在店小秘后台 → 创建草稿模板 → 复制模板 URL  │
│         上的 id 参数                                │
│                                                    │
│ ⑤ SKU 编码                                          │
│    ● 自动生成（程序按规则）                          │
│    ○ 用标题表中的 SKU 列（如有）                     │
│    ○ 手动统一前缀：[POD-]                          │
│                                                    │
│ ⑥ 提交方式                                          │
│    ● 保存为草稿（在店小秘后台再确认）                │
│    ○ 直接发布                                       │
│                                                    │
│ ⑦ 高级（默认折叠）                                  │
│    每店铺并发：[1] (建议 1 避免风控)                 │
│    失败重试：[2]                                    │
│    连续失败暂停阈值：[5]                            │
│                                                    │
│ ⑧ ☑ 启用断点续传（重启后自动跳过已成功的）            │
│                                                    │
│ 预估：30 条 × 30-60 秒 ÷ 2 店铺 ≈ 8-15 分钟          │
│                                                    │
│ [开始上架]                                           │
└──────────────────────────────────────────────────┘

[执行中]
店铺A (profile-001)：12/15 ✅ / 1 失败
店铺B (profile-002)：10/15 ✅ / 0 失败
当前：店铺A · SKU007 · upload_material_images 5/8

[暂停] [取消] [查看日志]

[完成]
✅ 27 成功 / ⚠️ 3 失败
失败：SKU007 (DRAFT_NOT_FOUND), SKU021 (SELECTOR_NOT_FOUND), SKU023 (TIMEOUT)
[重试失败] [导出报告]
```

## 7. Runner（编排框架）

```ts
// modules/listing/runner.ts
export async function runLocalListingBatch(
  config: ListingRunConfig,
  items: ListingItem[],
): Promise<BatchResult> {
  const workspaceQueues = new Map<string, Queue<ListingItem>>()
  
  // 1. 把 items 按 workspace 分发（轮询）
  for (const [idx, item] of items.entries()) {
    const workspaceIdx = idx % config.workspaces.length
    const ws = config.workspaces[workspaceIdx]
    const q = workspaceQueues.get(ws.profile_id) ?? new Queue()
    q.push(item)
    workspaceQueues.set(ws.profile_id, q)
  }
  
  // 2. 每个 workspace 并行（跨 workspace），各自串行（同 workspace）
  const workspaceResults = await Promise.all(
    Array.from(workspaceQueues.entries()).map(([profileId, queue]) =>
      runWorkspace(profileId, queue, config)
    )
  )
  
  return aggregateResults(workspaceResults)
}

async function runWorkspace(
  profileId: string,
  queue: Queue<ListingItem>,
  config: ListingRunConfig,
): Promise<WorkspaceResult> {
  // 1. 获取 profile 锁
  const lock = await browserProfileLock.acquire(profileId, 'listing', taskId)
  if (!lock) throw new AppError({ code: 'PROFILE_LOCKED', ... })
  
  try {
    // 2. 通过 CDP 连接
    const browser = await cdpClient.connectToProfile(profileId)
    const context = browser.contexts()[0]
    const page = await context.newPage()
    
    // 3. 顺序处理队列
    let failStreak = 0
    while (!queue.empty() && !shouldStop()) {
      const item = queue.next()!
      
      // 断点续传检查
      if (config.resume) {
        const status = await db.listing_status.findOne({
          batch_path: config.batchDir,
          sku_code: item.sku_code,
          platform: config.platform,
          workspace_id: profileId,
        })
        if (status?.status === 'success') {
          recordSkipped(item)
          continue
        }
      }
      
      // per-item 重试
      try {
        const result = await runItemWithRetries(page, item, config)
        await db.listing_status.upsert({ ...status, status: 'success', ... })
        failStreak = 0
      } catch (e) {
        await db.listing_status.upsert({ ...status, status: 'failed', last_error: e.message, ... })
        failStreak++
        if (failStreak >= config.failStreakLimit) {
          throw new AppError({ code: 'CONSECUTIVE_FAILURES', message: `连续 ${failStreak} 次失败，店铺环境暂停` })
        }
      }
    }
    
    await page.close()
    await browser.close()
  } finally {
    lock.release()
  }
}

async function runItemWithRetries(
  page: Page,
  item: ListingItem,
  config: ListingRunConfig,
): Promise<ListingResult> {
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      // 平台 workflow 入口
      const workflow = getPlatformWorkflow(config.platform)
      return await workflow.runListingItem(page, item, config)
    } catch (e) {
      const error = classifyListingError(e)
      if (!error.retryable || attempt === config.maxAttempts) throw e
      await sleep(2 ** attempt * 1000)
    }
  }
  throw new Error('unreachable')
}
```

## 8. 错误码

```ts
type ListingErrorCode =
  // 可重试
  | 'TIMEOUT'
  | 'BLOCKING_MODAL'
  | 'PAGE_NOT_READY'
  | 'FILE_CHOOSER_TIMEOUT'
  | 'FIELD_VALUE_MISMATCH'

  // 不可重试
  | 'LOGIN_REQUIRED'
  | 'SELECTOR_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'PUBLISH_FAILED'
  | 'PROFILE_LOCKED'
  | 'BROWSER_NOT_CONNECTED'
  | 'CONSECUTIVE_FAILURES'

function isRetryable(code: ListingErrorCode): boolean {
  return ['TIMEOUT', 'BLOCKING_MODAL', 'PAGE_NOT_READY', 'FILE_CHOOSER_TIMEOUT', 'FIELD_VALUE_MISMATCH'].includes(code)
}
```

## 9. 断点续传

```sql
CREATE TABLE listing_status (
  id              TEXT PRIMARY KEY,
  batch_path      TEXT NOT NULL,
  sku_code        TEXT NOT NULL,
  platform        TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  status          TEXT NOT NULL,                   -- 'pending' | 'uploading' | 'success' | 'failed'
  draft_template_id TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_attempted_at INTEGER,
  last_error      TEXT,
  evidence_dir    TEXT,                            -- 证据路径
  created_at      INTEGER NOT NULL,
  UNIQUE(batch_path, sku_code, platform, workspace_id)
);
```

启动新任务时若 `config.resume = true`：
- 跳过 `status='success'` 的
- 重试 `status='failed'` 的（重置 retry_count）
- 处理 `status='pending'` 或 `status='uploading'`（中断的）

## 9.1 店铺环境 × 任务编排

v1 UI 在 `listing_status` 之外新增两张本地 SQLite 表，用来保存"哪个店铺环境有哪些上架任务"。它们只存在客户端 `.workbench/workbench.db`，服务端不接触店铺、批次目录或任务数据。

```sql
CREATE TABLE listing_workspaces (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  profile_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,              -- idle | running | paused | failed | completed
  current_task_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(profile_id, platform)
);

CREATE TABLE listing_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  template_key TEXT NOT NULL,
  draft_template_id TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  batch_dir TEXT NOT NULL,
  sku_mode TEXT NOT NULL,
  submit_mode TEXT NOT NULL,
  max_attempts INTEGER NOT NULL,
  fail_streak_limit INTEGER NOT NULL,
  resume INTEGER NOT NULL,
  status TEXT NOT NULL,              -- queued | running | paused | completed | failed
  last_run_task_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES listing_workspaces(id)
);
```

新增 IPC：

- `listing:list-saved-workspaces`
- `listing:save-workspace`
- `listing:update-workspace-status`
- `listing:list-tasks`
- `listing:create-task`
- `listing:update-task-status`
- `listing:delete-task`

Runner 契约：`ListingRunConfig.workspaces[]` 可以携带 `workspace_id` 和 `task_id`。店铺环境开始时 runner 标记对应 `listing_tasks.status='running'`、`listing_workspaces.status='running'`；店铺环境完成后按货号结果回写 `completed` 或 `failed`，并清空 `current_task_id`。跨店铺环境仍并行，同店铺环境仍串行；DOM 操作仍只在平台目录的 `selectors / page-parser / action-executor / workflow` 四层内发生。

## 10. 证据保存

```
.workbench/tmp/listing/{taskId}/
└─ evidence/
    └─ {profileId}/
        └─ {skuCode}/
            ├─ stage-01-enter_page/
            │   ├─ screenshot.png
            │   ├─ dom.html
            │   └─ state.json
            ├─ stage-02-page_ready/
            ├─ ...
            └─ stage-12-publish_result/
```

证据保留 24 小时（用于失败排查），过期清理。

成功的任务证据**不删**（用户可在 UI 看截图回放）：v1 暂时不实现，证据全删；v1.5 加。

## 11. UI 进度

```ts
// 事件
'listing:progress'                 → { 
                                       task_id,
                                       overall: { total, completed, failed, skipped, pending },
                                       per_workspace: Map<profile_id, WorkspaceProgress>,
                                       current_stage: { profile_id, sku_code, stage, attempt },
                                     }
'listing:item-completed'           → { task_id, sku_code, profile_id, success, stages }
'listing:workspace-paused'         → { task_id, profile_id, reason }
```

## 12. 选择器本地版本化（v1.5+）

v1 选择器写死在代码里（每个平台目录）。v1.5 仍保持本地版本化：规则随客户端版本发布，或者由用户在本地导入更新包。

```
packages/client/src/modules/listing/platforms/
└─ dianxiaomi-temu-pop/
   ├─ selectors.ts
   ├─ page-parser.ts
   ├─ action-executor.ts
   └─ workflow.ts
```

客户端启动时读取本地版本和用户自定义覆盖项。这样店小秘改版时，直接随客户端更新或本地替换选择器文件即可。

## 13. IPC 接口

```ts
'listing:list-platforms'              → string[]
'listing:list-workspaces'             → BitBrowserProfile[]
'listing:check-profile-status'        → { profile_id } → { logged_in, platform_detected }
'listing:scan-batch'                  → { batch_dir, platform } → { items, warnings }
'listing:run'                          → {
                                          batch_dir, platform, workspaces, draft_template_id,
                                          sku_strategy, submit_mode,
                                          max_attempts, fail_streak_limit,
                                          per_shop_concurrency, resume,
                                        } → TaskId

'listing:get-progress'                → { task_id } → ListingProgress
'listing:pause-workspace'             → { task_id, profile_id } → void
'listing:cancel'                      → { task_id } → void
'listing:retry-failed'                → { task_id } → TaskId
'listing:list-failed-items'           → { task_id } → ListingFailedItem[]
'listing:get-evidence-path'           → { task_id, sku_code, profile_id } → string

// 事件
'listing:progress'                    → ListingProgress
'listing:item-completed'              → ListingItemResult
'listing:workspace-paused'            → { task_id, profile_id, reason }
'listing:login-required'              → { task_id, profile_id }      // 弹窗引导用户去比特登录
```

## 14. v1 → v1.5 演进

| 项 | v1 | v1.5 |
|---|---|---|
| 平台 | Temu PopTemu + Shein | + TikTok / Temu Full / Ozon / Mercado |
| 草稿模板 | 用户手填 | + 云端常用模板列表 |
| 证据保存 | 失败留 24h，成功立即删 | 成功也保留 7 天，UI 看回放 |
| 选择器派发 | 写死在客户端 | 云端动态派发 + 版本化 |
| 失败诊断 | 手动看日志 | AI 辅助诊断（按 stage 错误类型给建议）|
| 多 listing 并发同店铺 | 1（保守）| 用户可配，但提示风控风险 |

## 15. 测试

- listing-automation-builder 4 层分层的语法/边界
- profile 锁的并发竞争（采集 vs 上架）
- 断点续传从中断点恢复
- 错误分类的可重试 / 不可重试逻辑
- 真实店小秘页面的 selectors 验证（每次发版前）

## 16. 安全和合规

- 不绕过店小秘的反爬/限流（每店铺并发 1 是为了模拟人工）
- 不存储用户的店小秘账号密码（cookie 在比特浏览器内）
- 不上传用户的商品数据到腾域云端
- 错误上报脱敏（不带 SKU 内容、不带店铺名、不带 URL 完整路径）

## 17. 关键参考

- ADR-0004：上架模块必须按 selectors / page-parser / action-executor / workflow 四层结构落地。
- ADR-0014：上架平台 `_commons` 基础层和 selector record 结构。
- 历史“一键pod/上架程序”源码只作为迁移参考，不在文档中依赖本机绝对路径。
