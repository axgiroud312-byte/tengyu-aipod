# Spec 01 — 任务货号编排

> 本文规定**任务/货号两层模型**、v1 **完整任务最初版**和 v1.5 **通用编排引擎**的设计边界。
> v1 已实现一个内置固定完整任务服务；通用多模板编排引擎仍留 v1.5。

## 1. 核心抽象

### 1.1 货号（SKU / sku_code）

- **定义**：一个上架 listing 的业务标识
- **格式**：`/^[A-Za-z0-9_-]{1,60}$/`，禁用 Windows 非法字符、空格、中文、保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）
- **大小写**：保留输入，比较时不敏感
- **唯一性**：本机内全局唯一（同 sku_code 在数据库中只一条 skus 记录）
- **重命名**：仅在该 sku 无"进行中"任务时允许，联动文件夹改名 + 数据库更新

### 1.2 任务（Task）

```ts
interface Task {
  id: string                          // UUID
  type: 'lightweight' | 'full'
  module: string                       // "collection" | "generation" | ...（lightweight 时填模块名）
  sku_code: string | null              // full 任务必有；lightweight 可有可无
  status: TaskStatus
  config_json: string                  // JSON 字符串，启动时的配置快照
  created_at: number
  completed_at: number | null
}

type TaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'                      // 软件中途关闭

interface WorkflowStep {
  id: string
  task_id: string
  module: string
  step_order: number
  status: StepStatus
  attempt: number                      // 当前尝试次数
  error_json: string | null
  started_at: number | null
  completed_at: number | null
}

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
```

### 1.3 两种任务类型对比

| 类型 | 何时创建 | 步骤数 | sku_code | 编排引擎介入 |
|---|---|---|---|---|
| **lightweight** | 单模块面板"开始"按钮 | 1 个步骤 | 可有可无 | 否 |
| **full** | 完整任务页面启动，或未来编排引擎按模板创建 | 多步 | 套版后产生 | v1 为内置固定服务，v1.5 为通用编排引擎 |

## 2. v1 任务管理（轻量任务 + 完整任务最初版）

### 2.1 任务生命周期

```
用户点"开始"
  ↓
主进程创建 Task（type=lightweight, status=running）
  ↓
创建 1 个 WorkflowStep（status=running）
  ↓
模块执行业务逻辑（调外部 API / Playwright / Photoshop 等）
  ↓
执行结果：
  成功 → Task.status=completed, Step.status=completed
  失败 → Task.status=failed, Step.status=failed, error_json 写入
  软件关闭 → Task.status=interrupted（启动时检测并询问用户）
```

### 2.2 启动时恢复

```ts
// 主进程启动时检测中断任务
const interrupted = await db.tasks.findMany({ status: 'interrupted' })

if (interrupted.length > 0) {
  // UI 弹窗
  showRecoveryDialog({
    tasks: interrupted,
    onResume: (taskId) => { /* 按模块粒度恢复 */ },
    onDiscard: (taskId) => { /* 标记 failed */ },
  })
}
```

恢复粒度按模块（详见 §6）。

### 2.3 同 SKU 互斥

启动新任务前检查：

```ts
function canStartTask(skuCode: string | null): { ok: boolean; reason?: string } {
  if (!skuCode) return { ok: true }  // 无 sku 的轻量任务不冲突

  const running = db.tasks.findFirst({
    sku_code: skuCode,
    status: 'running',
  })

  if (running) {
    return {
      ok: false,
      reason: `货号 ${skuCode} 已有进行中任务 ${running.id}，请等待或取消`,
    }
  }
  return { ok: true }
}
```

### 2.4 完整任务最初版

v1 已实现一个固定顺序完整任务，不是自由流程编辑器，也不包含上架。
当前完整任务页按“上方配置、下方结果”组织。配置区包含印花来源 / 是否抠图 / 侵权检测 + 套版 + 标题生成；
结果区按阶段展示采集图、参考图、印花产物、侵权检测结果和后续摘要。
来源区当前只暴露 `collection`、`txt2img`、`img2img`；`existing_prints` 仍保留在底层 pipeline schema 里做兼容，不作为主入口。
启用 PS 套版时要求填写 **印花货号**，它是本次最终印花文件名和套版后货号文件夹名的共同前缀。

```
来源准备
  ├─ collection：采集 + 提取（Grsai / 晨羽）
  ├─ txt2img：固定 Grsai 付费模型
  └─ img2img：固定 Grsai 付费模型
  ↓
可选抠图（固定 ComfyUI 晨羽）
  ↓
可选侵权检测（默认读取检测模块已保存配置，也可在完整任务内为本次运行覆盖模型和 Skill）
  ↓
准备等待套版印花（按印花货号命名）
  ↓
可选 PS 套版
  ↓
可选标题生成（依赖 PS 套版）
```

首版策略：

- 印花货号使用货号格式：`/^[A-Za-z0-9_-]{1,60}$/`，禁空格、中文和 Windows 保留名；只有启用 PS 套版时必填。
- 启用 PS 套版时，完整任务会把可套版印花复制到 `02-印花工作区/等待套版/{runId}/`。
  单张印花命名为 `{印花货号}.{ext}`；多张印花命名为 `{印花货号}-01.{ext}`、`{印花货号}-02.{ext}`。
- 局部印花默认启用抠图，满印默认关闭抠图。
- 抠图、侵权检测、PS 套版、标题生成都由页面显式开关控制；关闭的步骤记录为 `skipped`。
- 侵权检测可选；完整任务页默认读取检测模块已保存配置，同时允许在本次完整任务草稿里覆盖模型、Skill、压缩和通过要求；这些覆盖不反写单独侵权检测模块的默认配置。
- 检测通过要求默认是 `block` 拦截、`pass` 和 `review` 放行；也可切到“仅无风险通过”，让 `review` 和 `block` 一起拦截。
- 完整任务页下方显示阶段结果。采集图和参考图可分页；文生图、图生图、提取和抠图等印花产物按预计产出数量预留槽位，完成一张显示一张，未完成显示加载中，失败槽位隐藏。
- 侵权检测结果在完整任务页分为“通过”和“未通过”。`review` 的归属跟随本次通过要求：允许疑似通过时放入通过区，仅无风险通过时放入未通过区。
- 完整任务页提供完整任务运行期日志窗口，展示阶段开始、完成、失败、模型、数量、输出路径和关键错误；深度排障仍查看各模块诊断日志。
- 完整任务草稿只在当前软件会话内保留。切换页面后恢复当前配置，应用重启后不恢复。
- 来源图预览可折叠；图生图入口使用上传参考图并可删除，上传图保存到 `.workbench/pipeline-runs/{runId}/references/`。
- 标题生成依赖 PS 套版；关闭 PS 时标题自动关闭。
- 启用 PS 套版时完整任务只能在 Windows 启动；未启用 PS 时 macOS 可运行前置步骤。
- 取消是尽力取消：检测、PS、标题可向底层 runner 传取消信号；生图批处理主要在 step 边界停止。
- 首版不支持暂停 / 恢复 / 断点续跑。

实现上，完整任务复用各模块 runner：

- 生图：`generation-service`
- 检测：`detection-service`
- PS：`photoshop/multi-batch`
- 标题：`title-service`

运行记录暂存独立表 `pipeline_runs` / `pipeline_steps`。这避免在通用任务模型完全落地前，
把固定流程的状态模型提前塞进 `tasks` / `workflow_steps`。

### 2.5 完整任务与单独模块并发

完整任务运行时允许单独模块并行，但按资源边界互斥：

- 采集：不同采集文件夹可并行；完整任务正在读取的采集文件夹不能同时被采集模块写入。
- 生图：Grsai 付费模型可与完整任务并行；同一晨羽实例同一时刻只允许一个任务占用。
- 侵权检测：完整任务侵权检测和单独侵权检测完全分开执行，各自使用自己的并发。
- PS 套版：Photoshop 是单实例资源，同一时刻只允许一个 PS 任务运行。
- 印花货号：同一印花货号同一时刻只能有一个进行中的完整任务。

## 3. 全局任务队列

### 3.1 队列设计

```ts
// 主进程内单例
class TaskQueue {
  private queue: PriorityQueue<QueuedTask>
  private running: Set<TaskId> = new Set()
  private maxConcurrency: number      // 用户配置，默认 3

  enqueue(task: QueuedTask): Promise<TaskResult>
  pause(taskId: TaskId): void          // 软暂停，当前 step 完成后停
  resume(taskId: TaskId): void
  cancel(taskId: TaskId): void         // 立即取消（尽力）
}

interface QueuedTask {
  task_id: string
  priority: 1 | 2 | 3                  // 1=user, 2=完整任务/未来通用编排, 3=retry
  resource_locks_needed: ResourceLock[]
  execute: () => Promise<TaskResult>
}
```

### 3.2 优先级

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 用户手动触发 | 最优先 |
| 2 | 编排引擎（v1.5）| 自动跑串联 |
| 3 | 失败自动重试 | 最后 |

### 3.3 资源锁

```ts
type ResourceLock =
  | { type: 'browser_profile'; profile_id: string }
  | { type: 'collection_folder'; path: string }
  | { type: 'photoshop'; instance: 'singleton' }
  | { type: 'sku'; sku_code: string }
  | { type: 'global_concurrency' }

class ResourceLockManager {
  acquire(locks: ResourceLock[]): Promise<LockHandle | null>
  release(handle: LockHandle): void
}
```

任务调度算法：

```
循环：
  1. 从队列取最高优先级任务
  2. 检查所需 ResourceLock 是否可用
  3. 不可用 → 暂留队列，等待资源释放
  4. 可用 → 获取锁 → 执行任务 → 完成后释放锁
```

### 3.4 用户可调整并发

设置面板：

```
全局并发上限：[3] (1-10)
说明：超过此数的任务进入等待队列。
建议：4 核 CPU + 8GB RAM 建议 3；高配可设到 5-6。
```

## 4. 资源互斥规则

### 4.1 比特浏览器 Profile 互斥

**规则**：同一 profile 同时刻只能被 1 个模块占用（采集 OR 上架）。

```ts
// adapters/browser-profile-lock.ts
class BrowserProfileLock {
  private locks: Map<string, ProfileHolder> = new Map()

  async acquire(
    profileId: string,
    module: 'collection' | 'listing',
    taskId: string,
  ): Promise<ProfileLock | null> {
    if (this.locks.has(profileId)) {
      const holder = this.locks.get(profileId)!
      return null  // 已被占用
    }
    const lock = new ProfileLock(profileId, () => this.locks.delete(profileId))
    this.locks.set(profileId, { module, taskId, lock })
    return lock
  }

  status(profileId: string): ProfileHolder | null {
    return this.locks.get(profileId) ?? null
  }

  list(): Map<string, ProfileHolder> {
    return new Map(this.locks)
  }
}
```

UI 表现：

- 采集模块在 profile 列表里显示其他 profile 状态
- 上架模块在 profile 多选时灰显已被采集占用的 profile

### 4.2 Photoshop 互斥

**规则**：PS 客户端只能有一个 COM 连接活跃，所以套版任务**全局串行**。

```ts
// adapters/photoshop.ts
class PhotoshopAdapter {
  private activeTask: TaskId | null = null
  private mutex: Mutex = new Mutex()  // async-mutex 库

  async runJob<T>(taskId: TaskId, fn: () => Promise<T>): Promise<T> {
    return await this.mutex.runExclusive(async () => {
      this.activeTask = taskId
      try {
        return await fn()
      } finally {
        this.activeTask = null
      }
    })
  }
}
```

### 4.3 同 SKU 互斥

§2.3 已说明。

## 5. 暂停与恢复（v1.5 通用编排设计）

当前 v1 完整任务只支持取消，不支持暂停 / 恢复 / 断点续跑；以下内容是 v1.5 通用编排引擎的目标设计，不能当作当前已落地能力。

### 5.1 用户手动暂停

```
用户点任务进度面板 "暂停" 按钮
  ↓
TaskQueue.pause(taskId)
  ↓
等待当前正在执行的 step 完成（不强制中断）
  ↓
Task.status = 'paused'（数据库标记）
Step.status = 'completed'（当前 step）或 'pending'（后续 step）
  ↓
释放资源锁
  ↓
UI 切换为"已暂停"状态

用户点"继续"按钮：
  TaskQueue.resume(taskId) → 重新 enqueue（保持原 priority）
```

### 5.2 软件中途关闭

```
主进程进程退出钩子（before-quit）：
  对所有 running 任务：
    Task.status = 'interrupted'
    数据库 flush
    释放资源锁

下次启动：
  扫 task.status = 'interrupted' 的任务
  UI 弹窗"上次未完成的任务"
    [恢复] → 按模块粒度从上次中断点继续
    [放弃] → 标记 failed
```

### 5.3 按模块的恢复粒度

| 模块 | 粒度 | 恢复行为 |
|---|---|---|
| 采集 | 会话级 / 图池级 | 会话采集需重新启动；图池结果保存在前端内存，重启后重新扫描 |
| 生图 | 单图级 | 数据库查已成功的产物 → 跳过 → 继续未完成的图 |
| 检测 | 单图级 | 同上 |
| 套版 | 任务组级 | 已完成的组跳过，未完成的从该组重头开始 |
| 标题 | 单货号级 | 已生成的跳过 |
| 上架 | 单 listing 级 | listing_status 表查 success 的跳过 |

## 6. 通用编排引擎（v1.5）

### 6.1 流程模板

v1.5 在完整任务最初版基础上升级为通用编排引擎。届时内置多个模板，
每个模板是一组有序的步骤定义：

```ts
interface PipelineTemplate {
  id: string
  name: string
  steps: PipelineStep[]
}

interface PipelineStep {
  id: string
  module: string                      // 用哪个模块
  required: boolean                   // 是否必经
  config_defaults: Record<string, unknown>
}
```

```ts
const TEMPLATES: PipelineTemplate[] = [
  { id: 'full-chain', name: '完整链路', steps: [
    { module: 'collection', required: true, ... },
    { module: 'generation', required: true, config_defaults: { capability: 'extract' } },
    { module: 'generation', required: false, config_defaults: { capability: 'img2img' } },
    { module: 'generation', required: true, config_defaults: { capability: 'matting' } },
    { module: 'detection', required: true, ... },
    { module: 'photoshop', required: true, ... },
    { module: 'title', required: true, ... },
    { module: 'listing', required: true, ... },      // v1.5 后续模板才包含上架
  ]},
  { id: 'from-print', name: '从印花开始', steps: [...] },
  { id: 'mockup-only', name: '只套版', steps: [...] },
  { id: 'mockup-and-listing', name: '套版加上架', steps: [...] },
  { id: 'title-and-listing', name: '标题加上架', steps: [...] },
  { id: 'gen-only', name: '只生图', steps: [...] },
]
```

### 6.2 执行模式

**自动连跑**：
```
for step of pipeline.steps:
  if step.required or user_config[step.id].enabled:
    run module step
    if failed → pause whole task → notify user
  else:
    skip
```

**逐步确认**：
```
for step of pipeline.steps:
  run module step
  show preview → wait for user click "Next"
  user can adjust step params before "Next"
```

### 6.3 失败传播策略

启动 full 任务时用户选：
- ● 任一失败 → 停止（默认）
- ○ 任一失败 → 跳过失败项继续
- ○ 任一失败 → 暂停等用户处理

```ts
interface FullTaskConfig {
  template_id: string
  execution_mode: 'auto' | 'step_by_step'
  failure_policy: 'halt' | 'skip' | 'pause'
  ...
}
```

### 6.4 货号在编排中的流转

```
v1 完整任务示例（采集图不是 sku，sku 由完整任务顶部的印花货号在套版前产生）：

采集 step → 图池扫描/点击采集 → 得到产品图
  ↓
生图 step（提取）→ 从产品图提取印花
  ↓
（可选）生图 step（图生图）
  ↓
生图 step（抠图）→ 印花 ready
  ↓
检测 step → 风险通过
  ↓
等待套版准备 → 02-印花工作区/等待套版/{runId}/{sku}.png
  ↓
套版 step → 输出到 04-上架工作区/{batch}/{sku}/
  ↓
标题 step → 写入 04-上架工作区/{batch}/标题.xlsx
```

上架 step 仍由上架模块独立执行。v1.5 的通用编排模板可以把上架接到标题后面。

`Task.sku_code` 在第一个有 SKU 概念的 step 之后设置；采集图池和商品页分组只提供产品图来源，不直接生成 sku。

## 7. 任务查看 UI（任务中心）

```
┌─ 任务中心 ──────────────────────────────────────────┐
│ Tab: [运行中] [已完成] [失败] [全部]                 │
│                                                     │
│ [运行中] 3 个任务，1 个等待中                        │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ▶ 提取（comfyui）│ 8 张图 │ 5/8 │ ⏸️ 暂停 ❌ 取消 │ │
│ │   预计剩余 3 分钟                                │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ ⏳ 上架 Temu │ 30 个货号 │ 0/30 │ 等待资源         │ │
│ │   原因：profile-002 被采集占用                    │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ ▶ 套版 │ 模板2_黑T │ 12/30 │ ⏸️ 暂停 ❌ 取消        │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## 8. 数据库 schema

```sql
-- v1 完整任务最初版运行记录
CREATE TABLE pipeline_runs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  source_mode   TEXT NOT NULL,
  status        TEXT NOT NULL,                       -- "running" | "completed" | "failed" | "cancelled"
  config_json   TEXT NOT NULL,
  stats_json    TEXT NOT NULL,
  error_summary TEXT,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  completed_at  INTEGER
);

CREATE TABLE pipeline_steps (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  step_key      TEXT NOT NULL,                       -- "source" | "extract" | "matting" | "detection" | "photoshop" | "title"
  module        TEXT NOT NULL,
  label         TEXT NOT NULL,
  status        TEXT NOT NULL,                       -- "pending" | "running" | "completed" | "failed" | "skipped"
  input_count   INTEGER NOT NULL DEFAULT 0,
  output_count  INTEGER NOT NULL DEFAULT 0,
  output_json   TEXT,
  error_json    TEXT,
  started_at    INTEGER,
  completed_at  INTEGER,
  updated_at    INTEGER NOT NULL,
  UNIQUE(run_id, step_key)
);

-- v1.5 通用任务模型
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('lightweight', 'full')),
  module          TEXT NOT NULL,
  template_id     TEXT,                              -- 仅 full 任务
  sku_code        TEXT,
  status          TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'interrupted', 'cancelled')),
  priority        INTEGER NOT NULL DEFAULT 1,
  config_json     TEXT NOT NULL,
  failure_policy  TEXT,                              -- 仅 full
  execution_mode  TEXT,                              -- 仅 full
  error_summary   TEXT,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  paused_at       INTEGER,
  completed_at    INTEGER
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_sku ON tasks(sku_code) WHERE sku_code IS NOT NULL;

CREATE TABLE workflow_steps (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  module          TEXT NOT NULL,
  step_order      INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt         INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 1,
  error_json      TEXT,
  started_at      INTEGER,
  completed_at    INTEGER,
  UNIQUE(task_id, step_order)
);

CREATE INDEX idx_steps_task ON workflow_steps(task_id);
```

## 9. IPC 接口

```ts
// 渲染进程 → 主进程
'task:list'              → { status?: TaskStatus[] }
'task:get'               → { id: string }
'task:pause'             → { id: string }
'task:resume'            → { id: string }
'task:cancel'            → { id: string }
'task:retry-failed-step' → { task_id: string }

// 主进程 → 渲染进程（事件）
'task:progress'          → { task_id, step_order, progress: 0-100 }
'task:status-changed'    → { task_id, status, error? }
'task:queue-changed'     → { queue: QueuedTaskSummary[] }
```

## 10. 测试要点

- 资源锁的并发竞争（多任务抢同一 profile）
- 中断恢复（杀进程后启动）
- 队列优先级（user > orchestrator > retry）
- 同 SKU 拒绝并发
- maxConcurrency 限制生效
