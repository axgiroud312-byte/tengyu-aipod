# Task: v1.5: 编排引擎流程模板（v1.5 - 编排引擎）

## 目标

定义 6 个内置流程模板。

## 输入

参考文档（按重要性排序）：
- `docs/spec/01-orchestration.md §6`

## 验收标准

- [ ] TS const TEMPLATES: PipelineTemplate[]
- [ ] 6 个模板：完整链路 / 从印花开始 / 只生图 / 只上架 / 只套版 / 套版加上架 / 标题加上架（实际 7 个）
- [ ] 每个模板含 steps 数组（module + required + config_defaults）
- [ ] 模板存代码（不上云端，v1.5 简化）

## 不做

- 不实现自定义模板（用户拖拽 DAG，v2）

## 实施提示



## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): orchestration pipeline templates"
python3 .trellis/scripts/task.py archive 05-23-v15-orch-templates
```
