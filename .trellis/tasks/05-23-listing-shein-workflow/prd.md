# Task: Shein - workflow.ts（切片 8 - 上架 - Shein）

## 目标

Shein 业务工作流。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 按真实 Shein 草稿流程定义 stages（可能不同于 Temu 的 12 个）

## 不做

- 无明确排除项（按需收敛）

## 实施提示

侦察确定 stage 列表后再写。

## 完成后

```bash
git add -A
git commit -m "feat(task): shein workflow"
python3 .trellis/scripts/task.py archive 05-23-listing-shein-workflow
```
