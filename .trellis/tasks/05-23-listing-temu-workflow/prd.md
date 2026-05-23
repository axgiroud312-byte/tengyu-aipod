# Task: Temu PopTemu - workflow.ts（12 阶段状态机）（切片 8 - 上架 - Temu PopTemu）

## 目标

Temu PopTemu 的业务工作流：12 阶段顺序推进。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.4`

## 验收标准

- [ ] 导出 `runListingItem(page, item, config): Promise<ListingResult>`
- [ ] 12 个 stage：enter_page / page_ready / confirm_shop_context / fill_title_and_sku / upload_material_images / upload_video / process_color_skc / reuse_size_chart / generate_sku_code / process_description / submit_publish / publish_result
- [ ] 每 stage 调 action-executor 对应函数
- [ ] 每 stage 完成保存证据（截图 + DOM）
- [ ] stage 失败抛错让 runner 决定重试
- [ ] 返回 stages 数组（用于诊断）

## 不做

- 不实现选择器云端派发（v1.5）

## 实施提示

12 阶段顺序固定。某些 stage（upload_video / process_description）按 config 决定是否跑。

## 完成后

```bash
git add -A
git commit -m "feat(task): temu pop workflow (12 stages)"
python3 .trellis/scripts/task.py archive 05-23-listing-temu-workflow
```
