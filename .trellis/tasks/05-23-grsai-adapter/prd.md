# Task: Grsai Adapter（切片 4 - 生图 Grsai）

## 目标

封装 Grsai API：原生 `/v1/api/generate` + OpenAI 兼容 `/v1/images/generations` + 异步 `/v1/api/result` + 节点切换。

## 输入

参考文档（按重要性排序）：
- `references/generation-paid/grsai-api.md`
- `docs/spec/03-generation.md §2.5`

## 验收标准

- [ ] 类 `GrsaiAdapter` 实现 `ImageGenerationAdapter`
- [ ] 构造：apiKey + node ('cn' | 'global')
- [ ] 三种 replyType: json（同步）/ stream（流式）/ async（异步轮询）
- [ ] v1 默认用 json（同步）模式
- [ ] 参考图：strip 'data:' 前缀传纯 base64
- [ ] 支持 11 个模型 model 字段直接传
- [ ] 节点失败时自动 fallback 到另一个
- [ ] 错误分类：violation（不重试）/ failed（可重试）/ network
- [ ] vitest 单测 + msw mock

## 不做

- 不实现 chat completion 端点（腾域用百炼）
- v1 不实现 stream 模式（v1.5）

## 实施提示

异步模式 v1.5 加。当前 json 模式响应阻塞 15-30 秒，并发 3 个差不多。

## 完成后

```bash
git add -A
git commit -m "feat(task): grsai adapter"
python3 .trellis/scripts/task.py archive 05-23-grsai-adapter
```
