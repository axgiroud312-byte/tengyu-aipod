# Task: Admin 平台规则管理 UI（切片 6 - 采集）

## 目标

`/admin/platform-rules` CRUD。

## 输入

参考文档（按重要性排序）：
- `docs/spec/02-collection.md §6`

## 验收标准

- [ ] 表格：key / 名称 / 类别 / 版本 / 启用
- [ ] [编辑] 表单：rules_json 用 JSON editor
- [ ] category 选择（collection / listing）
- [ ] 新建时给出 collection 和 listing 的模板
- [ ] 改动立即生效

## 不做

- 不在 admin 实测规则（用户自己在客户端测）

## 实施提示

可以加「复制现有规则」按钮方便建变体。

## 完成后

```bash
git add -A
git commit -m "feat(task): admin platform rules UI"
python3 .trellis/scripts/task.py archive 05-23-admin-platform-rules-ui
```
