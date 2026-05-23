# Task: 侵权检测阈值与 Skill 配置 UI（切片 3 - 侵权检测）

## 目标

UI 上让用户配置 0-100 风险三档阈值 + 检测 skill 的输入变量（关注重点、输出依据等）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/04-detection.md §2, §4.1`

## 验收标准

- [ ] 阈值条 UI：两个 slider 划分 pass/review/block（默认 40, 70）
- [ ] 改阈值后历史结果不重新分类（数据库存的是 score 不是 level，UI 实时按当前阈值算）
- [ ] Skill 输入变量动态渲染（按 skill.variables）
- [ ] 包含：模型选择（flash/plus/max）+ 关注重点 multi-select + 输出依据 checkbox + 自定义关键词 textarea
- [ ] 配置保存到 `.workbench/db` 的 `detection_config` 表（单行）

## 不做

- 不实现批量调整历史结果级别

## 实施提示

skill.variables 的 type 字段用 switch 渲染不同控件。

## 完成后

```bash
git add -A
git commit -m "feat(task): detection thresholds and skill config UI"
python3 .trellis/scripts/task.py archive 05-23-detection-thresholds
```
