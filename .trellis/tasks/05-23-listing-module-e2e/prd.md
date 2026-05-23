# Task: 上架模块 E2E（切片 8 - 上架）

## 目标

Temu + Shein 各跑一遍真实上架验证。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 准备：测试货号批次（5 个货号）
- [ ] 准备：店小秘 Temu 测试模板 + Shein 测试模板
- [ ] 跑 Temu：5/5 success（保存草稿模式）
- [ ] 跑 Shein：5/5 success
- [ ] 验证：断点续传（中断后再跑跳过 success）
- [ ] 验证：连续失败暂停（mock 5 次失败触发）
- [ ] 把验证记录写到 .trellis/tasks/05-23-listing-module-e2e/info.md

## 不做

- 不真发布到平台（保存草稿即可）

## 实施提示

手动测试，记录每个 stage 截图。

## 完成后

```bash
git add -A
git commit -m "test(task): listing module manual e2e"
python3 .trellis/scripts/task.py archive 05-23-listing-module-e2e
```
