# Task: PS 执行引擎（切片 7 - PS 套版）

## 目标

对每个任务组：生成 JSX → 调 COM → 读结果 → 验证输出文件 → 重试。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §8, §10`

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
