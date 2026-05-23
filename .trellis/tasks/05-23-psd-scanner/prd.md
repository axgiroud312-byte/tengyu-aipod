# Task: PSD 模板扫描器（切片 7 - PS 套版）

## 目标

动态生成扫描 JSX → 跑 PS → 读结果 JSON → 缓存到数据库。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §3`

## 验收标准

- [ ] `scanPsd(psdPath) → PsdTemplate`
- [ ] 按 hash 缓存（PSD 文件 hash 不变则用缓存）
- [ ] 动态生成 JSX 写临时文件 + 调 PS COM 跑 + 读结果 JSON
- [ ] 扫描结果含：smart_objects (name/path/is_top_level/bounds/shared_indicator) / guides / clip_areas / doc_size / mode
- [ ] 嵌套 SO 检测（递归遍历 LayerSet）
- [ ] 共享 SO 检测（简化版：bounds + name 哈希）
- [ ] 数据库 psd_templates 表存缓存
- [ ] vitest 单测（mock JSX 结果）

## 不做

- 不实现 PSB 完整解析（v1 跟 PSD 一样）
- 不实现 3D 图层支持

## 实施提示

结果 JSON 通过 .workbench/tmp/photoshop/{taskId}/scan-result.json 回传。

## 完成后

```bash
git add -A
git commit -m "feat(task): psd template scanner"
python3 .trellis/scripts/task.py archive 05-23-psd-scanner
```
