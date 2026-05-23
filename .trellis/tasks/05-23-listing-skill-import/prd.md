# Task: Import listing-automation-builder SKILL（切片 8 - 上架（强制第一步））

## 目标

把 `一键pod/上架程序/.agents/skills/listing-automation-builder/SKILL.md` 复制到腾域 `.agents/skills/`，作为开发上架代码的方法论宪法。

## 输入

参考文档（按重要性排序）：
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `docs/spec/07-listing.md §2`

## 验收标准

- [ ] 复制 SKILL.md 到 .agents/skills/listing-automation-builder/SKILL.md
- [ ] 确认 .claude/skills/.cursor/skills/.codex/skills 也有副本（如果框架要求）
- [ ] 在 CLAUDE.md 顶部声明：开发上架模块时必须加载此 SKILL
- [ ] 在切片 8 的所有 listing 类 task 的 prd.md 都引用此 SKILL（已 done）
- [ ] commit

## 不做

- 不实现任何上架代码（这只是导入方法论）

## 实施提示

用 cp 命令：cp -r /Users/macmini/Desktop/一键pod/上架程序/.agents/skills/listing-automation-builder/ .agents/skills/

## 完成后

```bash
git add -A
git commit -m "chore(task): import listing-automation-builder SKILL"
python3 .trellis/scripts/task.py archive 05-23-listing-skill-import
```
