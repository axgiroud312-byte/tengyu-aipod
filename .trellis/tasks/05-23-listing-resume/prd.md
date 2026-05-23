# Task: 上架断点续传（切片 8 - 上架）

## 目标

listing_status 表 + 启动时跳过 success 货号。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §9`

## 验收标准

- [ ] listing_status 表 schema（spec §9）
- [ ] 每个 listing 处理前查表：success → 跳过
- [ ] 处理中标 uploading；完成标 success；失败标 failed
- [ ] [启用断点续传] toggle UI
- [ ] 重试失败：仅重试 status=failed
- [ ] evidence 保留路径写到 status 行

## 不做

- 无明确排除项（按需收敛）

## 实施提示

Unique key: (batch_path, sku_code, platform, workspace_id)。

## 完成后

```bash
git add -A
git commit -m "feat(task): listing resume from checkpoint"
python3 .trellis/scripts/task.py archive 05-23-listing-resume
```
