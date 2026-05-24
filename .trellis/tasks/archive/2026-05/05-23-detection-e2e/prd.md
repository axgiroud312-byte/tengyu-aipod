# Task: 检测模块 E2E 测试（切片 3 - 侵权检测）

## 目标

Playwright E2E 完整检测流程。

## 输入

参考文档（按重要性排序）：
- `docs/spec/04-detection.md §14`

## 验收标准

- [ ] Mock 输入：10 张测试图（透明底 + 不透明）
- [ ] Mock 百炼返回不同 score（覆盖三档）
- [ ] 断言：图正确分类到 pass/review/block
- [ ] 断言：预处理产物在 tmp 用完即删
- [ ] 断言：透明底图正确加白
- [ ] 断言：失败重试机制

## 不做

- 无明确排除项（按需收敛）

## 实施提示

Mock 百炼用 msw。准备 fixture 图片用 sharp 生成。

## 完成后

```bash
git add -A
git commit -m "feat(task): detection module e2e tests"
python3 .trellis/scripts/task.py archive 05-23-detection-e2e
```
