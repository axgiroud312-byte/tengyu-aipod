# Spec 01 — 任务货号编排

> 本文规定**任务/货号两层模型**和**编排引擎**的完整设计。
> v1 只实现轻量任务追踪和资源互斥；编排引擎和流程模板留 v1.5。

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
| **full** | 编排引擎按模板创建（v1.5）| 多步 | 必须有 | 是 |

## 2. v1 任务管理（无编排引擎）

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
  priority: 1 | 2 | 3                  // 1=user, 2=orchestrator(v1.5), 3=retry
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

## 5. 暂停与恢复

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

## 6. 编排引擎（v1.5）

### 6.1 流程模板

v1.5 内置 6 个模板，每个模板是一组有序的步骤定义：

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
    { module: 'listing', required: true, ... },
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
完整链路示例（采集图不是 sku，sku 在套版/上架前产生）：

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
套版 step → 输出到 04-上架工作区/{batch}/{sku}/
  ↓
标题 step → 写入 04-上架工作区/{batch}/标题.xlsx
  ↓
上架 step → listing_status 表记录
```

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
