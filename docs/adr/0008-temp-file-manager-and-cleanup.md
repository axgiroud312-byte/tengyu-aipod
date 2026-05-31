# ADR-0008 — 全局 TempFileManager 管理临时文件，业务工作区只放最终产物

**状态**：已采纳
**日期**：2026-05-23

## 背景

腾域多个模块都会产生中间产物：

- **侵权检测**：图像预处理后的临时图（加白底 + 压缩）
- **PS 套版**：动态生成的 JSX 脚本、JSX 执行结果 JSON
- **抠图混合路径**：付费模型生成的黑白遮罩中间产物
- **生图**：LLM 生成的提示词数组（待用户审稿）
- **上架**：每个 stage 的页面截图、DOM 快照（证据）

如果这些临时产物混入用户的业务工作区（`01-采集工作区` 到 `04-上架工作区`），会：

- 污染目录结构，用户用资源管理器看时混乱
- 占磁盘空间（错误的累积）
- 难以与"成果"区分

## 决策

### 1. 全局 TempFileManager（单例）

```ts
// adapters/temp-file-manager.ts
class TempFileManager {
  private rootDir = '.workbench/tmp'
  
  async createTaskDir(module: string, taskId: string): Promise<string>
  async getTaskDir(module: string, taskId: string): string
  async cleanupTask(module: string, taskId: string): Promise<void>
  async cleanupOrphans(): Promise<void>  // 启动时调用
}
```

### 2. 目录结构

```
.workbench/tmp/
├─ detection/{taskId}/
│   └─ {imageHash}_preprocessed.jpg
├─ photoshop/{taskId}/
│   ├─ job-N.jsx
│   └─ job-N-result.json
├─ matting/{taskId}/
│   └─ mask_pri_001.png
├─ generation/{taskId}/
│   └─ prompt-snapshot.json
└─ listing/{taskId}/
    └─ evidence/
        ├─ screenshots/
        └─ dom-snapshots/
```

每个任务一个独立子目录。

### 3. 生命周期

```
任务启动 → TempFileManager.createTaskDir 创建 {taskId}/
  ↓
模块写文件 → 落到 {taskId}/
  ↓
模块用完单文件 → 立即删除（节省空间）
模块用完单文件 + 失败 → 保留 1 小时（重试可复用）
  ↓
任务整体完成/取消 → TempFileManager.cleanupTask(module, taskId) → 删整个 {taskId}/
  ↓
软件启动时 → TempFileManager.cleanupOrphans() → 删 .workbench/tmp/ 下超 24 小时的孤儿目录
```

### 4. 业务工作区目录的"纯洁性"约束

```
{工作区}/
├─ 01-采集工作区/    ← 只放图片
├─ 02-印花工作区/    ← 只放图片
├─ 03-检测工作区/    ← 只放图片
├─ 04-上架工作区/    ← 只放图片 + titles.xlsx
└─ .workbench/       ← 黑盒，用户不动
    └─ tmp/         ← 临时文件
```

**强约束**：业务工作区目录里**绝对不放 .json、.jsx、.csv 等元数据/中间产物文件**。

只有 `04-上架工作区/{模板批次}/` 下允许 `titles.xlsx`（这是业务文件，给上架程序读）。

## 候选方案对比

| 方案 | 优势 | 劣势 |
|---|---|---|
| **临时文件全部隐藏在 .workbench/tmp/（采纳）** | 用户视图整洁；自动清理可控 | 多一层抽象，要严格执行约束 |
| 临时文件混在工作区 | 实现简单（不用 TempFileManager）| 用户视图脏乱；难以清理 |
| 临时文件存系统 temp（/tmp）| 不污染素材目录 | 跨设备/跨会话状态丢失（系统 temp 重启就清）|

## 关键设计：避免 24 小时孤儿堆积

软件如果崩溃 / 强杀，可能留下：
- 已开始的任务 `{taskId}/` 没被清理
- 文件大小占磁盘

启动时跑 `cleanupOrphans`：

```ts
async cleanupOrphans() {
  const now = Date.now()
  const allModuleDirs = await fs.readdir(this.rootDir)
  for (const moduleDir of allModuleDirs) {
    const taskDirs = await fs.readdir(path.join(this.rootDir, moduleDir))
    for (const taskDir of taskDirs) {
      const stat = await fs.stat(path.join(this.rootDir, moduleDir, taskDir))
      if (now - stat.mtimeMs > 24 * 3600 * 1000) {
        await fs.rm(path.join(this.rootDir, moduleDir, taskDir), { recursive: true, force: true })
      }
    }
  }
}
```

正常完成的任务会主动清理 → 不会成为孤儿。
崩溃后的任务最多留 24 小时 → 下次启动自动清。

## 失败保留 1 小时机制

如果任务失败，用户可能想点"重试"。临时文件保留 1 小时可以**省下重新预处理的时间**。

```ts
async cleanupTask(module: string, taskId: string, opts: { keepIfFailed?: boolean }) {
  if (opts.keepIfFailed) {
    // 标记为待清理，1 小时后真正删除
    await this.scheduleCleanup(module, taskId, 3600_000)
  } else {
    // 立即删
    await fs.rm(path.join(this.rootDir, module, taskId), { recursive: true })
  }
}
```

`scheduleCleanup` 用 `setTimeout` 即可（如果软件关闭，靠启动时的 `cleanupOrphans` 兜底）。

## 用户控制

设置面板提供：

```
[设置 → 存储管理]

临时文件占用：256 MB
  detection/: 50 MB
  photoshop/: 180 MB
  matting/: 26 MB

[立即清理]  [打开 tmp 目录]

自动清理策略：
☑ 任务完成后立即清理（推荐）
☑ 启动时清理超过 24 小时的旧文件
```

## 影响

### 正面

- 用户用资源管理器看素材目录**像看相册**（整洁）
- 磁盘占用可控（不会无声膨胀）
- 模块开发者**有清晰的接口**用临时文件（不会乱写）
- 调试时所有临时产物集中在一处

### 负面

- 多一层抽象（TempFileManager）
- 模块必须遵守约束（不能图省事直接写工作区根目录）

### 强制约束的措施

- Code review 中检查模块代码不直接写业务工作区目录的非业务文件
- 单元测试验证：模块跑完后业务工作区新增的非图片文件 = 0（`titles.xlsx` 除外）
- 文档（CONTEXT.md / spec/00-overview）明确"业务工作区目录只放业务图片"

## 替代决策的触发条件

如果发现 TempFileManager 的接口反复成为开发瓶颈（比如经常需要"跨任务复用临时文件"），可以考虑：
- 引入"全局临时区"（不按 taskId 隔离）
- 加缓存层（同 hash 输入复用临时输出）

但这是优化方向，v1 不做。
