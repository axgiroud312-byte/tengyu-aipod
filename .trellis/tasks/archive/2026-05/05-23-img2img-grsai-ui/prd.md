# Task: 图生图 Grsai UI（5 种生成方式）（切片 4 - 生图 Grsai）

## 目标

图生图 Tab + Grsai 的 5 种生成方式：纯文字 / 参考构图 / 参考风格 / 构图+风格 / 自己写。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §5`

## 验收标准

- [ ] 5 种模式 toggle button（互斥）
- [ ] 上传参考图（多张支持，base64 缓存）
- [ ] 调 LLM 时按模式拼不同 user message：
- [ ]   纯文字：refImages = []
- [ ]   参考构图：refImages + 'Use only layout structure'
- [ ]   参考风格：refImages + 'Use only art style'
- [ ]   构图+风格：refImages + 'Use both layout and style'
- [ ]   自己写：跳过 LLM
- [ ] 5 种模式 UI 都重用 txt2img 的提示词审稿组件
- [ ] 生图模型默认 nano-banana-2（图生图友好）

## 不做

- v1 UI 不暴露「真 img2img」（参考图喂生图模型）选项（spec §5.3 留接口）

## 实施提示

5 种模式只是 LLM prompt 拼法不同，最终都调 grsai 文生图。

## 完成后

```bash
git add -A
git commit -m "feat(task): img2img grsai UI with 5 modes"
python3 .trellis/scripts/task.py archive 05-23-img2img-grsai-ui
```
