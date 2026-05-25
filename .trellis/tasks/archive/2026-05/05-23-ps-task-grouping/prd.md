# Task: PS 任务分组（切片 7 - PS 套版）

## 目标

按代表 SO 数把印花分组，每组对应一个套版任务。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §5`

## 本机真实环境约束

- Windows 10/11 + Photoshop 2023+；当前主理人已打开 Photoshop，后续执行类 task 必须通过真实 Photoshop COM。
- 真实 PSD 模板占位：
  - `C:\Users\niilo\Desktop\钥匙扣x.psd`
  - `C:\Users\niilo\Desktop\mao 杯子.psd`
- 真实印花素材目录：通过 `process.env.PS_MATERIAL_ROOT` 读取，主理人本机为 `C:\Users\niilo\Desktop\印花素材`。
- 输出根目录：通过 `process.env.PS_OUTPUT_ROOT` 读取，主理人本机为 `C:\Users\niilo\Desktop\新建文件夹`。
- `REAL_PS=1` 启用真实 Photoshop/COM 测试；`REAL_PS_MUTATE=1` 作为会覆盖输出或关闭未保存文档等破坏性操作的二级守护。
- 本 task 是纯任务分组逻辑，不主动执行 COM、不覆盖输出、不关闭 Photoshop。
- 禁止程序自动 quit Photoshop。

## 验收标准

- [ ] `groupTasks(prints, template, replaceRange) → TaskGroup[]`
- [ ] 代表 SO 数 = `representativeSoCount(scanResult, replaceRange)`
- [ ] N=1 → 每张图独立一组
- [ ] N>1 → 按 N 张图一组（不足凑齐用上一组的最后一张？或保留不足）
- [ ] 排序用 sortAlphaNum（自然排序：img2 < img10）
- [ ] v1 不支持手动拖拽分组（v1.5）
- [ ] 每组生成 PhotoshopJob 含 mockup_path / so_replacements / output_paths

## 不做

- 无明确排除项（按需收敛）

## 实施提示

sortAlphaNum 完整实现见 spec §5.1。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop task grouping"
python3 .trellis/scripts/task.py archive 05-23-ps-task-grouping
```
