# Task: 提取 Grsai UI（切片 4 - 生图 Grsai）

## 目标

提取 Tab + Grsai 实现：选采集图 + 选提取 skill + 调用 LLM 写提取提示词 + 调 Grsai 生白底印花。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §6.2`

## 验收标准

- [ ] 输入：选 01-采集/ 下的源图（多选）
- [ ] Skill 选择（仅显示 category=extract 的）
- [ ] Skill 变量：印花区域偏好 / 是否多印花 / etc.
- [ ] 调 prompt-generator-service 用源图作为参考图
- [ ] 对每张源图生 N 个提取提示词 → 用每个 prompt + 源图调 grsai 图生图
- [ ] 输出落到 02-生图/03-提取/{印花ID}.png
- [ ] 数据库 artifacts 表登记 step=extract + provider=grsai + source_artifact_ids=[源图id]

## 不做

- 无明确排除项（按需收敛）

## 实施提示

提取本质是带提取 skill 的图生图，复用 img2img-grsai-ui 的底层组件。

## 完成后

```bash
git add -A
git commit -m "feat(task): extract grsai UI"
python3 .trellis/scripts/task.py archive 05-23-extract-grsai-ui
```
