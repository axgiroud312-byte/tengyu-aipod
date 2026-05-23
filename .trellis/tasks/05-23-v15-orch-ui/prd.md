# Task: v1.5: 编排 UI（任务中心）（v1.5 - 编排引擎）

## 目标

任务中心 + 创建串联任务向导。

## 输入

参考文档（按重要性排序）：
- `docs/spec/01-orchestration.md §7`

## 验收标准

- [ ] /modules/tasks 任务中心：Tab（运行中/已完成/失败/全部）
- [ ] 任务列表 + 进度 + 操作（暂停/取消）
- [ ] [+ 创建串联任务] 向导：选模板 + 选每个 step 的参数（按 config_defaults）+ 选执行模式 + 选失败策略
- [ ] 支持批量启动（同一模板 × N 个货号）

## 不做

- 不实现自定义模板编辑器（v2）

## 实施提示

用 shadcn/ui 的 Stepper + Form。

## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): orchestration UI"
python3 .trellis/scripts/task.py archive 05-23-v15-orch-ui
```
