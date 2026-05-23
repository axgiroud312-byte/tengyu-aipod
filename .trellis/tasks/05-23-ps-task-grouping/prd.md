# Task: PS 任务分组（切片 7 - PS 套版）

## 目标

按代表 SO 数把印花分组，每组对应一个套版任务。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §5`

## 验收标准

- [ ] `groupTasks(prints, template, replaceRange) → TaskGroup[]`
- [ ] 代表 SO 数 = `representativeSoCount(scanResult, replaceRange)`
- [ ] N=1 → 每张图独立一组
- [ ] N>1 → 按 N 张图一组（不足凑齐用上一组的最后一张？或保留不足）
- [ ] 排序用 sortAlphaNum（自然排序：img2 < img10）
- [ ] v1 不支持手动拖拽分组（v1.5）
- [ ] 每组生成 PhotoshopJob 含 mockup_path / so_replacements / output_paths

## 不做

- 无明确排除项（按需收敛）

## 实施提示

sortAlphaNum 完整实现见 spec §5.1。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop task grouping"
python3 .trellis/scripts/task.py archive 05-23-ps-task-grouping
```
