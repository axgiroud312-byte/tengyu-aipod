# Task: 上架失败列表和重试（切片 8 - 上架）

## 目标

失败列表 UI + [重试失败] 按钮。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 执行完成显示失败列表：货号 / 错误码 / 错误消息
- [ ] [查看证据] 链接打开 .workbench/tmp/listing/{taskId}/evidence/...
- [ ] [重试该货号] 单条重试
- [ ] [全部重试失败] 批量重试
- [ ] 重试时查 listing_status 只跑 failed

## 不做

- 无明确排除项（按需收敛）

## 实施提示

证据路径打开用 shell.openPath。

## 完成后

```bash
git add -A
git commit -m "feat(task): listing failure list and retry UI"
python3 .trellis/scripts/task.py archive 05-23-listing-failure-retry
```
