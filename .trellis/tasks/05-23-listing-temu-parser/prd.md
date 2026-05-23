# Task: Temu PopTemu - page-parser.ts（切片 8 - 上架 - Temu PopTemu）

## 目标

Temu PopTemu 页面状态解析器（读 DOM 返 observed_state）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.2`

## 验收标准

- [ ] `parseDraftPage(page): DraftPageState`
- [ ] 返回结构：url / page_title / shop_context / is_login_required / is_loading / is_blocking_modal / title_field / material_section / publish_button etc.
- [ ] 每个字段都基于真实 DOM 查询
- [ ] 不传 ElementHandle 出来（只传数据）
- [ ] 支持失败容错（找不到元素返回 found=false）

## 不做

- 不执行任何动作（只读不写）

## 实施提示

ElementHandle 短暂使用后丢弃（避免页面 reload 失效）。

## 完成后

```bash
git add -A
git commit -m "feat(task): temu pop page parser"
python3 .trellis/scripts/task.py archive 05-23-listing-temu-parser
```
