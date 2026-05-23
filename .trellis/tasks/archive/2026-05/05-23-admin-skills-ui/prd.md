# Task: Admin Skill 管理 UI（切片 2 - 标题生成模块）

## 目标

`/admin/skills` 列表 + 编辑 + 版本管理 + 启用/禁用。

## 输入

参考文档（按重要性排序）：
- `docs/spec/08-server.md §6.7`

## 验收标准

- [ ] /admin/skills 表格：ID / 模块 / 分类 / 平台-语言 / 当前版本 / 推荐模型 / 启用 / 操作
- [ ] 模块筛选下拉（generation / detection / title）
- [ ] [编辑] 按钮 → 表单：system_prompt (textarea + markdown 预览) + variables (JSON editor) + recommended_model + enabled
- [ ] [保存为新版本] 自动 +0.0.1；[覆盖当前版本] 直接修改
- [ ] [版本历史] 按钮 → 显示该 skill 所有历史版本
- [ ] [新建 Skill] 表单（含智能默认值，按 module/category 给模板）
- [ ] 所有变更 commit 时记录到 audit_log（可选 v1.5）

## 不做

- 不实现批量导入/导出（v1.5）
- 不实现 skill diff 比较

## 实施提示

JSON editor 用 `react-codemirror` + JSON 模式。variables 字段也用 JSON editor 让你随意定义。

## 完成后

```bash
git add -A
git commit -m "feat(task): admin skill management UI"
python3 .trellis/scripts/task.py archive 05-23-admin-skills-ui
```
