# Task: 服务端 ComfyUI 工作流派发 API（切片 5 - 生图 ComfyUI）

## 目标

`GET /api/comfyui-workflows` 列表 + `GET /api/comfyui-workflows/:id/content` 详情。

## 输入

参考文档（按重要性排序）：
- `docs/spec/08-server.md §4.2`

## 验收标准

- [ ] 列表接口返回 ComfyuiWorkflowSummary[]（不含 workflow_json）
- [ ] 详情接口返回完整 workflow_json + input_slots + output_slots
- [ ] 支持 category 过滤
- [ ] 支持版本指定
- [ ] 客户端 JWT 校验
- [ ] 大 workflow JSON 用 gzip 压缩响应

## 不做

- 无明确排除项（按需收敛）

## 实施提示

Next.js 14+ 默认支持 brotli/gzip，无需额外配置。

## 完成后

```bash
git add -A
git commit -m "feat(task): server comfyui workflow dispatch API"
python3 .trellis/scripts/task.py archive 05-23-server-api-workflows
```
