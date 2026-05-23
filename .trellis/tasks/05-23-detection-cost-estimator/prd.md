# Task: 检测费用预估器（切片 3 - 侵权检测）

## 目标

UI 上根据图数 × 模型 × 是否压缩实时显示预估费用。

## 输入

参考文档（按重要性排序）：
- `docs/spec/04-detection.md §12`

## 验收标准

- [ ] 函数 `estimateDetectionCost(imageCount, model, withCompression)`
- [ ] 按 spec §12 的公式实现
- [ ] UI 用 useMemo 实时计算
- [ ] 显示格式：`预估 ¥0.04（启用压缩）` 或 `¥0.15（未压缩）`
- [ ] 余额 < 预估 × 1.5 时红色警告

## 不做

- 不实际查百炼余额（百炼没有公开余额 API）

## 实施提示

把单价配置放 shared/constants.ts 方便统一改。

## 完成后

```bash
git add -A
git commit -m "feat(task): detection cost estimator"
python3 .trellis/scripts/task.py archive 05-23-detection-cost-estimator
```
