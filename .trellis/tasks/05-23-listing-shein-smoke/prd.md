# Task: Shein - smoke 验证（切片 8 - 上架 - Shein）

## 目标

真实 Shein 环境验证。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 同 listing-temu-smoke 但针对 Shein

## 不做

- 无明确排除项（按需收敛）

## 实施提示



## 完成后

```bash
git add -A
git commit -m "test(task): shein manual smoke"
python3 .trellis/scripts/task.py archive 05-23-listing-shein-smoke
```
