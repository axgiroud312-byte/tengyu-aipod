# Task: Temu PopTemu - action-executor.ts（切片 8 - 上架 - Temu PopTemu）

## 目标

Temu PopTemu 的动作执行器（按 parser 输出执行 + 验证 target_state）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.3`

## 验收标准

- [ ] 导出函数：fillTitle / fillSku / uploadMaterialImages / processColorSkc / generateSkuCode / submitPublish / etc.
- [ ] 每个函数：1) parse 当前状态 2) 重新定位元素 3) 执行 4) 重新 parse 验证 target_state
- [ ] 失败抛 ListingActionError 含 action/state/selector/URL/page_text + 证据路径
- [ ] ElementHandle 不跨 stage 复用
- [ ] 上传图片用 page.setInputFiles

## 不做

- 不实现工作流编排（留 workflow.ts）

## 实施提示

前置状态校验 + 后置状态校验是核心，**不接受按钮能点就算成功**。

## 完成后

```bash
git add -A
git commit -m "feat(task): temu pop action executor"
python3 .trellis/scripts/task.py archive 05-23-listing-temu-executor
```
