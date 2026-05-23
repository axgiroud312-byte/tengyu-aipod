# Task: 点击采集模式（切片 6 - 采集）

## 目标

用户点击图片 → 识别商品页 → 低打扰填货号 → 保存原图到对应商品文件夹。

## 输入

参考文档（按重要性排序）：
- `docs/spec/02-collection.md §4`

## 验收标准

- [ ] 脚本回调 → 主进程检查当前页是否商品页（按 platformRule.goods_url_patterns）
- [ ] 商品页 + 该商品已采集过 → 直接归到现有 商品文件夹
- [ ] 商品页 + 首次 → 弹低打扰浮窗（renderer 右下角）请求填货号
- [ ] 非商品页 → 落散图池
- [ ] 下载原图（用 axios + Buffer）
- [ ] 保存路径：01-采集/{货号}/{货号}-{序号}.jpg
- [ ] 去重保存（同位置 hash 一致就跳过）
- [ ] 数据库 collection_records 登记

## 不做

- 不实现批量补填货号（v1.5）

## 实施提示

低打扰浮窗 2 分钟未操作折叠成 toast。

## 完成后

```bash
git add -A
git commit -m "feat(task): collection click mode"
python3 .trellis/scripts/task.py archive 05-23-collection-click-mode
```
