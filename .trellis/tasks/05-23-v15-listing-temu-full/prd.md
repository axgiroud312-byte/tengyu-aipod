# Task: v1.5: Temu Full 上架（v1.5 - 上架）

## 目标

Temu Full（半托管）的四层实现。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 完整四层 + smoke

## 不做

- 无明确排除项（按需收敛）

## 实施提示

Temu Full 与 PopTemu 字段不同。

## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): temu full listing"
python3 .trellis/scripts/task.py archive 05-23-v15-listing-temu-full
```
