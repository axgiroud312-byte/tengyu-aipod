# Task: 生图模块骨架（切片 4 - 生图 Grsai）

## 目标

统一生图模块的 4 Tab 骨架（文生图/图生图/提取/抠图），每 Tab 内有 Provider 切换。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §1`

## 验收标准

- [ ] 页面 `/modules/generation`
- [ ] 顶部 Tab 切换：文生图 / 图生图 / 提取 / 抠图
- [ ] 每 Tab 内顶部 Provider 切换：付费（grsai）/ comfyui-chenyu
- [ ] 切换 Provider 自动展示对应表单（占位）
- [ ] Tab 间状态独立（用 Zustand store 按 Tab 分 slice）
- [ ] 实现矩阵约束（spec §1.1）：文生图无 comfyui、抠图无 grsai 等
- [ ] 未匹配组合时显示「不可用」提示

## 不做

- 不实现具体 Tab 业务逻辑（留各自 task）

## 实施提示

Provider 列表来自 client-skill-cache（虽然名字是 skill cache 但也缓存 provider）—— 复用其拉取机制。

## 完成后

```bash
git add -A
git commit -m "feat(task): generation module skeleton"
python3 .trellis/scripts/task.py archive 05-23-generation-skeleton
```
