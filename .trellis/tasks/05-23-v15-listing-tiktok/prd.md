# Task: v1.5: TikTok Shop 上架（v1.5 - 上架）

## 目标

TikTok Shop 平台的四层实现（selectors/parser/executor/workflow）。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 完整四层 + smoke 测试，按 listing-automation-builder SKILL 规范

## 不做

- 禁止抄 Temu/Shein 的 selectors

## 实施提示

TikTok Shop 草稿页结构与其他不同，独立侦察。

## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): tiktok shop listing"
python3 .trellis/scripts/task.py archive 05-23-v15-listing-tiktok
```
