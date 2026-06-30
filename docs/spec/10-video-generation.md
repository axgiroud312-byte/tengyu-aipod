# Spec 10 — 视频生成模块

> 独立视频生成页面。首版只接入阿里云百炼 HappyHorse 的图生视频和参考生视频，不接入视频编辑，不进入完整任务。

## 1. 模块边界

视频生成模块是独立业务模块，左侧导航入口为 `视频生成`，位置在 `上架` 后面。

首版只支持：

| 能力 | 输入 | 输出 | 备注 |
|---|---|---|---|
| 图生视频 | 1 张本地首帧图 + 可选提示词 | 1 个 MP4 | 输出比例跟随首帧图 |
| 参考生视频 | 1-9 张本地视频参考图 + 必填提示词 | 1 个 MP4 | 提示词用 `[Image 1]` 等编号指代图片 |

首版不支持：

- 文生视频。
- 视频编辑。
- 本地视频上传转公网 URL。
- OSS 临时素材仓库。
- 批量队列、任务历史、断点恢复。
- 云端取消任务。
- `WorkspaceId` 设置项。
- 接入完整任务。
- 把视频当印花、检测输入、PS 套版输入或上架输入。

## 2. 页面结构

页面采用左右布局，按 HappyHorse 文档的 `input` / `parameters` 分区。

```text
┌─ 视频生成 ─────────────────────────────────────────────────┐
│ 顶部：日志按钮                                             │
│                                                            │
│ ┌─ 左侧：输入 ───────────────┐ ┌─ 右侧：参数和运行 ───────┐ │
│ │ Tab: 图生视频 / 参考生视频 │ │ 模型版本                 │ │
│ │                            │ │ 清晰度                   │ │
│ │ 图生视频：                 │ │ 时长                     │ │
│ │ - 首帧图上传               │ │ 比例（仅参考生视频）      │ │
│ │ - 可选提示词               │ │ 水印                     │ │
│ │                            │ │ 任务名                   │ │
│ │ 参考生视频：               │ │ 费用/耗时提醒            │ │
│ │ - 1-9 张参考图             │ │ 开始生成 / 停止查询       │ │
│ │ - 必填提示词               │ │ 状态 / task_id / 保存路径 │ │
│ │ - 图片编号 [Image 1]       │ │ 本地视频预览             │ │
│ │ - 点编号或输入 @ 选图       │ │                          │ │
│ └────────────────────────────┘ └──────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### 2.1 图生视频

- 图片上传区只接受 1 张本地图片。
- 图片展示缩略图和文件名。
- 提示词可为空。
- 不显示比例选择。
- 提交时真实模型为 `happyhorse-{version}-i2v`。

### 2.2 参考生视频

- 图片上传区接受 1-9 张本地图片。
- 每张图显示固定编号：`[Image 1]`、`[Image 2]`...
- 支持删除单张图；删除后重新按顺序编号。
- 用户可点击编号按钮，把对应 `[Image N]` 直接插入提示词。
- 用户在提示词里输入 `@` 时，弹出当前参考图列表，可直接选择要插入的编号。
- 提示词必填。
- 显示比例选择。
- 提交时真实模型为 `happyhorse-{version}-r2v`。

### 2.3 运行区

开始按钮附近必须显示轻提示：

> 视频生成通常需要 1-5 分钟，可能产生百炼费用；停止查询不会取消云端任务。

失败后保留当前输入和参数，显示 `重新生成`。重新生成会提交新的 HappyHorse 任务。

生成完成后：

- 页面内使用本地保存后的 MP4 显示 `<video controls>` 预览。
- 显示保存路径。
- 提供 `打开目录` 按钮。
- 提供复制原始 `video_url` 按钮，用于排查或临时分享。
- 不自动打开 Finder / 资源管理器。

## 3. 参数

| 参数 | 控件 | 默认值 | 可选值 |
|---|---|---|---|
| 模型版本 | select | `happyhorse-1.1` | `happyhorse-1.1` / `happyhorse-1.0` |
| 清晰度 | select | `720P` | `720P` / `1080P` |
| 时长 | select | `5` | `3` / `5` / `8` / `10` / `15` |
| 水印 | toggle | 关闭 | `false` / `true` |
| 比例 | select | `9:16` | 仅参考生视频显示，支持官方全部比例 |
| 任务名 | input | 空 | 空时自动用时间戳 |

参考生视频比例：

`16:9`、`9:16`、`3:4`、`4:3`、`4:5`、`5:4`、`1:1`、`9:21`、`21:9`。

真实模型映射：

| 页面能力 | `happyhorse-1.1` | `happyhorse-1.0` |
|---|---|---|
| 图生视频 | `happyhorse-1.1-i2v` | `happyhorse-1.0-i2v` |
| 参考生视频 | `happyhorse-1.1-r2v` | `happyhorse-1.0-r2v` |

首版不暴露 `seed`。

## 4. 输入校验

点击开始生成后，先在本地校验图片；校验失败不提交 API。

### 4.1 图生视频首帧图

| 项 | 规则 | 失败文案 |
|---|---|---|
| 数量 | 必须且只能 1 张 | 图生视频只能选择 1 张首帧图 |
| 格式 | JPEG / JPG / PNG / WEBP | 只支持 JPEG、PNG、WEBP 图片 |
| 大小 | 不超过 20MB | 图片不能超过 20MB |
| 尺寸 | 宽高都不小于 300px | 首帧图宽高都不能小于 300px |
| 宽高比 | 1:2.5 到 2.5:1 | 首帧图宽高比必须在 1:2.5 到 2.5:1 之间 |

### 4.2 参考生视频参考图

| 项 | 规则 | 失败文案 |
|---|---|---|
| 数量 | 1-9 张 | 参考生视频需要 1-9 张参考图 |
| 格式 | JPEG / JPG / PNG / WEBP | 只支持 JPEG、PNG、WEBP 图片 |
| 大小 | 单图不超过 20MB | 图片不能超过 20MB |
| 尺寸 | 短边不低于 400px | 参考图短边不能低于 400px |

图片不复制到 `.workbench` 留档。诊断日志只记录文件名、mime、字节数、sha256、宽高等元信息。

## 5. 文件系统

视频产物保存到 `05-视频工作区`：

```text
05-视频工作区/
├─ 图生视频/{任务名}/0001.mp4
└─ 参考生视频/{任务名}/0001.mp4
```

规则：

- 未填写任务名时，任务名自动为当前时间：`YYYYMMDD-HHmmss`。
- 用户填写任务名时，按现有 Windows 文件名清洗规则处理非法字符、控制字符、结尾空格和结尾点。
- 清洗后为空则回退到时间任务名。
- 如果目标目录已经存在 `0001.mp4`，不覆盖，直接报错：
  `保存目录里已存在 0001.mp4，请更换任务名或删除旧文件后重试。`
- 下载完成后再更新页面预览和保存路径。

## 6. HappyHorse 接口

首版复用用户本地保存的阿里云百炼 API Key，不新增 `WorkspaceId` 配置。

使用中国内地 DashScope 原生旧域名：

```text
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
GET  https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
```

请求头：

```text
Authorization: Bearer sk-xxx
Content-Type: application/json
X-DashScope-Async: enable
```

### 6.1 图生视频请求

```json
{
  "model": "happyhorse-1.1-i2v",
  "input": {
    "prompt": "让产品缓慢旋转，镜头轻微推进",
    "media": [
      {
        "type": "first_frame",
        "url": "data:image/png;base64,..."
      }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "duration": 5,
    "watermark": false
  }
}
```

`prompt` 为空时不传 `input.prompt`。

### 6.2 参考生视频请求

```json
{
  "model": "happyhorse-1.1-r2v",
  "input": {
    "prompt": "[Image 1] 中的模特穿着 [Image 2] 的上衣走向镜头",
    "media": [
      {
        "type": "reference_image",
        "url": "data:image/jpeg;base64,..."
      },
      {
        "type": "reference_image",
        "url": "data:image/webp;base64,..."
      }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "ratio": "9:16",
    "duration": 5,
    "watermark": false
  }
}
```

### 6.3 轮询

状态机：

```text
idle
  → validating
  → submitting
  → pending
  → running
  → downloading
  → succeeded
```

失败状态：

```text
failed
stopped
```

HappyHorse 状态映射：

| task_status | 页面状态 | 处理 |
|---|---|---|
| `PENDING` | `pending` | 继续轮询 |
| `RUNNING` | `running` | 继续轮询 |
| `SUCCEEDED` | `downloading` → `succeeded` | 下载 `video_url` 到本地 |
| `FAILED` | `failed` | 显示 `code` / `message` |
| `CANCELED` | `failed` | 显示已取消 |
| `UNKNOWN` | `failed` | 显示任务不存在或已过期 |

默认轮询间隔：15 秒。首版不做云端取消；点击停止只停止查询。

## 7. IPC 接口

所有 IPC 输入必须用 zod 校验，channel 使用 `video:*`。

```ts
type VideoGenerationMode = 'image-to-video' | 'reference-to-video'
type HappyHorseVersion = 'happyhorse-1.1' | 'happyhorse-1.0'
type HappyHorseResolution = '720P' | '1080P'
type HappyHorseRatio =
  | '16:9'
  | '9:16'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '1:1'
  | '9:21'
  | '21:9'

type VideoRunInput = {
  mode: VideoGenerationMode
  taskName?: string
  prompt?: string
  imagePaths: string[]
  modelVersion: HappyHorseVersion
  resolution: HappyHorseResolution
  duration: 3 | 5 | 8 | 10 | 15
  watermark: boolean
  ratio?: HappyHorseRatio
}
```

IPC:

```text
video:run       → VideoRunInput → taskId
video:stop      → { task_id } → { ok: boolean }
video:open-path → { path } → { ok: true }
```

事件：

```text
video:progress  → VideoProgressEvent
video:completed → VideoCompletedEvent
video:debug-log → VideoRuntimeLogEntry
```

`VideoProgressEvent`：

```ts
type VideoProgressEvent = {
  task_id: string
  mode: VideoGenerationMode
  status:
    | 'validating'
    | 'submitting'
    | 'pending'
    | 'running'
    | 'downloading'
    | 'succeeded'
    | 'failed'
    | 'stopped'
  message: string
  taskStatus?: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN'
  remoteTaskId?: string
  outputPath?: string
  videoUrl?: string
  diagnosticsLogPath?: string
  error?: string
}
```

`VideoCompletedEvent`：

```ts
type VideoCompletedEvent =
  | {
      ok: true
      task_id: string
      mode: VideoGenerationMode
      remoteTaskId: string
      videoUrl: string
      outputPath: string
      diagnosticsLogPath?: string
    }
  | {
      ok: false
      task_id: string
      mode: VideoGenerationMode
      error: string
      diagnosticsLogPath?: string
    }
```

`VideoRuntimeLogEntry`：

```ts
type VideoRuntimeLogEntry = {
  id: string
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  mode: VideoGenerationMode
  message: string
  taskId?: string
  details?: {
    operation?:
      | 'validate'
      | 'submit'
      | 'poll'
      | 'download'
      | 'completed'
      | 'stop'
      | 'error'
    remoteTaskId?: string
    taskStatus?: string
    model?: string
    resolution?: string
    duration?: number
    ratio?: string
    imageCount?: number
    outputPath?: string
    videoUrl?: string
    error?: string
  }
}
```

## 8. 日志

### 8.1 运行期日志

视频生成页顶部显示 `日志 {count}` 按钮。点击后打开命令行式弹窗：

- 最近最多保留 `1000` 条。
- 应用重启后清空。
- 新日志追加时自动滚动到最新。
- 支持清空当前内存日志。
- 警告和错误计数显示在按钮上。

日志行格式与生图日志一致：

```text
[12:34:56.789] [INFO] [图生视频] 提交 HappyHorse 任务 · task=... · model=happyhorse-1.1-i2v
```

### 8.2 诊断日志

路径：

```text
.workbench/logs/diagnostics/video/{taskId}.jsonl
```

记录：

- 参数快照。
- 图片元信息：文件名、mime、bytes、sha256、width、height。
- 创建任务 payload 的脱敏版本。
- 创建任务原始响应。
- 每次轮询原始响应。
- 下载开始、下载成功、下载失败。
- 最终结果或错误。

禁止记录：

- API Key。
- Authorization header。
- 图片 base64 原文。
- data URL 原文。
- token / secret / password。

## 9. 错误处理

| 场景 | 错误文案 |
|---|---|
| 未配置百炼 API Key | 请先到设置页填写阿里云百炼 API Key |
| 图生视频图片数量不为 1 | 图生视频只能选择 1 张首帧图 |
| 参考生视频图片数量不在 1-9 | 参考生视频需要 1-9 张参考图 |
| 参考生视频提示词为空 | 参考生视频必须填写提示词 |
| 图片格式不支持 | 只支持 JPEG、PNG、WEBP 图片 |
| 图片超过 20MB | 图片不能超过 20MB |
| 图生视频尺寸过小 | 首帧图宽高都不能小于 300px |
| 图生视频比例非法 | 首帧图宽高比必须在 1:2.5 到 2.5:1 之间 |
| 参考图尺寸过小 | 参考图短边不能低于 400px |
| 输出文件已存在 | 保存目录里已存在 0001.mp4，请更换任务名或删除旧文件后重试。 |
| HappyHorse 401/403 | 阿里云百炼 API Key 无效或无权调用 HappyHorse |
| HappyHorse 429 | 阿里云百炼请求过于频繁，请稍后重试 |
| HappyHorse 402 | 阿里云百炼额度不足 |
| 轮询 UNKNOWN | 任务不存在或已过期，请重新生成 |
| 下载失败 | 视频生成成功，但下载保存失败，请检查网络后重新生成 |

## 10. 数据库

首版不做任务历史列表和断点恢复，但仍应登记最小任务和 artifact 血缘：

- `tasks.module = "video"`
- `tasks.type = "lightweight"`
- `workflow_steps.module = "video"`
- `artifacts.type = "video"`
- `artifacts.file_path = 05-视频工作区/.../0001.mp4`

如果当前数据库 artifact type 没有枚举约束，只新增写入约定；如果有约束，新增 `video` 并补迁移。

## 11. 验收

- 左侧导航最后有 `视频生成`。
- 未配置百炼 API Key 时，点击生成提示去设置页。
- 图生视频只允许 1 张合规图片，提示词可空。
- 参考生视频允许 1-9 张合规图片，提示词必填，图片显示 `[Image N]`。
- 参考生视频上传后会自动编号，支持点编号插入提示词，也支持输入 `@` 选图插入。
- 参数默认值：`happyhorse-1.1`、`720P`、`5秒`、水印关闭、参考生视频 `9:16`。
- 成功后 MP4 自动下载到 `05-视频工作区`，页面显示本地视频预览。
- 已存在 `0001.mp4` 时不覆盖，报明确错误。
- 日志按钮打开滚动日志弹窗，追加日志自动滚动到底。
- 诊断日志写入 `.workbench/logs/diagnostics/video/`，不包含 API Key 或 base64 原文。
- 停止查询不会调用云端取消，并在 UI 提醒可能继续计费。

## 12. 测试

最小测试：

- 模型版本到真实模型名映射。
- 任务名清洗和 `0001.mp4` 冲突。
- 图生视频图片校验：格式、大小、尺寸、比例、数量。
- 参考生视频图片校验：格式、大小、短边、数量。
- HappyHorse 创建任务 payload。
- 轮询状态映射。
- 下载保存成功和失败。
- 诊断日志脱敏。
- 运行期日志格式化。

手工验收：

- 使用一张 720P 图片跑通图生视频。
- 使用 2-3 张参考图跑通参考生视频。
- 验证停止查询只停止前端轮询。
- 验证本地 MP4 预览可播放。
