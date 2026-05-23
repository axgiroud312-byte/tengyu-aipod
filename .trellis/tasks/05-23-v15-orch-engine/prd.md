# Task: v1.5: 编排引擎执行（v1.5 - 编排引擎）

## 目标

自动连跑 vs 逐步确认两种执行模式。

## 输入

参考文档（按重要性排序）：
- `docs/spec/01-orchestration.md §6.2`

## 验收标准

- [ ] 类 OrchestrationEngine
- [ ] execute(task: FullTask, mode: 'auto' | 'step_by_step')
- [ ] auto：每步完成自动进下一步
- [ ] step_by_step：每步停下等 UI 'next' 信号
- [ ] step 失败触发 failure_policy
- [ ] 任务级状态写 tasks 表（type='full'）
- [ ] step 级状态写 workflow_steps 表

## 不做

- 无明确排除项（按需收敛）

## 实施提示

用事件驱动 + state machine。

## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): orchestration engine execution"
python3 .trellis/scripts/task.py archive 05-23-v15-orch-engine
```
