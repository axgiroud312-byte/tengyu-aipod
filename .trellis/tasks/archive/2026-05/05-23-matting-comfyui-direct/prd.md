# Task: ComfyUI 直接抠图（切片 5 - 生图 ComfyUI）

## 目标

抠图 Tab + ComfyUI 直接抠图工作流（BiRefNet / RMBG）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §7.1`

## 验收标准

- [ ] 输入：02-生图 任一目录的印花 或外部导入
- [ ] 选 ComfyUI 抠图工作流（category=matting）
- [ ] 跑工作流输出透明底 PNG
- [ ] 产物落 02-生图/04-抠图/{印花ID}.png
- [ ] 进度面板

## 不做

- 无明确排除项（按需收敛）

## 实施提示

抠图工作流通常 5-30 秒一张，单实例串行处理。

## 完成后

```bash
git add -A
git commit -m "feat(task): matting comfyui direct"
python3 .trellis/scripts/task.py archive 05-23-matting-comfyui-direct
```
