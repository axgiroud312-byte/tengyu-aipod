# Task: PS 执行引擎（切片 7 - PS 套版）

## 目标

对每个任务组：生成 JSX → 调 COM → 读结果 → 验证输出文件 → 重试。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §8, §10`

## 本机真实环境约束

- Windows 10/11 + Photoshop 2023+；当前主理人已打开 Photoshop，执行类测试必须通过真实 Photoshop COM。
- 真实 PSD 模板占位：
  - `C:\Users\niilo\Desktop\钥匙扣x.psd`
  - `C:\Users\niilo\Desktop\mao 杯子.psd`
- 真实印花素材目录：通过 `process.env.PS_MATERIAL_ROOT` 读取，主理人本机为 `C:\Users\niilo\Desktop\印花素材`。
- 输出根目录：通过 `process.env.PS_OUTPUT_ROOT` 读取，主理人本机为 `C:\Users\niilo\Desktop\新建文件夹`。
- `REAL_PS=1` 启用真实 Photoshop/COM 测试；`REAL_PS_MUTATE=1` 作为会覆盖输出或关闭未保存文档等破坏性操作的二级守护。
- 本 task 涉及真实 COM，默认单元测试必须跳过真实 PS；`REAL_PS=1` 才允许本机真实执行。真实执行会导出文件到 `PS_OUTPUT_ROOT`，如存在覆盖风险必须要求 `REAL_PS_MUTATE=1`。
- 禁止程序自动 quit Photoshop；只允许关闭本 job 打开的 PSD/duplicate 文档，且不保存模板变更。

## 真实 PS 验证记录

- 已运行：`REAL_PS=1 PS_MATERIAL_ROOT=C:\Users\niilo\Desktop\印花素材 PS_OUTPUT_ROOT=C:\Users\niilo\Desktop\新建文件夹 pnpm -F @tengyu-aipod/client exec vitest run src/main/photoshop/execution-engine.test.ts --reporter=verbose`
- 结果：7 tests passed，其中真实 Photoshop path A job 用例通过。
- 输出证据目录：`C:\Users\niilo\Desktop\新建文件夹\__codex_real_ps_execution_engine`

## 验收标准

- [ ] `runJob(job, maxRetries): Promise<JobResult>`
- [ ] 全局 Mutex（一次只跑一个 PS 任务）
- [ ] 调 jsx-generator + ps-com-adapter
- [ ] 校验输出：所有 output_paths 文件存在
- [ ] 失败分类：COM 断 / JSX 报错 / SO 不存在 / 文件 IO / 输出验证失败
- [ ] 可重试错误自动重试（指数退避，max 5）
- [ ] 数据库 workflow_steps 记录

## 不做

- 无明确排除项（按需收敛）

## 实施提示

JSX 报错时 result.error 含原始 e.toString()，要保留给用户调试。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop execution engine"
python3 .trellis/scripts/task.py archive 05-23-ps-execution-engine
```
