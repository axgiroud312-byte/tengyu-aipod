# Task: 上架批次加载器（切片 8 - 上架）

## 目标

扫 `05-货号成品/{batch}/` 转 ListingItem[]。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §5`

## 验收标准

- [ ] `loadBatchAsListingItems(batchDir): { items, warnings }`
- [ ] 读 titles.xlsx 拿货号-标题映射
- [ ] 扫一级子目录（货号文件夹）
- [ ] 排序图片（自然排序）作为 material_image_paths
- [ ] 缺标题 / 缺图 → warnings + 跳过
- [ ] 返回 items[] 给 runner 用

## 不做

- 不实现图片角色分配（v1 都作为 material/轮播图）

## 实施提示

v1.5 可以加 UI 让用户调整图片角色（轮播 / 详情 / SKC）。

## 完成后

```bash
git add -A
git commit -m "feat(task): listing batch loader"
python3 .trellis/scripts/task.py archive 05-23-listing-batch-loader
```
