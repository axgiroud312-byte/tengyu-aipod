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

### 1.4 Native 兼容矩阵

| 模块 | 类型 | 兼容性来源 | 当前状态 |
|---|---|---|---|
| `node:sqlite` | Electron 内置 | 与 Electron 内置 Node 同生命周期 | ✅ |
| `sharp` | 外部 native | 官方 prebuild（覆盖 Electron 主流版本） | ✅ |
| （未来新增） | 待定 | 必须先论证不能用 Electron 内置或 WASM 方案 | 待 ADR |

**红线**：新增 native 依赖前，必须先在 ADR 论证为什么不能使用 Electron 内置能力
或 WASM 方案，并同步更新本兼容矩阵。

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
| 采集 | 会话级 / 图池级 | 会话采集需重新启动；图池结果保存在前端内存，重启后重新扫描 |
| 生图 | 单图级 | 查 artifacts 表已完成的图，剩余的重新跑 |
| 检测 | 单图级 | 查 detection_results 已完成的，剩余的跑 |
| 套版 | 任务组级 | 已完成的组跳过，未完成的组从头跑 |
| 标题 | 单货号级 | 查标题 xlsx 已有的跳过 |
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
├─ diagnostics/                 ← LLM / provider 调用排障 JSONL
│   ├─ generation/{taskIdOrRunId}.jsonl
│   ├─ detection/{taskId}.jsonl
│   └─ title/{taskId}.jsonl
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

### 5.4 模块运行期日志

采集和生图模块另有一类不落盘的运行期日志：

- 展示位置：对应模块页“日志”弹窗。
- 数据来源：采集为 `collection:event` / `debug-log`；生图为 `generation:debug-log`。
- 保留策略：前端内存最多最近 `1000` 条，应用重启后清空。
- 采集使用场景：当场判断图池扫描进度、逐张下载耗时、下载失败原因、点击采集脚本诊断。
- 生图使用场景：当场判断提示词生成、任务提交、模型调用进度、完成/失败和保存路径。
- 安全边界：不记录 API Key 或 base64 图片内容；弹窗内只展示短预览。

这类日志不是审计日志，也不落盘。

### 5.5 诊断日志

生图、侵权检测、标题生成共用落盘诊断日志，默认开启：

```
.workbench/logs/diagnostics/
├─ generation/{taskIdOrRunId}.jsonl
├─ detection/{taskId}.jsonl
└─ title/{taskId}.jsonl
```

记录内容：
- 发送给 LLM / provider 的完整请求参数：system prompt、user prompt、变量、模型、输出选项、工作流参数。
- provider 原始返回：文本、usage、finish reason、URL、task id、prompt id、history / execution 等。
- 重试和轮询：attempt、pollCount、重试错误、最终状态。
- 解析与决策：parse result、parse failed、缓存跳过、已有标题跳过。
- 错误：只保存结构化 code / message / retryable / status / details / stack preview。

安全边界：
- 不记录 API Key、authorization、token、secret、password。
- 不记录 base64、data URL、Buffer 图片原文；只记录 path/name（如可用）、mime、bytes、sha256、dataUrl length、预处理参数。
- 预处理图片仍走 `.workbench/tmp/`，任务完成后按 TempFileManager 清理，不因诊断日志额外保存图片。

保留策略：
- 默认保留 7 天。
- 总量上限 1GB，超过后按最旧文件优先删除。
- 启动时清理一次，此后每 24 小时清理一次。

### 5.6 用户操作

```
设置 → 日志：
  当前占用：256 MB
  保留时长：[30 天 ▼]
  
  [立即清理] [删除所有日志] [导出最近 N 天 (zip)]
  [打开日志目录]
```

`删除所有日志` 清空当前工作区 `.workbench/logs/` 并重建空目录，只删除运行日志、诊断日志、崩溃日志和待上报日志；不删除 4 个业务工作区、`.workbench/tmp/`、SQLite 数据库、缓存、API Key。

### 5.7 崩溃日志

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
      client_id: userSettings.telemetryClientId,
      occurred_at: Date.now(),
      // 不包含：用户数据、图片路径、Skill 内容、API Key、客户信息
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
        headers: { 'Content-Type': 'application/json' },
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
  
  我们收集：错误类型、堆栈、模块名、版本、匿名客户端 ID
  我们不收集：您的图片、API Key、提示词、生成内容、客户信息
  
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

## 8. 客户登录与首次启动

开发环境后端地址规则：

- 未显式配置 `TENGYU_SERVER_URL` 时，客户端开发态默认连接 `https://wechat.tengyuai.com`
- 打包环境默认也连接 `https://wechat.tengyuai.com`，仍允许用 `TENGYU_SERVER_URL` 覆盖
- 如需改到其他 PHP 登录环境，可额外配置 `TENGYU_PHP_AUTH_BASE_URL`
- 当前真实后端域名是 `https://wechat.tengyuai.com`，开发态默认值固定使用这个域名而不是裸 IP

### 8.1 启动门禁

客户端启动顺序：

1. App 启动。
2. 主进程读取本地客户登录态 `uid + secret`。
3. 没有登录态时显示客户登录页。
4. 有登录态时调用 Next `POST /api/customer-auth/verify`。
5. Next 内部调用旧 PHP `/user/user/info` 校验 `uid + secret + finger`。
6. `pending / disabled / expired` 显示不可用提示。
7. `active` 且未到期后，进入首次设置引导或 Workbench。

Skill 同步必须在客户授权通过后启动。

运行中每 5 分钟复查一次授权状态。发现 PHP 返回 `nologin: 1` 或 Next 返回授权失效后，客户端清空本地登录态并回登录页。

### 8.2 客户登录 IPC

渲染进程只通过 IPC 调用主进程，不能直接拿 PHP `secret`。

```text
customerAuth:getState
customerAuth:getQrcode
customerAuth:startWechatLogin
customerAuth:checkWechatLogin
customerAuth:sendSms
customerAuth:getSmsCountdown
customerAuth:loginByPhone
customerAuth:verify
customerAuth:logout
```

### 8.3 微信扫码登录

流程：

1. 客户端主进程请求旧 PHP `GET /api/wxlogin/get_qrcode`。
2. 旧 PHP 返回微信官方 `qrcode_url + token`，客户端不在本地生成二维码图片。
3. 渲染进程调用 `customerAuth:startWechatLogin`，由主进程在默认浏览器打开微信官方登录页，当前窗口继续等待结果。
4. 每 1.5 秒通过主进程轮询旧 PHP `/api/wxlogin/check_login`，请求里携带 `token + finger`；开始轮询后会立即先检查一次。
5. 成功后主进程保存 `uid + secret`。
6. 主进程调用 Next `/api/customer-auth/verify`。
7. 授权通过后进入首次设置或 Workbench。

二维码过期或登录失败时，结束轮询并提示用户重试。

### 8.4 手机号验证码登录

流程：

1. 输入手机号。
2. 主进程调用旧 PHP `/user/public/send_login_sms`。
3. 主进程在本地启动 60 秒倒计时，防止重复发送。
4. 输入验证码。
5. 主进程调用旧 PHP `/user/public/login`，传 `method=phone`、`finger` 和可选 `invite`。
6. 成功后主进程保存 `uid + secret`。
7. 主进程调用 Next `/api/customer-auth/verify`。
8. 授权通过后进入首次设置或 Workbench。

### 8.5 设备指纹

旧 PHP 接口需要 `finger`。v1 使用最小硬件信息哈希：

- `hostname`
- `platform`
- `arch`
- Electron `userData` 路径

不采集网卡 MAC。生成后本地持久化，保证同一机器稳定。

### 8.6 首次设置引导

客户授权通过后，如果本机还没有完成首次设置，展示 onboarding。

```tsx
// renderer/pages/Onboarding.tsx
function Onboarding() {
  const [step, setStep] = useState(1)
  
  return (
    <OnboardingLayout step={step} totalSteps={3}>
      {step === 1 && <WorkbenchRootStep onNext={() => setStep(2)} />}
      {step === 2 && <ApiKeysStep onNext={() => setStep(3)} onSkip={() => setStep(3)} />}
      {step === 3 && <CompletionStep />}
    </OnboardingLayout>
  )
}
```

### 8.7 Step 1：工作区选择

```
┌─ 欢迎使用腾域 aipod ──────────────────────────┐
│ Step 1/3 — 选择工作区                        │
│                                              │
│ 请选择本机用于保存业务文件的工作区。          │
│                                              │
│ [选择工作区]                                  │
└─────────────────────────────────────────────┘
```

### 8.8 工作区选择（设置页）

```
设置页 — 工作区

请选择本机用于存储业务文件的工作区：
  [选择...]  /Users/.../腾域aipod工作区/

软件会在此目录下创建：
  - 01-采集工作区/
  - 02-印花工作区/
    - 文生图/
    - 图生图/
    - 提取/
    - 抠图/
  - 03-检测工作区/
  - 04-上架工作区/
  - .workbench/

建议选择空目录或新建文件夹。
  [保存工作区]
```

未选择工作区时，业务模块入口显示“请先选择工作区”并引导到设置页；设置页本身不被拦截。

### 8.9 Step 2：API Keys

```
Step 2/3 — API Keys（可全跳过，后续模块面板补填）

晨羽智云 API Key（用于 ComfyUI 生图）：
  [______]  [跳过]  [说明: 在 chenyu.cn 控制台创建]

Grsai API Key（用于付费生图）：
  [______]  [跳过]  [说明: 在 grsai.ai 控制台创建]

阿里云百炼 API Key（用于生图提示词、检测和标题）：
  [______]  [跳过]  [说明: 在 bailian.console.aliyun.com 创建]

比特浏览器（默认本地）：
  地址：[127.0.0.1:54345]
  [测试连接]

  [上一步]  [全部跳过]  [下一步]
```

### 8.10 Step 3：完成

```
Step 3/3 — 完成

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
| 后续启动（已完成首次设置）| < 4 秒 |
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

├─ 工作区
│   - /Users/.../腾域aipod工作区/
│   - [更改]
│
├─ 客户账号
│   - 昵称：TEST
│   - 授权状态：已授权
│   - 到期日：2026-12-31
│   - [退出登录]
│
├─ API Keys
│   - 晨羽智云：●已设置 [更改]
│   - Grsai：●已设置 [更改]
│   - 阿里云百炼：●已设置 [更改]
│   - 比特浏览器地址：[127.0.0.1:54345]
│
├─ 晨羽智云设置
│   - 连接信息：API Key + 连接状态（不展示余额）
│   - 创建云机：默认收起，固定杭州慎思 POD，只选版本和 GPU
│   - 实例管理：列出当前 API Key 下全部实例，支持开机、关机、设为默认云机
│   - 高级设置：POD 自动发现、手动 POD UUID / 版本列表、重启、销毁
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

### 13.1 客户端右上角状态

```
🟢 服务器已连接
🟢 客户账号已授权
🟡 使用本地 Skill 缓存
🔴 外部服务连接失败
```

状态入口展示服务连接、客户账号授权、Skill 缓存和外部服务配置。授权状态失效时，主界面退出到客户登录页。

### 13.2 通知系统

OS 原生通知用于：

- 任务完成（"套版完成 30/30 ✅"）
- 任务失败（"上架失败 5/30，点查看"）
- 版本更新（"新版本 v1.3.0 已发布"）

用户在设置可关闭。

## 14. 测试

- 跨平台启动（Windows + Mac）
- 软件中断恢复
- 资源锁竞争
- 全局并发上限
- 日志自动清理
- 崩溃日志生成
- 错误上报队列在离线时落磁盘
- 客户登录、pending/disabled/expired 门禁、运行中 5 分钟复查
- 首次启动引导各 Step 跳过/继续
- 自动更新检查
