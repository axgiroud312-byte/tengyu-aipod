# Task: PS 多模板批次输出（切片 7 - PS 套版）

## 目标

用户选 N 个模板 → 每个模板生成一个批次目录 → 同一组印花跑所有模板。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §6`

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
