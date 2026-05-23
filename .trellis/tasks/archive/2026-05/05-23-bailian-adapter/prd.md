# Task: 阿里云百炼 Adapter（切片 2 - 标题生成模块）

## 目标

封装阿里云百炼 OpenAI 兼容客户端，支持 chat completion + vision（图像理解）。

## 输入

参考文档（按重要性排序）：
- `references/vision-llm-providers/aliyun-bailian-api.md`
- `docs/spec/04-detection.md §5.1`

## 验收标准

- [ ] 类 `AliyunBailianAdapter`：构造接受 apiKey + region（cn/sg/us）
- [ ] 方法 `chatCompletion(req: ChatRequest): Promise<ChatResponse>`
- [ ] 方法 `visionCompletion(req: VisionRequest): Promise<VisionResponse>` —— 支持 messages 含 image_url
- [ ] 支持 `response_format: { type: 'json_object' }`
- [ ] 图片用 data URL 格式（`data:image/png;base64,...`）
- [ ] 封装 OpenAI SDK 重试机制 + 429 退避
- [ ] 错误统一转 AppError（401 / 429 / 5xx 等）
- [ ] vitest 单测覆盖（用 msw mock）

## 不做

- 不实现 DashScope 原生模式（v1 仅 OpenAI 兼容）
- 不实现流式响应

## 实施提示

用 `openai` npm 包，构造时设 `baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'`。

## 完成后

```bash
git add -A
git commit -m "feat(task): aliyun bailian adapter"
python3 .trellis/scripts/task.py archive 05-23-bailian-adapter
```
