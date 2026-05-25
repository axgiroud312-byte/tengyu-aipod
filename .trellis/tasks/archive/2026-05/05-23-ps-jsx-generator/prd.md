# Task: PS JSX 动态生成器（路径 A）（切片 7 - PS 套版）

## 目标

为每个套版任务组动态生成 JSX 文件（路径 A：placedLayerReplaceContents）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §7`
- `references/photoshop/open-source-references.md`

## 本机真实环境约束

- Windows 10/11 + Photoshop 2023+；当前主理人已打开 Photoshop，后续执行类 task 必须通过真实 Photoshop COM。
- 真实 PSD 模板占位：
  - `C:\Users\niilo\Desktop\钥匙扣x.psd`
  - `C:\Users\niilo\Desktop\mao 杯子.psd`
- 真实印花素材目录：通过 `process.env.PS_MATERIAL_ROOT` 读取，主理人本机为 `C:\Users\niilo\Desktop\印花素材`。
- 输出根目录：通过 `process.env.PS_OUTPUT_ROOT` 读取，主理人本机为 `C:\Users\niilo\Desktop\新建文件夹`。
- `REAL_PS=1` 启用真实 Photoshop/COM 测试；`REAL_PS_MUTATE=1` 作为会覆盖输出或关闭未保存文档等破坏性操作的二级守护。
- 本 task 只生成 JSX 字符串和 JSX 临时路径，不主动执行 COM；执行类后续 task 必须在 Windows 本机用真实 Photoshop 验证。
- 禁止程序自动 quit Photoshop。

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
