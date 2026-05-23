# Task: v1.5: PS 路径 B（嵌套 SO + 对齐缩放）（v1.5 - PS 套版）

## 目标

实现路径 B：进入 SO 编辑 + Plc 置入 + align + resize。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §17`
- `references/photoshop/open-source-references.md`

## 验收标准

- [ ] JSX 实现：placedLayerEditContents 进入 SO + flattenImage 拍平 + Plc 置入 + 退出保存
- [ ] 支持 nestedTarget（SO 内套 SO 递归）
- [ ] 支持 align（middle-center / top-left / etc.）
- [ ] 支持 resize（fit / fill / none）
- [ ] 支持 trimTransparency
- [ ] UI 上启用 fill / center 适配模式（v1 仅 fit）
- [ ] PSD 扫描识别共享 SO 时启用单次替换全部生效

## 不做

- 无明确排除项（按需收敛）

## 实施提示

参考 joonaspaakko 项目实现。

## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): photoshop path B (nested + align + resize)"
python3 .trellis/scripts/task.py archive 05-23-v15-ps-path-b
```
