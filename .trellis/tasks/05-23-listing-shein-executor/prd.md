# Task: Shein - action-executor.ts（切片 8 - 上架 - Shein）

## 目标

Shein 动作执行器。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 同 temu-executor

## 不做

- 无明确排除项（按需收敛）

## 实施提示

Shein 上传逻辑可能与 Temu 不同（如必须按颜色组分批上传）。

## 完成后

```bash
git add -A
git commit -m "feat(task): shein action executor"
python3 .trellis/scripts/task.py archive 05-23-listing-shein-executor
```
