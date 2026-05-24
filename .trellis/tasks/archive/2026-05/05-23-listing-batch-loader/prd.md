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
- [ ] **v1 MVP 必须能跑通以下 3 个真实素材根目录**（用真实文件 + 真实结构断言）

## 真实测试基线（MVP v1）

v1 MVP 用以下 3 个真实素材根目录测试，禁止 fixture：

| 模板 | 素材根目录 | 备注 |
|---|---|---|
| Temu 服装 | `/Users/macmini/Desktop/服装素材摆放举例` | **排除 `GzG00010` 子目录** |
| Temu 百货 | `/Users/macmini/Desktop/素材文件夹` | 全部加载 |
| Shein | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` | 只这一个货号 |

排除规则要可配置（不要把 `GzG00010` 写死，但要在 v1 默认配置里排除）。

测试守护：素材路径扫描是纯文件读写，**无需 REAL_LISTING 守护**，可在沙箱里直接跑（路径存在的话）。

参考：`/Users/macmini/Desktop/一键pod/上架程序` 的素材组织规则。

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
