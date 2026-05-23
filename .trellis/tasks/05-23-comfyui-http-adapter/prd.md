# Task: ComfyUI HTTP Adapter（切片 5 - 生图 ComfyUI）

## 目标

封装 ComfyUI 原生 HTTP API：upload/prompt/history/view。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §2.4`
- ComfyUI 官方文档

## 验收标准

- [ ] 类 `ComfyHttpClient`：构造 baseUrl（来自晨羽 server_map）
- [ ] 方法：uploadImage(buffer, filename), queuePrompt(workflow), getHistory(promptId), viewImage(filename)
- [ ] uploadImage 返回 ComfyUI 内的文件名
- [ ] queuePrompt 返回 prompt_id
- [ ] getHistory 轮询直到 status.completed
- [ ] viewImage 返回 Buffer
- [ ] 错误处理：连接超时 / 500 / ComfyUI 队列满
- [ ] vitest 单测

## 不做

- 不实现 WebSocket 进度（v1 用轮询）

## 实施提示

ComfyUI HTTP API 文档：https://github.com/comfyanonymous/ComfyUI/blob/master/server.py 的 routes。

## 完成后

```bash
git add -A
git commit -m "feat(task): comfyui http adapter"
python3 .trellis/scripts/task.py archive 05-23-comfyui-http-adapter
```
