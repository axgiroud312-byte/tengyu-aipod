# Task: PS JSX 动态生成器（路径 A）（切片 7 - PS 套版）

## 目标

为每个套版任务组动态生成 JSX 文件（路径 A：placedLayerReplaceContents）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §7`
- `references/photoshop/open-source-references.md`

## 验收标准

- [ ] `generateJsx(job: PhotoshopJob): string`
- [ ] JSX 模板含：打开 PSD / 找 SO（按 layer_path）/ 替换 contents / 多裁切 / 导出 / 关闭
- [ ] 支持多 SO 顺序替换
- [ ] 支持多裁切区域（duplicate + crop + saveAs）
- [ ] 导出格式 JPG/PNG + 质量配置
- [ ] 结果回传通过临时 result.json
- [ ] 错误捕获写到 result.error
- [ ] JSX 路径写 .workbench/tmp/photoshop/{taskId}/job-{N}.jsx

## 不做

- v1 不实现路径 B（嵌套 SO + 对齐缩放，v1.5 见 v15-ps-path-b）

## 实施提示

Action ID 来自 references/photoshop/open-source-references.md。escapeJsxPath 用 JSON.stringify 兜底。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop JSX generator (path A)"
python3 .trellis/scripts/task.py archive 05-23-ps-jsx-generator
```
