# Task: 采集记录和 CSV Manifest（切片 6 - 采集）

## 目标

数据库 collection_records 表 + 会话结束导出 CSV manifest。

## 输入

参考文档（按重要性排序）：
- `docs/spec/02-collection.md §9`

## 验收标准

- [ ] DB schema（已在 spec §9.1 定义）
- [ ] 采集图保存时同步写 record
- [ ] 状态：success / skipped (dedup) / failed (download error)
- [ ] 会话结束自动写 01-采集/{session_id}-manifest.csv
- [ ] CSV 列：sku_code, saved_path, source_url, goods_link, status, file_size, created_at
- [ ] UI 显示最近采集图缩略图 + 状态
- [ ] [失败重试] 按钮：单图重新下载

## 不做

- 不实现历史会话查看（仅当前会话）

## 实施提示

CSV 用 papaparse 写。

## 完成后

```bash
git add -A
git commit -m "feat(task): collection records and manifest"
python3 .trellis/scripts/task.py archive 05-23-collection-records
```
