# Task: PS 跳过已完成（切片 7 - PS 套版）

## 目标

判据：DB 任务 completed + 文件存在 + hash 一致。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §9`

## 验收标准

- [ ] `shouldSkipJob(job): Promise<boolean>`
- [ ] 三个条件全满足才跳过：
- [ ]   数据库 workflow_steps 有 completed 记录（按 job_signature）
- [ ]   所有 output_paths 文件存在
- [ ]   文件 hash 与数据库一致
- [ ] UI 顶部 [跳过已完成] toggle 默认开

## 不做

- 无明确排除项（按需收敛）

## 实施提示

job_signature = hash(mockup_path + sorted(so_replacements) + clip_mode + format)。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop skip completed jobs"
python3 .trellis/scripts/task.py archive 05-23-ps-skip-completed
```
