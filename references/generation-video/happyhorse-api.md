# 阿里云百炼 HappyHorse 视频 API 参考（腾域 aipod 集成版）

> 抓取自阿里云帮助中心于 2026-06-30；官方页面最后修改时间均为 2026-06-23。
> HappyHorse 是百炼的视频生成/编辑模型族，覆盖文生视频、图生视频、参考生视频和视频编辑。

## 官方文档入口

| 用途 | 链接 |
|---|---|
| 文生视频 | https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference |
| 图生视频（基于首帧） | https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference |
| 参考生视频 | https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference |
| 视频编辑 | https://help.aliyun.com/zh/model-studio/happyhorse-video-edit-api-reference |
| 控制台 API 页 | https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=3029820 |

本地原始网页副本：

- `happyhorse-text-to-video-api-reference.html`
- `happyhorse-image-to-video-api-reference.html`
- `happyhorse-reference-to-video-api-reference.html`
- `happyhorse-video-edit-api-reference.html`

## 1. 基础信息

```
Create task:
  POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis

Query task:
  GET  https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}

Headers:
  Authorization: Bearer sk-xxx
  Content-Type: application/json
  X-DashScope-Async: enable
```

要点：

- HTTP 调用只支持异步，必须带 `X-DashScope-Async: enable`。
- 创建任务后拿 `task_id` 轮询结果，不要重复创建任务。
- `task_id` 查询有效期为 24 小时。
- 查询接口默认 RPS 为 20，官方建议轮询间隔例如 15 秒。
- 成功后返回 `video_url`，链接有效期为 24 小时，应尽快下载转存。
- 华北 2（北京）、新加坡、德国推荐用 `{WorkspaceId}.{region}.maas.aliyuncs.com` 业务空间域名；美国弗吉尼亚仍示例为 `dashscope-us.aliyuncs.com`。

### 1.1 任务状态

| `task_status` | 含义 | 腾域处理建议 |
|---|---|---|
| `PENDING` | 排队中 | 继续轮询 |
| `RUNNING` | 处理中 | 继续轮询 |
| `SUCCEEDED` | 成功 | 下载 `video_url`，再登记 artifact |
| `FAILED` | 失败 | 记录 `code` / `message` |
| `CANCELED` | 已取消 | 标记任务取消 |
| `UNKNOWN` | 不存在或过期 | 提示用户重新创建任务 |

## 2. 四种能力

| 能力 | 模型 | 输入 | 适合做什么 |
|---|---|---|---|
| 文生视频 | `happyhorse-1.1-t2v` / `happyhorse-1.0-t2v` | 纯文本 `prompt` | 从零生成一个视频 |
| 图生视频 | `happyhorse-1.1-i2v` / `happyhorse-1.0-i2v` | 1 张 `first_frame` 首帧图，可加 `prompt` | 让一张图动起来，首帧构图最强 |
| 参考生视频 | `happyhorse-1.1-r2v` / `happyhorse-1.0-r2v` | 1-9 张 `reference_image`，必须加 `prompt` | 保持人物、物品、服饰等参考主体一致 |
| 视频编辑 | `happyhorse-1.0-video-edit` | 1 个 `video`，可加 0-5 张 `reference_image`，必须加 `prompt` | 改已有视频，如换衣服、换风格、局部替换 |

### 2.1 文生视频

请求核心：

```json
{
  "model": "happyhorse-1.1-t2v",
  "input": {
    "prompt": "一座微型城市在夜晚亮起灯光"
  },
  "parameters": {
    "resolution": "720P",
    "ratio": "16:9",
    "duration": 5
  }
}
```

参数：

- `prompt` 必选，中文不超过 2500 字符，非中文不超过 5000 字符，超出会截断。
- `resolution` 可选：`720P` / `1080P`，默认 `1080P`。
- `ratio` 可选：`16:9` 默认，也支持 `9:16`、`1:1`、`4:3`、`3:4`、`4:5`、`5:4`、`9:21`、`21:9`。
- `duration` 可选：3-15 秒整数，默认 5。
- `watermark` 可选：`true` 默认添加右下角 `Happy Horse` 水印，`false` 不添加。
- `seed` 可选：0-2147483647，固定后可提升复现性，但不保证完全一致。

### 2.2 图生视频（基于首帧）

请求核心：

```json
{
  "model": "happyhorse-1.1-i2v",
  "input": {
    "prompt": "一只猫在草地上奔跑",
    "media": [
      {
        "type": "first_frame",
        "url": "https://example.com/cat.png"
      }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "duration": 5
  }
}
```

参数：

- `media` 必选，且只能有 1 张 `first_frame`。
- `prompt` 可选，用来引导动作和镜头。
- 图像支持 URL 或 base64 data URL；格式 JPEG/JPG/PNG/WEBP；不超过 20MB；宽高都不小于 300 像素；宽高比 1:2.5 到 2.5:1。
- `resolution` 可选：`720P` / `1080P`，默认 `1080P`。
- `duration` 可选：3-15 秒整数，默认 5。
- 不支持 `ratio`，输出宽高比自动跟随首帧图。
- `watermark` 可选：`true` 默认添加右下角 `Happy Horse` 水印，`false` 不添加。
- `seed` 可选：0-2147483647，固定后可提升复现性，但不保证完全一致。

### 2.3 参考生视频

请求核心：

```json
{
  "model": "happyhorse-1.1-r2v",
  "input": {
    "prompt": "[Image 1]中的人物走到镜头前，[Image 2]中的饰品保持一致",
    "media": [
      {
        "type": "reference_image",
        "url": "https://example.com/person.jpg"
      },
      {
        "type": "reference_image",
        "url": "https://example.com/accessory.jpg"
      }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "ratio": "16:9",
    "duration": 5
  }
}
```

参数：

- `prompt` 必选。
- `media` 必选，1-9 张 `reference_image`。
- 在 `prompt` 里用 `[Image 1]`、`[Image 2]` 指代 `media` 数组里的对应图片。
- 参考图格式 JPEG/JPG/PNG/WEBP；单图不超过 20MB；短边不低于 400 像素，推荐 720P 以上清晰图。
- `resolution` 可选：`1080P` 默认，或 `720P`。
- `ratio` 可选：`16:9` 默认，也支持 `9:16`、`3:4`、`4:3`、`4:5`、`5:4`、`1:1`、`9:21`、`21:9`。
- `duration` 可选：3-15 秒整数，默认 5。
- `watermark` 可选：`true` 默认添加右下角 `Happy Horse` 水印，`false` 不添加。
- `seed` 可选：0-2147483647，固定后可提升复现性，但不保证完全一致。

### 2.4 视频编辑

请求核心：

```json
{
  "model": "happyhorse-1.0-video-edit",
  "input": {
    "prompt": "让视频中的角色穿上参考图里的条纹毛衣",
    "media": [
      {
        "type": "video",
        "url": "https://example.com/input.mp4"
      },
      {
        "type": "reference_image",
        "url": "https://example.com/sweater.webp"
      }
    ]
  },
  "parameters": {
    "resolution": "720P"
  }
}
```

参数：

- `prompt` 必选，描述编辑意图，例如风格转换、局部替换。
- `media` 必选，必须包含 1 个 `video`，可选 0-5 张 `reference_image`。
- 输入视频必须是公网 URL；大小不超过 100MB；帧率大于 8fps；长边不超过 4096 像素，短边不小于 360 像素；宽高比 1:2.5 到 2.5:1。
- 输出视频时长为 3-15 秒；输入视频超过 15 秒时，从头截取前 15 秒。
- 参考图支持 URL 或 base64 data URL；格式 JPEG/JPG/PNG/WEBP；不超过 20MB；宽高都不小于 300 像素。
- `resolution` 可选：`1080P` 默认，或 `720P`。
- `watermark` 可选：`true` 默认添加右下角 `Happy Horse` 水印，`false` 不添加。
- `audio_setting` 可选：`auto` 默认由模型控制，`origin` 保留输入视频原声。
- `seed` 可选：0-2147483647，固定后可提升复现性，但不保证完全一致。

## 3. 三个相近能力的区别

**图生视频**：给 1 张首帧图，让它动起来。它最看重“第一帧长什么样”，输出画面比例跟着这张图走。

**参考生视频**：给 1-9 张参考图，让模型理解“这些人/物/服饰/配件要保持一致”，再按文字生成新视频。它不是只把第一张图动起来，而是用多张图做身份和视觉参考。

**视频编辑**：先给一个已有视频，再用文字和可选参考图去改它。它不是从零生成，也不是只参考图片生成，而是在原视频基础上做修改。

推荐选择：

- 已有一张产品图或角色图，想直接动起来：用图生视频。
- 有多张人物/商品/服饰参考图，想生成一个新视频且保持主体一致：用参考生视频。
- 已经有视频，只想换衣服、换风格、替换局部内容：用视频编辑。

## 4. 腾域集成要点

- 这套能力如果接入，应归到新的视频生成 provider 参考，不要混进当前图片生图能力。
- 输出是 MP4 视频，不属于现有 `02-印花工作区` 的图片产物；落地前需要先定义视频产物目录和数据库 artifact 类型。
- 当前项目 v1 生图模块只覆盖图片生成、提取、抠图；HappyHorse 属于后续增量，不应直接塞进现有 Grsai/ComfyUI 图片 runner。

## 5. 已知不确定项（待实施验证）

- [ ] 业务空间域名是否已在目标客户百炼账号开通。
- [ ] 控制台页面中 `url=3029820` 是否还有隐藏的模型开通、计费或权限说明。
- [ ] 计费价格与水印策略需要实施前从百炼控制台再核对一次。
- [ ] 视频文件下载后保存位置、命名规则和过期链接兜底策略尚未设计。
