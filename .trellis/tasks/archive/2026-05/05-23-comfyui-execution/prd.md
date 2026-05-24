# Task: ComfyUI 工作流执行引擎（切片 5 - 生图 ComfyUI）

## 目标

对每个生图任务：拉工作流 → 上传素材 → 注入 input_slots → 提交 prompt → 轮询 → 下载产物。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §2.4, §10`

## 验收标准

- [ ] 类 `ComfyuiChenyuAdapter` 实现 `ImageGenerationAdapter`
- [ ] 确保实例 running 才能跑（否则报 CHENYU_INSTANCE_DOWN）
- [ ] 工作流缓存（用 client-skill-cache 同套机制）
- [ ] 上传素材：调 ComfyUI /upload/image
- [ ] 注入 input_slots：克隆 workflow_json，按 slots 配置改 input 字段值
- [ ] 提交：POST /prompt → 返回 prompt_id
- [ ] 轮询 /history/{prompt_id} 每 2 秒，超时 10 分钟
- [ ] 下载 outputs：按 output_slots 取对应 filename → GET /view
- [ ] 保存到 02-生图/{step}/{印花ID}.{ext}
- [ ] 数据库登记 artifacts 完整血缘

## 不做

- 不实现并行多 prompt（v1 单实例串行）

## 实施提示

input_slots 注入时类型转换：type='image' → 用上传后的 filename；type='string' → 用 prompt 文本。

## 完成后

```bash
git add -A
git commit -m "feat(task): comfyui workflow execution engine"
python3 .trellis/scripts/task.py archive 05-23-comfyui-execution
```
