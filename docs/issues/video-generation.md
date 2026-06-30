# 视频生成模块 — 本地 Issue 任务清单

> 来源：`docs/spec/10-video-generation.md` 与 ADR-0016。每个 issue 都应能独立验证，避免一次性大改。

## Issue 1 — 工作区与文档口径同步

目标：让 Workbench 创建并识别 `05-视频工作区`。

范围：

- 更新工作区初始化逻辑，新增 `05-视频工作区`。
- 确认设置页工作区目录列表展示 `05-视频工作区`。
- 路径保护允许视频模块写入 `05-视频工作区`。
- 不改现有 `01`-`04` 行为。

验收：

- 新工作区保存后自动创建 `05-视频工作区`。
- 已有工作区重新进入后补建 `05-视频工作区`。
- 相关测试覆盖目录创建。

## Issue 2 — HappyHorse adapter 最小闭环

目标：主进程能创建 HappyHorse 任务、轮询结果、返回 `video_url`。

范围：

- 新增 `HappyHorseVideoAdapter`。
- 固定中国内地旧域名 `https://dashscope.aliyuncs.com/api/v1`。
- 复用本地 `bailian` API Key。
- 实现图生视频和参考生视频 payload。
- 实现 `task_status` 映射。

验收：

- 单测覆盖模型映射、payload、状态映射。
- 未配置 API Key 时返回明确错误。
- 不需要 `WorkspaceId`。

## Issue 3 — 图片校验与 base64 转换

目标：提交前完成本地图片校验，并生成 HappyHorse 可用 data URL。

范围：

- 支持 JPEG/JPG/PNG/WEBP。
- 校验 20MB 上限。
- 图生视频校验 1 张、宽高都不小于 300px、宽高比 1:2.5 到 2.5:1。
- 参考生视频校验 1-9 张、短边不低于 400px。
- 计算图片 sha256、mime、宽高、字节数。
- 不复制输入图片到 `.workbench`。

验收：

- 单测覆盖所有失败文案。
- 诊断元信息不包含 base64 原文。

## Issue 4 — 视频保存与冲突处理

目标：生成成功后下载 MP4 到 `05-视频工作区`。

范围：

- 任务名清洗；空任务名使用 `YYYYMMDD-HHmmss`。
- 输出路径：`05-视频工作区/{图生视频|参考生视频}/{任务名}/0001.mp4`。
- 已存在 `0001.mp4` 时不覆盖，报错：`保存目录里已存在 0001.mp4，请更换任务名或删除旧文件后重试。`
- 下载失败返回明确错误。

验收：

- 单测覆盖任务名清洗、路径生成、冲突报错。
- 下载成功后文件存在且大小大于 0。

## Issue 5 — 视频 IPC 与运行状态事件

目标：渲染进程通过 `video:*` IPC 启动、停止查询并接收进度。

范围：

- `video:run`
- `video:stop`
- `video:open-path`
- `video:progress`
- `video:completed`
- `video:debug-log`
- zod 校验所有输入。
- 停止查询只停止本地轮询，不调用云端取消。

验收：

- IPC 单测覆盖非法输入。
- 停止查询后不再轮询，并发送 `stopped` 状态。
- 失败后发送 `completed ok:false`。

## Issue 6 — 诊断日志与运行期日志

目标：视频模块同时有页面运行期日志和落盘诊断日志。

范围：

- 扩展 `DiagnosticModule`，新增 `video`。
- 写 `.workbench/logs/diagnostics/video/{taskId}.jsonl`。
- 诊断日志记录参数快照、图片元信息、脱敏 payload、创建任务响应、轮询响应、下载结果。
- API Key、authorization、token、secret、password、base64、data URL 原文必须脱敏。
- 新增视频运行期日志格式化 helper。

验收：

- 单测证明诊断日志不含 API Key 和 base64。
- 日志格式与采集/生图风格一致。
- 最近最多保留 1000 条由页面状态控制。

## Issue 7 — 独立视频生成页面

目标：新增可用的视频生成页面。

范围：

- 左侧导航在 `上架` 后新增 `视频生成`。
- 页面顶部有 `图生视频` / `参考生视频` Tab。
- 左侧输入区：首帧图或视频参考图上传、缩略图、编号、提示词。
- 参考生视频提示词支持点击编号插入 `[Image N]`，也支持输入 `@` 选择参考图编号。
- 右侧参数区：模型版本、清晰度、时长、水印、参考生视频比例、任务名。
- 开始按钮附近显示费用/耗时提醒。
- 失败后保留输入和参数，显示重新生成。
- 完成后显示本地 MP4 `<video controls>` 预览、保存路径、打开目录按钮、复制 `video_url`。

验收：

- 图生视频提示词可为空。
- 参考生视频提示词为空不能提交。
- 参考生视频删除图片后编号自动重排。
- 生成完成后页面直接播放本地 MP4。
- 不自动打开目录。

## Issue 8 — 视频页日志弹窗

目标：视频页日志交互和采集/生图/完整任务一致。

范围：

- 顶部 `日志 {count}` 按钮。
- 命令行式 Dialog。
- ScrollArea 自滚动。
- 新日志追加时自动滚动到底。
- 支持清空日志。
- 按钮显示 warn/error 计数。

验收：

- 手动触发多条日志时弹窗滚动到底。
- 清空后计数归零。
- warn/error 计数正确。

## Issue 9 — 数据库登记视频 artifact

目标：视频生成任务有最小任务记录和 artifact 血缘。

范围：

- `tasks.module = "video"`。
- `tasks.type = "lightweight"`。
- `workflow_steps.module = "video"`。
- `artifacts.step = "video"`。
- `artifacts.file_path` 指向 MP4。
- 如数据库约束需要，补迁移。

验收：

- 成功生成后能在 SQLite 查到任务和 artifact。
- 失败任务记录错误。
- 不创建印花 ID，不写 `prints`。

## Issue 10 — 端到端手工验收

目标：本机跑通真实 HappyHorse。

范围：

- 用 1 张合规图片跑通图生视频。
- 用 2-3 张参考图跑通参考生视频。
- 验证 MP4 下载、预览、打开目录。
- 验证停止查询提示语和行为。
- 验证诊断日志路径和脱敏。

验收：

- 两种能力都生成可播放 MP4。
- `05-视频工作区` 路径符合 spec。
- `diagnostics/video` 日志存在且无敏感信息。
