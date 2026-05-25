# Task: PS 跳过已完成（切片 7 - PS 套版）

## 目标

判据：DB 任务 completed + 文件存在 + hash 一致。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §9`

## 本机运行与真实测试约束

- 本 task 必须在 Windows 本机执行，要求 Photoshop 2023+ 可用；本机观察到 Photoshop 版本为 27.7.0。
- Photoshop 集成必须走真实 COM：`New-Object -ComObject Photoshop.Application` + `DoJavaScriptFile`。不允许使用 mock COM 代替真实验证。
- 真实 COM 测试必须设置 `REAL_PS=1`。任何会修改 PSD、覆盖输出、写入真实输出目录的破坏性操作必须额外设置 `REAL_PS_MUTATE=1`。
- 真实素材目录必须通过 `PS_MATERIAL_ROOT` 指向：`C:\Users\niilo\Desktop\印花素材`。
- 真实输出目录必须通过 `PS_OUTPUT_ROOT` 指向：`C:\Users\niilo\Desktop\新建文件夹`。
- 真实 PSD 模板路径：
  - `C:\Users\niilo\Desktop\钥匙扣x.psd`
  - `C:\Users\niilo\Desktop\mao 杯子.psd`
- 不要自动退出 Photoshop；测试完成后保持用户本机 Photoshop 状态。

## 验收标准

- [ ] `shouldSkipJob(job): Promise<boolean>`
- [ ] 三个条件全满足才跳过：
- [ ]   数据库 workflow_steps 有 completed 记录（按 job_signature）
- [ ]   所有 output_paths 文件存在
- [ ]   文件 hash 与数据库一致
- [ ] UI 顶部 [跳过已完成] toggle 默认开

## 不做

- 无明确排除项（按需收敛）

## 实施提示

job_signature = hash(mockup_path + sorted(so_replacements) + clip_mode + format)。

## 完成后

```bash
git add -- <明确路径>
git commit -m "feat(task): photoshop skip completed jobs"
python .\.trellis\scripts\task.py archive .\.trellis\tasks\05-23-ps-skip-completed --no-commit
```
