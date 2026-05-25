# Task: PS 多模板批次输出（切片 7 - PS 套版）

## 目标

用户选 N 个模板 → 每个模板生成一个批次目录 → 同一组印花跑所有模板。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §6`

## 本机真实环境约束

- Windows 10/11 + Photoshop 2023+；当前主理人已打开 Photoshop，执行类测试必须通过真实 Photoshop COM。
- 真实 PSD 模板占位：
  - `C:\Users\niilo\Desktop\钥匙扣x.psd`
  - `C:\Users\niilo\Desktop\mao 杯子.psd`
- 真实印花素材目录：通过 `process.env.PS_MATERIAL_ROOT` 读取，主理人本机为 `C:\Users\niilo\Desktop\印花素材`。
- 输出根目录：通过 `process.env.PS_OUTPUT_ROOT` 读取，主理人本机为 `C:\Users\niilo\Desktop\新建文件夹`。
- `REAL_PS=1` 启用真实 Photoshop/COM 测试；`REAL_PS_MUTATE=1` 作为会覆盖输出或关闭未保存文档等破坏性操作的二级守护。
- 本 task 涉及真实 COM，默认单元测试必须跳过真实 PS；`REAL_PS=1` 才允许本机真实执行。真实执行必须写入唯一测试目录，避免覆盖用户成品。
- 禁止程序自动 quit Photoshop；只允许关闭本 job 打开的 PSD/duplicate 文档，且不保存模板变更。

## 真实 PS 验证记录

- 已运行：`REAL_PS=1 PS_MATERIAL_ROOT=C:\Users\niilo\Desktop\印花素材 PS_OUTPUT_ROOT=C:\Users\niilo\Desktop\新建文件夹 pnpm -F @tengyu-aipod/client exec vitest run src/main/photoshop/multi-batch.test.ts --reporter=verbose`
- 结果：2 tests passed，其中真实 Photoshop 小批次用例通过。
- 输出证据目录：`C:\Users\niilo\Desktop\新建文件夹\__codex_real_ps_multi_batch_*`

## 验收标准

- [ ] `runBatch(prints, templates[], config): Promise<BatchResult>`
- [ ] for each template: 创建 05-货号成品/{模板名清洗后}/ 目录
- [ ] for each print 组 in template: 跑任务组
- [ ] 输出到 05-货号成品/{模板批次}/{货号}/{seq}.jpg
- [ ] 模板名清洗：去 .psd 后缀 + 替换 Windows 非法字符
- [ ] 整体进度面板（模板进度 + 组进度）

## 不做

- 无明确排除项（按需收敛）

## 实施提示

多模板时同一印花跑多次。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop multi template batch"
python3 .trellis/scripts/task.py archive 05-23-ps-multi-batch
```
