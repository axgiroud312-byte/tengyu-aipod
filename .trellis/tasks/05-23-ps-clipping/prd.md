# Task: PS 裁切策略（切片 7 - PS 套版）

## 目标

三种裁切模式：none / auto / guides。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §4.3`

## 验收标准

- [ ] `deriveClipAreas(scanResult, mode): ClipArea[]`
- [ ] none → 单一全图 area
- [ ] guides → 按参考线划分网格
- [ ] auto → 优先 guides，无参考线 fallback 到 SO 祖先 bounds
- [ ] 无参考线无 SO 祖先 fallback 到 none
- [ ] 返回的 area 含 x/y/w/h
- [ ] JSX 用 duplicate + crop + saveAs 实现

## 不做

- 不实现自定义裁切区域 UI（v1.5）

## 实施提示

guides 网格：水平参考线 + 垂直参考线 cross 出格子。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop clipping strategy"
python3 .trellis/scripts/task.py archive 05-23-ps-clipping
```
