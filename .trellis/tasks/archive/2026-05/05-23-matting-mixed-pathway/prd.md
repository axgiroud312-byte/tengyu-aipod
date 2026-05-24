# Task: 抠图混合路径（付费 + ComfyUI）（切片 5 - 生图 ComfyUI）

## 目标

付费 Grsai 生黑白图 → ComfyUI 工作流转遮罩 + 图像混合 → 透明底图。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §7.2`

## 验收标准

- [ ] 输入：任意印花
- [ ] Step 1：调 grsai 用专用「黑白图 skill」生成黑白图，落到 .workbench/tmp/matting/{taskId}/mask.png（临时）
- [ ] Step 2：上传原图 + mask 到 ComfyUI
- [ ] Step 3：跑专门的「黑白图转 alpha + 混合」工作流（category=matting-mixed）
- [ ] Step 4：输出透明底 PNG 落 02-生图/04-抠图/{印花ID}.png
- [ ] 临时 mask.png 完成后立即删（TempFileManager）
- [ ] 数据库登记 provider='grsai+comfyui-mask'

## 不做

- 不允许并行同一个印花的两条抠图路径

## 实施提示

黑白图 skill 由你后台配置；ComfyUI 混合工作流也是云端派发。

## 完成后

```bash
git add -A
git commit -m "feat(task): matting mixed pathway"
python3 .trellis/scripts/task.py archive 05-23-matting-mixed-pathway
```
