# Grsai API 参考（腾域 aipod 集成版）

> 抓取自 https://qmy27nhsd9.apifox.cn/ 于 2026-05-23。
> Grsai 是付费 AI API 中转站，**腾域用它的图像生成能力**（也提供 OpenAI 兼容的 LLM，但腾域 LLM 走阿里云百炼）。

## 官方文档入口

| 用途 | 链接 |
|---|---|
| API 文档（apifox） | https://qmy27nhsd9.apifox.cn/ |
| API Key 获取 | https://grsai.ai/zh/dashboard/api-keys |
| 主页 | https://grsai.ai |

---

## 1. 基础信息

```
Base URL:
  全球节点: https://grsaiapi.com
  国内节点: https://grsai.dakka.com.cn        ← 国内默认走这个，延迟低
Auth:    Authorization: Bearer sk-xxxxxxxxxxx
Content-Type: application/json
```

### 统一响应（同步生图）

```json
{
  "id": "<task-id>",
  "status": "succeeded",            // running / violation / succeeded / failed
  "progress": 100,                  // 0~100（异步模式才有意义）
  "results": [{ "url": "https://file1.aitohumanize.com/file/xxx.png" }],
  "error": ""                        // 失败时的错误信息
}
```

### 状态值

| status | 含义 | 后续动作 |
|---|---|---|
| `running` | 进行中 | 异步模式下继续轮询 |
| `violation` | 内容违规 | 不再轮询，提示用户改 prompt |
| `succeeded` | 成功 | 拿 `results[].url` 下载 |
| `failed` | 失败 | 看 `error` 字段 |

---

## 2. 核心 API（4 个端点）

### 2.1 POST `/v1/api/generate` — 生图（Grsai 原生）

**这是腾域生图模块主要调用的端点。**

请求体：
```json
{
  "model": "nano-banana-2",        // 必需，见下方模型表
  "prompt": "生成一张...",          // 必需
  "images": ["data:image/png;base64,..." 或 "https://..."],  // 可选，参考图
  "aspectRatio": "1:1",            // 可选
  "imageSize": "1K",               // 可选，1K / 2K / 4K
  "replyType": "json"              // 可选，json / stream / async
}
```

**支持的 model 名**：
- `nano-banana`
- `nano-banana-fast`
- `nano-banana-2`
- `nano-banana-2-cl`
- `nano-banana-2-4k-cl`
- `nano-banana-pro`
- `nano-banana-pro-cl`
- `nano-banana-pro-vip`
- `nano-banana-pro-4k-vip`
- `gpt-image-2`
- `gpt-image-2-vip`

**aspectRatio 支持**：
- 通用：`auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9`
- nano-banana-2 系列额外支持：`1:4 / 4:1 / 1:8 / 8:1`

**replyType 三种模式**：
| 值 | 行为 | 适用 |
|---|---|---|
| `json` | 同步阻塞，返回时已 succeeded（含 `results[].url`） | 简单批量、单张试 |
| `stream` | SSE 流式返回，边生边推进度 | UI 实时进度条 |
| `async` | 立即返回 task_id，需自己轮询 `/v1/api/result` | 大批量、不阻塞主线程 |

### 2.2 GET `/v1/api/result?id={task_id}` — 异步任务查询

只在 `replyType=async` 后使用。响应结构同 2.1。

### 2.3 POST `/v1/images/generations` — OpenAI 兼容生图

请求体（OpenAI 标准）：
```json
{
  "model": "gpt-image-2",
  "prompt": "...",
  "image": [],                     // 可选，base64 或 url
  "size": "1024x1024",             // OpenAI 风格的像素串
  "response_format": "url"
}
```

**注意**：原生 `generate` 端点用 `aspectRatio` + `imageSize`，OpenAI 兼容端点用 `size`（直接像素）。

`size` 支持的比例（1K/2K/4K 各一组），常用：
- 1:1 → `1024x1024` / `2048x2048` / `2880x2880`
- 16:9 → `1774x887` / `2048x1152` / `3840x2160`
- 9:16 → `887x1774` / `1152x2048` / `2160x3840`
- 完整对照表在 apifox 详情页

仅 `gpt-image-2-vip` 支持 2K/4K。

### 2.4 POST `/v1/chat/completions` — OpenAI 兼容 LLM

```json
{
  "model": "gemini-3.1-pro",
  "stream": false,
  "messages": [{"role": "user", "content": "你好"}]
}
```

**腾域不用这个**（LLM 走阿里云百炼），但备份选项。

---

## 3. 腾域集成要点

### 3.1 在哪个模块使用
`pod-workbench/src/modules/generation-paid/`（付费模型生图模块）

### 3.2 模型 → 能力映射（待用户确认）

我们的"提取/文生图/图生图/抠图"四个子能力，是否都用同一个 Grsai 模型？还是分开？

| 子能力 | 推荐模型 | 备注 |
|---|---|---|
| 提取（从产品图提印花）| nano-banana-2 + 提示词驱动 | 需要 skill 提示词模板 |
| 文生图 | nano-banana-pro 或 gpt-image-2 | 看效果选 |
| 图生图 | nano-banana-2（带参考图） | images 字段传印花 |
| 抠图 | 通过 prompt 让模型去背景 | 或者用专门的抠图模型（待调研） |

⚠️ Grsai 没有提供原生"抠图 API"，要靠 prompt 指挥模型去背景。如果效果不好，腾域抠图可能要走阿里云的别的能力或者额外的服务商。

### 3.3 调用流程（伪代码）

```
1. 用户在 generation-paid 模块面板选子能力（提取/文生图/图生图/抠图）
2. 软件从云服务器拉对应 skill 模板（提示词 + 默认参数）
3. 用户填充变量（如"产品描述"），软件拼接最终 prompt
4. （如果是图生图/提取）把素材图编码成 base64 或上传到可访问 URL
5. POST /v1/api/generate
   - 大批量时 replyType=async，拿 task_id
   - 单张时 replyType=json，直接拿结果
6. 异步模式：轮询 /v1/api/result（每 2 秒）直到 status≠running
7. 成功 → 下载 results[].url，落到 02-生图/中转站/{子能力}/{印花ID}.png
8. 数据库登记：印花ID、来源原图、provider="grsai"、model、prompt 快照、版本、status
9. 失败/违规 → UI 提示
```

### 3.4 节点选择

- 默认走国内节点 `grsai.dakka.com.cn`（延迟低）
- 国内节点连不通时降级到全球节点 `grsaiapi.com`
- 用户可在设置中强制选节点

### 3.5 错误处理

| 错误情况 | 我们的处理 |
|---|---|
| 401 | API Key 失效 → 提示重填 |
| 429 | 限速 → 退避重试 3 次 |
| 状态 = violation | 内容违规，不重试 → UI 提示用户改 prompt |
| 状态 = failed | 看 error 字段 → 提示用户 + 允许重试 |
| 状态长时间 running（> 5 分钟） | 提示用户继续等或终止 |
| 下载 results[].url 失败 | 自动重试 3 次 |

### 3.6 计费

Grsai 文档**没有公开按调用单价**（要去官网或控制台查）。腾域 v1 不做精细费用监控，只提示用户"调用了 N 次"。后续如果 Grsai 提供余额查询 API，可以做余额展示（参考晨羽智云的方案）。

---

## 4. 踩坑记录（实施过程中追加）

- 暂无

---

## 5. 已知不确定项（待实施验证）

- [ ] `images` 字段（参考图）的 base64 大小限制
- [ ] nano-banana 各变种之间的具体差异（fast / 2 / pro / vip 究竟在生成质量、速度、价格上怎么差）
- [ ] `stream` 模式返回的 SSE 事件结构
- [ ] `async` 模式的轮询频率和超时建议
- [ ] 内容审核（`violation`）的触发规则
- [ ] 是否提供余额查询 / 用量统计 API
- [ ] 是否提供 webhook 回调（替代轮询）
- [ ] 国内/全球节点的稳定性差异
- [ ] OpenAI 兼容端点（`/v1/images/generations`）和原生 `/v1/api/generate` 的等价性、是否有功能差异

实施前**用一个真实 Key 跑一遍**最小流程（生图 → 拿 URL → 下载），把上面 9 项验证清楚。
