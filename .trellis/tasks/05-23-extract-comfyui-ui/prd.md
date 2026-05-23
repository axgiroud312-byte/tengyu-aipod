# Task: 提取 ComfyUI UI（切片 5 - 生图 ComfyUI）

## 目标

提取 Tab + ComfyUI Provider：选源图 + 选提取工作流 + 跑。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §6.1`

## 验收标准

- [ ] 选 01-采集/ 下的源图（多选）
- [ ] 选 ComfyUI 工作流（仅显示 category=extract）
- [ ] 实例就绪检查（未就绪 → 跳到 instance manager 创建）
- [ ] [开始提取]：对每张源图跑工作流
- [ ] 进度面板（按图数）
- [ ] 产物落 02-生图/03-提取/

## 不做

- 无明确排除项（按需收敛）

## 实施提示

工作流列表来自 client-skill-cache（也缓存 workflow metadata）。

## 完成后

```bash
git add -A
git commit -m "feat(task): extract comfyui UI"
python3 .trellis/scripts/task.py archive 05-23-extract-comfyui-ui
```
