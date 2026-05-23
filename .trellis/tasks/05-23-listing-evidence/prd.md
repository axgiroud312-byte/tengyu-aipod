# Task: 上架证据保存（切片 8 - 上架）

## 目标

每 stage 保存截图 + DOM 快照到 .workbench/tmp/listing/{taskId}/evidence/。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §10`

## 验收标准

- [ ] 工具 `saveStageEvidence(page, stage, result)`
- [ ] 保存：screenshot.png / dom.html / state.json
- [ ] 路径：.workbench/tmp/listing/{taskId}/evidence/{profileId}/{skuCode}/stage-{NN}-{stage}/
- [ ] 失败时优先保存（用户调试用）
- [ ] 成功也保存（24 小时后由 TempFileManager 清理）
- [ ] v1.5 可加「成功保留 7 天」配置

## 不做

- 无明确排除项（按需收敛）

## 实施提示

DOM 快照用 page.content()，截图用 page.screenshot()。

## 完成后

```bash
git add -A
git commit -m "feat(task): listing evidence storage"
python3 .trellis/scripts/task.py archive 05-23-listing-evidence
```
