# Task: PS 套版前端 UI（切片 7 - PS 套版）

## 目标

套版模块的 UI（状态栏 + 输入选择 + 配置 + 进度 + 预览）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §6.3`

## 验收标准

- [ ] Mac 上显示灰显提示
- [ ] Windows 上顶部状态栏（installed/running/COM + 修复按钮）
- [ ] 印花文件夹选择（默认 04-待套版印花/）
- [ ] 模板多选（用户选 N 个 PSD/PSB）
- [ ] 替换范围（auto/top/all）/ 适配方式（仅 fit v1）/ 裁切模式 / 导出格式
- [ ] [跳过已完成] / 失败重试次数
- [ ] [开始套版] → 进度面板
- [ ] 完成后右侧缩略图网格 + 双击打开

## 不做

- v1 适配方式仅 fit

## 实施提示

模板多选用 shadcn/ui 的 Combobox + multiple。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop module UI"
python3 .trellis/scripts/task.py archive 05-23-ps-module-ui
```
