# Spec 09 — 横切问题

> 跨平台、并发、暂停恢复、日志、错误上报、自动更新、首次引导、打包发布。

## 1. 跨平台支持

### 1.1 平台矩阵

| 模块 | Windows | macOS |
|---|---|---|
| 采集 | ✅ | ✅ |
| 生图（晨羽/Grsai/百炼）| ✅ | ✅ |
| 侵权检测 | ✅ | ✅ |
| 标题生成 | ✅ | ✅ |
| **PS 套版** | ✅ | ❌（UI 灰显+提示）|
| 上架 | ✅ | ✅ |
| 编排引擎（v1.5）| ✅ | ✅ |

### 1.2 macOS 上的 PS 套版处理

```tsx
// modules/photoshop/ui/PhotoshopModulePanel.tsx
function PhotoshopModulePanel() {
  if (process.platform === 'darwin') {
    return (
      <Card>
        <CardHeader>PS 套版（仅 Windows 可用）</CardHeader>
        <CardContent>
          <p>您在 Mac 上，此模块需要 Photoshop COM 接口（仅 Windows 提供）。</p>
          <p>其他模块（生图 / 检测 / 标题 / 上架）正常可用。</p>
          <p>如需 Mac 套版能力，请关注 v1.5（暂未排期）。</p>
        </CardContent>
      </Card>
    )
  }
  return <PhotoshopActualUi />
}
```

### 1.3 平台特定代码组织

```
adapters/
├─ photoshop.ts                ← 主接口，跨平台
├─ photoshop.win.ts            ← Windows 实现（COM + JSX）
└─ photoshop.mac.ts            ← Mac 实现（空，throw UnsupportedError）
```

```ts
// adapters/photoshop.ts
export const photoshopAdapter = process.platform === 'win32'
  ? createWindowsPhotoshopAdapter()
  : createUnsupportedAdapter('PS 套版仅 Windows 可用')
```

## 2. 并发与队列

### 2.1 全局并发上限

```ts
// 用户在设置面板可调
const DEFAULT_MAX_CONCURRENCY = 3
const MAX_CONCURRENCY_RANGE = { min: 1, max: 10 }

class TaskQueueManager {
  private maxConcurrency: number
  private active: Set<TaskId> = new Set()
  private waiting: Task[] = []  // priority queue
  
  setMaxConcurrency(n: number) {
    this.maxConcurrency = clamp(n, 1, 10)
    this.scheduleNext()
  }
  
  async enqueue(task: Task): Promise<TaskResult> {
    if (this.active.size < this.maxConcurrency && canAcquireLocks(task)) {
      return this.run(task)
    }
    return this.wait(task)
  }
}
```

### 2.2 资源锁矩阵

| 资源 | 互斥规则 |
|---|---|
| `browser_profile:<id>` | 同 profile 单模块占用（采集 OR 上架）|
| `photoshop:singleton` | PS 全局串行 |
| `sku:<code>` | 同 SKU 单进行中任务 |
| `global_concurrency` | 总数 ≤ maxConcurrency |

获取所有锁失败任意一个 → 任务进入等待队列，资源释放时重新尝试。

### 2.3 优先级

```ts
type Priority = 1 | 2 | 3

const PRIORITY = {
  user_initiated: 1,           // 用户在 UI 上手动触发
  orchestrator: 2,             // 编排引擎自动跑（v1.5）
  retry: 3,                    // 自动重试
} as const
```

队列按优先级升序取（1 最优先）。

## 3. 暂停与恢复

### 3.1 用户手动暂停

```
用户点 [暂停] → TaskQueueManager.pause(taskId)
  ↓
等当前 running step 完成（不强制中断）
  ↓
Task.status = 'paused'
释放该 task 持有的资源锁
UI 切换为"已暂停"，[继续]按钮可点

用户点 [继续] → 任务重新 enqueue（保持原 priority）
```

### 3.2 软件关闭恢复

```ts
// 主进程退出钩子
app.on('before-quit', async () => {
  // 把所有 running 任务标记为 interrupted
  await prisma.tasks.updateMany({
    where: { status: 'running' },
    data: { status: 'interrupted' },
  })
  // 释放所有锁
  await releaseAllLocks()
})

// 启动时
app.on('ready', async () => {
  const interrupted = await prisma.tasks.findMany({ where: { status: 'interrupted' } })
  if (interrupted.length > 0) {
    showRecoveryDialog(interrupted)
  }
})
```

UI 弹窗：

```
┌─ 上次未完成的任务 ─────────────────────────────────┐
│ 检测到 3 个未完成任务：                            │
│  - 套版任务 (15/30 完成) - mockup_v1.psd          │
│  - 上架任务 (8/20 完成) - 模板1_白T正面            │
│  - 标题任务 (5/15 完成) - 模板1_白T正面            │
│                                                  │
│ ☑ 全选                                            │
│ ☑ 套版任务                                        │
│ ☑ 上架任务                                        │
│ ☑ 标题任务                                        │
│                                                  │
│ [恢复所选] [放弃所选] [稍后决定]                   │
└──────────────────────────────────────────────────┘
```

### 3.3 按模块恢复粒度

| 模块 | 粒度 | 恢复逻辑 |
|---|---|---|
| 采集 | 会话级 | 不能恢复，提示重启会话 |
| 生图 | 单图级 | 查 artifacts 表已完成的图，剩余的重新跑 |
| 检测 | 单图级 | 查 detection_results 已完成的，剩余的跑 |
| 套版 | 任务组级 | 已完成的组跳过，未完成的组从头跑 |
| 标题 | 单货号级 | 查 titles.xlsx 已有的跳过 |
| 上架 | 单 listing 级 | 查 listing_status='success' 跳过 |

## 4. 失败传播（串联模板，v1.5）

```ts
type FailurePolicy = 'halt' | 'skip' | 'pause'

interface FullTaskConfig {
  template_id: string
  execution_mode: 'auto' | 'step_by_step'
  failure_policy: FailurePolicy
}
```

策略行为：

| 策略 | 行为 |
|---|---|
| `halt`（默认）| 任一步失败 → 终止整个任务（标记 failed）|
| `skip` | 任一步失败 → 跳过该步 → 继续后续 step |
| `pause` | 任一步失败 → 暂停任务等用户决定 |

v1 没有编排引擎，不涉及。每个模块独立运行只有"成功/失败"两态。

## 5. 日志系统

### 5.1 日志位置

```
.workbench/logs/
├─ main.log                    ← 主进程日志（pino）
├─ renderer.log                ← 渲染进程日志
├─ {module}-{taskId}.log        ← 单个任务日志
├─ crash/
│   └─ crash-{timestamp}.json
└─ telemetry-queue.jsonl       ← 待上报错误队列
```

### 5.2 日志格式

pino JSON 一行一条：

```json
{"time":1716480000000,"level":30,"msg":"task started","module":"generation","task_id":"abc","sku":"SKU001"}
{"time":1716480001000,"level":40,"msg":"retry","module":"generation","task_id":"abc","attempt":1,"reason":"network_timeout"}
```

level：10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal

### 5.3 日志保留

- 自动清理 30 天前的 `.log` 文件
- 用户在设置可改保留时长（7 / 30 / 90 天）
- 用户可手动清理

### 5.4 用户操作

```
设置 → 日志：
  当前占用：256 MB
  保留时长：[30 天 ▼]
  
  [立即清理] [导出最近 N 天 (zip)]
  [打开日志目录]
```

### 5.5 崩溃日志

```ts
// 主进程
process.on('uncaughtException', async (err) => {
  await fs.writeFile(
    `.workbench/logs/crash/crash-${Date.now()}.json`,
    JSON.stringify({
      time: Date.now(),
      message: err.message,
      stack: err.stack,
      version: app.getVersion(),
      platform: process.platform,
    })
  )
  app.exit(1)
})
```

下次启动时检测崩溃日志，弹窗：

```
┌─ 上次崩溃 ─────────────────────────────────────┐
│ 检测到上次软件意外退出。                        │
│ 错误：JSX_EXEC_FAILED                          │
│                                                │
│ 帮助我们改进吗？发送崩溃报告（不含您的数据）。  │
│ [发送报告] [跳过] [详细信息]                    │
└───────────────────────────────────────────────┘
```

## 6. 错误上报（遥测）

### 6.1 上报策略

```ts
// 主进程拦截所有 AppError
class ErrorReporter {
  private queue: TelemetryError[] = []
  
  async report(error: AppError, context: ErrorContext) {
    if (!userSettings.telemetryEnabled) return
    
    const sanitized = {
      client_version: app.getVersion(),
      platform: process.platform,
      module: context.module,
      error_code: error.code,
      error_message: error.message,
      stack_trace: error.stack,
      device_fingerprint: getDeviceFingerprint(),
      occurred_at: Date.now(),
      // 不包含：用户数据、图片路径、Skill 内容、API Key、Customer 信息
    }
    
    this.queue.push(sanitized)
    this.flush()
  }
  
  private async flush() {
    if (this.queue.length === 0) return
    if (!isOnline()) {
      // 离线时落磁盘
      await appendToFile('.workbench/logs/telemetry-queue.jsonl', this.queue)
      this.queue = []
      return
    }
    
    try {
      await fetch('https://api.tengyu-aipod.com/api/telemetry/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(this.queue),
      })
      this.queue = []
    } catch {
      // 失败保留在队列
    }
  }
}
```

### 6.2 用户控制

```
设置 → 隐私：
  ☑ 自动上报错误日志（帮助改进）
  
  我们收集：错误类型、堆栈、模块名、版本
  我们不收集：您的图片、激活码、API Key、提示词、生成内容
  
  您随时可关闭。
```

首次启动后第一次错误时弹窗征求同意（不是无声开启）。

### 6.3 服务端聚合

admin 后台展示按 `error_code` + `module` + 时间窗聚合的错误数，帮你定位高频问题。

## 7. 自动更新

### 7.1 v1 半自动

```ts
// 启动时
async function checkForUpdates() {
  const res = await api.checkClientVersion({
    current: app.getVersion(),
    channel: 'stable',
    platform: process.platform === 'win32' ? 'win' : 'mac',
  })
  
  if (!res.current_is_latest && res.latest) {
    showUpdateDialog(res.latest)
  }
}

function showUpdateDialog(latest: ClientVersion) {
  const isForce = latest.force_upgrade
  
  showDialog({
    title: isForce ? '必须更新' : '有新版本',
    content: `
      当前版本：${app.getVersion()}
      最新版本：${latest.version}
      
      更新内容：
      ${latest.changelog}
    `,
    actions: isForce
      ? [{ label: '立即更新', handler: () => openExternalUrl(latest.download_url) }]
      : [
          { label: '立即更新', handler: () => openExternalUrl(latest.download_url) },
          { label: '稍后', handler: () => {} },
        ],
    blocking: isForce,  // 强制升级时阻断使用
  })
}
```

### 7.2 v1.5 全自动（electron-updater）

```ts
import { autoUpdater } from 'electron-updater'

autoUpdater.checkForUpdatesAndNotify()
autoUpdater.on('update-downloaded', () => {
  showDialog({
    title: '已下载更新',
    content: '重启即可应用更新',
    actions: [
      { label: '立即重启', handler: () => autoUpdater.quitAndInstall() },
      { label: '稍后', handler: () => {} },
    ],
  })
})
```

配置 electron-builder publish 用 GitHub Releases 或自托管。

## 8. 首次启动引导

```tsx
// renderer/pages/Onboarding.tsx
function Onboarding() {
  const [step, setStep] = useState(1)
  
  return (
    <OnboardingLayout step={step} totalSteps={4}>
      {step === 1 && <ActivationStep onNext={() => setStep(2)} />}
      {step === 2 && <WorkbenchRootStep onNext={() => setStep(3)} />}
      {step === 3 && <ApiKeysStep onNext={() => setStep(4)} onSkip={() => setStep(4)} />}
      {step === 4 && <CompletionStep />}
    </OnboardingLayout>
  )
}
```

### 8.1 Step 1：激活

```
┌─ 欢迎使用腾域 aipod ──────────────────────────┐
│ Step 1/4 — 激活                              │
│                                              │
│ 请输入激活码：                                │
│ [____-____-____-____]                        │
│                                              │
│ 给本机起个名字（方便后台管理）：              │
│ [我的工作电脑]                                │
│                                              │
│ [激活]                                        │
│                                              │
│ 没有激活码？                                  │
│ [联系客服微信：xxx]  [试用申请]                │
└─────────────────────────────────────────────┘
```

### 8.2 Step 2：素材总目录

```
Step 2/4 — 素材总目录

请选择本机用于存储素材的根目录：
  [浏览...]  /Users/.../腾域aipod素材/

软件会在此目录下创建：
  - 01-采集/
  - 02-生图/
  - 03-检测/
  - 04-待套版印花/
  - 05-货号成品/

建议选择空目录或新建文件夹。
  [上一步]  [下一步]
```

### 8.3 Step 3：API Keys

```
Step 3/4 — API Keys（可全跳过，后续模块面板补填）

晨羽智云 API Key（用于 ComfyUI 生图）：
  [______]  [跳过]  [说明: 在 chenyu.cn 控制台创建]

Grsai API Key（用于付费生图）：
  [______]  [跳过]  [说明: 在 grsai.ai 控制台创建]

阿里云百炼 API Key（用于检测和标题）：
  [______]  [跳过]  [说明: 在 bailian.console.aliyun.com 创建]

比特浏览器（默认本地）：
  地址：[127.0.0.1:54345]
  [测试连接]

  [上一步]  [全部跳过]  [下一步]
```

### 8.4 Step 4：完成

```
Step 4/4 — 完成

✓ 软件已准备就绪

下一步推荐：
  [📺 观看 3 分钟入门视频]
  [📖 阅读快速上手指南]
  [💬 加入用户群（微信）]

  [开始使用]
```

## 9. 国际化

### 9.1 v1：中文 only（但留好 i18n 钩子）

- v1 不引入 i18next 等框架（节省复杂度，v1.5 再做）
- 但所有渲染进程 UI 字符串**必须**通过临时函数 `t()` 包裹，避免 v1.5 全量改造：

  ```ts
  // packages/client/src/renderer/src/locale/t.ts
  // v1: 直接返回中文字面量；v1.5: 替换为 i18next 的 useTranslation
  export const t = (s: string) => s;
  ```

  ```tsx
  import { t } from '@/locale/t';
  <Button>{t('开始采集')}</Button>
  ```

- 文案规则：
  - 入参直接是中文字面量，**不**抽 key（v1.5 再用 i18next-parser 自动扫提取）
  - 仅渲染进程（`.tsx` / 渲染进程 `.ts`）里写给用户看的字符串才包 `t()`
  - 主进程错误消息、CLI 输出、日志、注释**不**包 `t()`（用户不直接看）
  - 不在 `t()` 里做字符串拼接，模板化用 `t('已采集 {n} 张').replace('{n}', n)`，v1.5 切到 i18next 插值语法

### 9.2 v1.5：i18n

```
v1.5 计划：
  - 引入 i18next
  - 字符串提取到 locale/{zh,en}.json
  - UI 加语言切换器
  - 默认按 OS locale 自动检测
```

## 10. 打包发布

### 10.1 electron-builder 配置

```json
// packages/client/electron-builder.json
{
  "appId": "com.tengyu.aipod",
  "productName": "腾域 aipod",
  "directories": {
    "output": "release/${version}"
  },
  "files": ["dist/**/*", "package.json"],
  "mac": {
    "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }],
    "icon": "resources/icon.icns",
    "category": "public.app-category.productivity"
  },
  "win": {
    "target": [{ "target": "nsis", "arch": ["x64"] }],
    "icon": "resources/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  }
}
```

### 10.2 v1 不签名

```
Windows .exe：
  用户首次启动 → Windows SmartScreen 弹"未识别的发布者"
  用户点"更多信息" → "仍要运行"
  之后不再弹

macOS .dmg：
  用户首次启动 → "无法验证开发者"
  用户右键 → 打开 → "仍要打开"
  之后不再弹
```

UI 上提供"启动遇到警告？查看帮助"链接，引导用户跳过。

### 10.3 v1.5 签名

```
Windows Authenticode：
  购买 Sectigo / DigiCert 代码签名证书（¥800-2000/年）
  electron-builder 配置 certificateFile + certificatePassword

macOS：
  Apple Developer Program ¥99/年
  公证：electron-builder 配置 notarize.appleId
```

### 10.4 分发渠道

- v1：你的官网下载页（GitHub Releases 备用）
- v1.5：可考虑 Microsoft Store、Mac App Store（需付费 + 审核）

## 11. 性能基线

### 11.1 客户端启动

| 阶段 | 预算 |
|---|---|
| 主进程启动 → 加载完成 | < 2 秒 |
| 渲染进程加载 | < 2 秒 |
| 首次启动（含 onboarding 检查）| < 5 秒 |
| 后续启动（已激活）| < 4 秒 |
| 客户端拉云端资源（在线）| < 3 秒 |

### 11.2 内存

| 场景 | 预算 |
|---|---|
| 空闲 | < 400 MB |
| 单任务运行 | < 700 MB |
| 5 个并发任务 | < 1.5 GB |
| 图像预处理（Worker Thread 100 张 1K）| < 200 MB 额外 |

## 12. 客户端配置项总览

设置面板：

```
[设置]

├─ 账号与激活
│   - 激活状态：✅ 激活 · 剩余 222 天
│   - 设备名：我的工作电脑
│   - 同码绑定设备：3/3
│   - [解绑本机]
│   - [输入新激活码]
│
├─ 素材总目录
│   - /Users/.../素材总目录/
│   - [更改]
│
├─ API Keys
│   - 晨羽智云：●已设置 [更改]
│   - Grsai：●已设置 [更改]
│   - 阿里云百炼：●已设置 [更改]
│   - 比特浏览器地址：[127.0.0.1:54345]
│
├─ 性能
│   - 全局并发：[3] (1-10)
│   - 预处理并发：自动 / [手动: 4]
│
├─ 隐私
│   - ☑ 自动上报错误日志
│
├─ 日志
│   - 占用：256 MB
│   - 保留：[30 天 ▼]
│   - [立即清理] [导出]
│
├─ 自动更新
│   - 当前版本 v1.3.0
│   - 通道：[stable ▼]
│   - ☑ 启动时检查更新
│   - [立即检查]
│
└─ 关于
    - 客户端版本 v1.3.0
    - 服务器：● 已连接
    - [查看日志] [反馈]
```

## 13. 用户体验细节

### 13.1 客户端右上角状态徽章

```
🟢 激活·剩余 222 天
🟡 即将过期·7 天内
🔴 已过期
🔴 已封号
🟢 试用·3 天剩余
```

点徽章 → 弹出当前激活信息卡片。

### 13.2 通知系统

OS 原生通知用于：

- 任务完成（"套版完成 30/30 ✅"）
- 任务失败（"上架失败 5/30，点查看"）
- 版本更新（"新版本 v1.3.0 已发布"）
- 设备过期警告（"距离到期 3 天，请联系客服续费"）

用户在设置可关闭。

## 14. 测试

- 跨平台启动（Windows + Mac）
- 软件中断恢复
- 资源锁竞争
- 全局并发上限
- 日志自动清理
- 崩溃日志生成
- 错误上报队列在离线时落磁盘
- 首次启动引导各 Step 跳过/继续
- 自动更新检查
