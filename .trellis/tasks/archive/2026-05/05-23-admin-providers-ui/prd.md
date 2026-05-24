# Task: Admin Provider 管理 UI（切片 4 - 生图 Grsai）

## 目标

`/admin/providers` CRUD UI。

## 输入

参考文档（按重要性排序）：
- `docs/spec/08-server.md §6.8`

## 验收标准

- [ ] 表格：ID / 名称 / 类型 / API Style / Base URL / 启用 / 操作
- [ ] [新建 Provider] 表单：含所有字段
- [ ] endpoints/model_options/default_params 用 JSON editor
- [ ] capabilities 多选（txt2img/img2img/extract/matting）
- [ ] [编辑] / [禁用] / [排序]
- [ ] 改动立即生效（客户端 30 分钟内拉到）

## 不做

- 不允许删除有历史调用记录的 Provider（仅禁用）

## 实施提示

default_params 给出每种 api_style 的示例 placeholder 帮你填。

## 完成后

```bash
git add -A
git commit -m "feat(task): admin provider management UI"
python3 .trellis/scripts/task.py archive 05-23-admin-providers-ui
```
