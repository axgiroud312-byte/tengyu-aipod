# Task: Admin ComfyUI 工作流管理 UI（切片 5 - 生图 ComfyUI）

## 目标

`/admin/comfyui-workflows` CRUD + 上传 JSON。

## 输入

参考文档（按重要性排序）：
- `docs/spec/08-server.md §6.9`

## 验收标准

- [ ] 表格列出所有工作流（ID / 分类 / 版本 / 推荐 Pod 关键词 / 最小显存 / 启用）
- [ ] [+ 上传新工作流]：选 JSON 文件 + 填元数据
- [ ] 上传时自动解析 workflow.json 提取候选 input_slots（含 image 节点）
- [ ] Input/output slots 用 JSON editor 可调
- [ ] [编辑] / [下载 JSON] / [禁用]
- [ ] 支持版本管理（同 skill）

## 不做

- 不实现 workflow 在线编辑（v1.5+）
- 不实现自动测试 workflow 是否可跑

## 实施提示

解析 workflow.json 时识别 input image 节点（LoadImage 类）和 output 节点（SaveImage 类）。

## 完成后

```bash
git add -A
git commit -m "feat(task): admin comfyui workflow management UI"
python3 .trellis/scripts/task.py archive 05-23-admin-workflows-ui
```
