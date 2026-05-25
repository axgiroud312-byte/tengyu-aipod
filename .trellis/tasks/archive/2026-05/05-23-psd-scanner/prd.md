# Task: PSD 模板扫描器（切片 7 - PS 套版）

## 目标

动态生成扫描 JSX → 跑 PS → 读结果 JSON → 缓存到数据库。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §3`
- `docs/spec/05-photoshop.md §13-14`
- `docs/adr/0007-photoshop-windows-only-v1.md`
- `docs/adr/0008-temp-file-manager-and-cleanup.md`

## 本机真实环境

- Windows + Photoshop：主理人 Windows 本机，Photoshop 已打开，真实 COM 版本读取为 `27.7.0`。
- 真实 PSD 模板：
  - `C:\Users\niilo\Desktop\钥匙扣x.psd`
  - `C:\Users\niilo\Desktop\mao 杯子.psd`
- 印花素材根目录：通过 `process.env.PS_MATERIAL_ROOT` 读取，当前本机路径为 `C:\Users\niilo\Desktop\印花素材`，不要 hardcode 到业务逻辑。
- 输出根目录：通过 `process.env.PS_OUTPUT_ROOT` 读取，当前本机路径为 `C:\Users\niilo\Desktop\新建文件夹`。
- 真实 Photoshop 测试守护：
  - `REAL_PS=1` 才运行真实 Photoshop / COM 扫描测试。
  - `REAL_PS_MUTATE=1` 才允许覆盖输出文件或关闭未保存测试文档。
  - 本 task 扫描 PSD 会打开模板并由扫描 JSX 关闭自己打开的 PSD 且不保存；禁止程序 quit Photoshop。

## 平台与分层约束

- Photoshop COM 调用只允许在 Electron 主进程。
- Windows-only 逻辑必须用 `process.platform === 'win32'` 守护；非 Windows 通过 `AppError` 优雅失败，不能因为 COM / Windows 依赖 import 失败导致 build 挂掉。
- JSX 临时文件、扫描结果 JSON 必须写入 `.workbench/tmp/photoshop/{taskId}/`，不要污染 01-05 业务目录。
- 缓存写入本地 `.workbench/workbench.db` 的 `psd_templates` 表；同一 PSD hash 命中时直接返回缓存。

## 验收标准

- [ ] `scanPsd(psdPath) → PsdTemplate`
- [ ] 按 hash 缓存（PSD 文件 hash 不变则用缓存）
- [ ] 动态生成 JSX 写临时文件 + 调 PS COM 跑 + 读结果 JSON
- [ ] 扫描结果含：smart_objects (name/path/is_top_level/bounds/shared_indicator) / guides / clip_areas / doc_size / mode
- [ ] 嵌套 SO 检测（递归遍历 LayerSet）
- [ ] 共享 SO 检测（简化版：bounds + name 哈希）
- [ ] 数据库 psd_templates 表存缓存
- [ ] vitest 单测（mock JSX 结果）

## 不做

- 不实现 PSB 完整解析（v1 跟 PSD 一样）
- 不实现 3D 图层支持

## 实施提示

结果 JSON 通过 .workbench/tmp/photoshop/{taskId}/scan-result.json 回传。

## 完成后

```bash
git add -A
git commit -m "feat(task): psd template scanner"
python3 .trellis/scripts/task.py archive 05-23-psd-scanner
```
