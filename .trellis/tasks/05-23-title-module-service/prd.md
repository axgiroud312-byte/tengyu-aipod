# Task: 标题模块业务服务（切片 2 - 标题生成模块）

## 目标

扫批次目录 + 取第 N 张图 + 并发调 LLM + 写 titles.xlsx 的核心编排。

## 输入

参考文档（按重要性排序）：
- `docs/spec/06-title.md §4`

## 验收标准

- [ ] `runTitleBatch(config)`：扫 `{batchDir}/*/`，对每个货号文件夹取第 N 张图（自然排序）
- [ ] 读已有 titles.xlsx：`skip` 模式跳过已存在的；`regenerate` 模式全做
- [ ] 拉 skill（按 module=title + platform + language）
- [ ] 调 bailian-adapter visionCompletion（VL 一步走）
- [ ] 通用解析器 `parseTitle(text, language)` 提取标题（去前缀/引号/截断）
- [ ] 并发 = 用户配置（1-10，默认 3）
- [ ] 失败按 retry 配置重试
- [ ] 完成后写 xlsx（A 列货号 / B 列标题）
- [ ] 文件被 Excel 锁时报 `XLSX_LOCKED`
- [ ] 数据库 skus 表登记标题
- [ ] 进度通过 IPC `title:progress` 推送

## 不做

- 不在该 task 实现 UI（留 title-module-ui）
- 不强求 LLM 两阶段（一步走够）

## 实施提示

用 exceljs 读写。读取时容错：表头可能是中文或英文。

## 完成后

```bash
git add -A
git commit -m "feat(task): title module orchestration service"
python3 .trellis/scripts/task.py archive 05-23-title-module-service
```
