# Task: 侵权检测前端 UI（切片 3 - 侵权检测）

## 目标

批量检测的 UI：输入选择 + 设置 + 进度 + 结果列表。

## 输入

参考文档（按重要性排序）：
- `docs/spec/04-detection.md §6`

## 验收标准

- [ ] 输入选择：全选 02-生图/03-提取 / 04-抠图 / 手动勾选缩略图 / 拖入外部
- [ ] 检测设置：模型 / skill / 阈值 / 关注重点 / 并发 / 预处理
- [ ] 预估费用实时显示
- [ ] [开始检测] → 进度面板（并发显示当前 N/M）
- [ ] 结果列表：缩略图 / 风险值（彩色）/ 等级 / 依据 / 操作（[移动][重测][删除]）
- [ ] 按风险值降序排序
- [ ] 顶部统计：pass/review/block/failed 数
- [ ] [一键加入待套版] [导出 CSV]

## 不做

- 不实现高级筛选（按依据关键词）

## 实施提示

缩略图网格用虚拟滚动（react-window）防止大量图卡死。

## 完成后

```bash
git add -A
git commit -m "feat(task): detection module UI"
python3 .trellis/scripts/task.py archive 05-23-detection-module-ui
```
