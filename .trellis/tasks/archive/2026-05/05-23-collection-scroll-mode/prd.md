# Task: 滚动采集模式（切片 6 - 采集）

## 目标

用户滚动列表页 → 自动按规则保存图片到散图池。

## 输入

参考文档（按重要性排序）：
- `docs/spec/02-collection.md §5`

## 验收标准

- [ ] 脚本捕获 scroll 事件 + 新进入视口的 IMG
- [ ] 找图片所在商品卡片最近的链接（图片卡片链接）
- [ ] 应用过滤规则：
- [ ]   关键词过滤（链接命中则丢弃）
- [ ]   关键词选择（链接命中则保留）
- [ ]   图片尺寸范围（按像素宽高）
- [ ]   关键词过滤优先于选择
- [ ] 保存到 01-采集/散图池/{platform}-{时间戳}-{序号}.jpg
- [ ] 去重保存

## 不做

- 不实现自动翻页（用户手动滚）

## 实施提示

用 IntersectionObserver 检测视口图片。

## 完成后

```bash
git add -A
git commit -m "feat(task): collection scroll mode"
python3 .trellis/scripts/task.py archive 05-23-collection-scroll-mode
```
