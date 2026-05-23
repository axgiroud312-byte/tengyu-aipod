# Task: Shein - selectors.ts（切片 8 - 上架 - Shein）

## 目标

Shein 平台的选择器表。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.1`

## 验收标准

- [ ] 同 temu-selectors 但针对 Shein 草稿页

## 不做

- 禁止抄 temu 的 selectors（独立侦察）

## 实施提示

Shein 草稿页结构与 Temu 不同，工作流 stage 也可能不同。

## 完成后

```bash
git add -A
git commit -m "feat(task): shein selectors"
python3 .trellis/scripts/task.py archive 05-23-listing-shein-selectors
```
