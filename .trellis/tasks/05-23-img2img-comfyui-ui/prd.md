# Task: 图生图 ComfyUI UI（切片 5 - 生图 ComfyUI）

## 目标

图生图 Tab + ComfyUI Provider：选印花（已提取）+ 选图生图工作流 + 跑。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §5

## 验收标准

- [ ] 输入：02-生图/01-提取 或 02-文生图 或外部导入的印花（拒绝 01-采集 原图）
- [ ] 选 ComfyUI 工作流（仅显示 category=img2img）
- [ ] [开始图生图]：跑工作流
- [ ] 产物落 02-生图/02-图生图/{印花ID}_v{n}.png
- [ ] 数据库登记 source_artifact_ids 含输入印花 id

## 不做

- 无明确排除项（按需收敛）

## 实施提示

工作流 input_slots 应包含一个 image 类型槽接收印花。

## 完成后

```bash
git add -A
git commit -m "feat(task): img2img comfyui UI"
python3 .trellis/scripts/task.py archive 05-23-img2img-comfyui-ui
```
