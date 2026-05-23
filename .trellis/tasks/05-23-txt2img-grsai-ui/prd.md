# Task: 文生图 Grsai UI（切片 4 - 生图 Grsai）

## 目标

文生图 Tab + Grsai Provider 的双模式 UI（AI 生提示词 / 自己写）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §4`

## 验收标准

- [ ] 模式切换 Tab：AI 模式 / 自己写
- [ ] AI 模式：印花类型（局部/满印）+ 提示词数量 + 印花要求 + Skill 选择 + LLM 选择
- [ ] [生成提示词] 按钮 → 调 prompt-generator-service
- [ ] 提示词审稿：勾选 + 编辑 + 添加自定义
- [ ] 生图设置：生图模型 / 比例 / 分辨率 / 并发
- [ ] [开始生图] → 调 grsai-adapter
- [ ] 进度面板
- [ ] 自己写模式：textarea 每行一条 或 JSON 数组 → 跳过 LLM 直接生图

## 不做

- 不实现历史提示词复用

## 实施提示

审稿 UI 用 react-hook-form + field array。

## 完成后

```bash
git add -A
git commit -m "feat(task): txt2img grsai UI"
python3 .trellis/scripts/task.py archive 05-23-txt2img-grsai-ui
```
