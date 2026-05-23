# Task: PS 进度和结构化日志（切片 7 - PS 套版）

## 目标

进度面板 + 结构化日志文件。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §11`

## 验收标准

- [ ] 进度数据：total_groups / completed / failed / skipped / current_group / current_stage / verified_outputs
- [ ] IPC 事件 `photoshop:progress` 推送
- [ ] 结构化日志写 .workbench/logs/photoshop-{taskId}.log
- [ ] 字段：ts/level/stage/group/input/attempt/output_file/error/duration_ms
- [ ] 用 pino JSON 格式

## 不做

- 无明确排除项（按需收敛）

## 实施提示

stage 取值：task_start / jsx_generate / jsx_exec / output_verify / group_complete。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop progress and structured logs"
python3 .trellis/scripts/task.py archive 05-23-ps-progress-logs
```
