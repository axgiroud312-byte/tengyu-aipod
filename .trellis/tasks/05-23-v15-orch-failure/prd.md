# Task: v1.5: 编排失败策略（v1.5 - 编排引擎）

## 目标

halt / skip / pause 三种失败传播策略。

## 输入

参考文档（按重要性排序）：
- `docs/spec/01-orchestration.md §6.3`

## 验收标准

- [ ] halt（默认）：任一步失败 → 整个任务 failed
- [ ] skip：失败步骤标 failed，继续后续 step
- [ ] pause：失败 → 任务 paused，等用户决定（重试/跳过/取消）
- [ ] UI 上启动任务时选策略
- [ ] 实施位置：OrchestrationEngine.execute 内部判断

## 不做

- 无明确排除项（按需收敛）

## 实施提示



## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): orchestration failure policy"
python3 .trellis/scripts/task.py archive 05-23-v15-orch-failure
```
