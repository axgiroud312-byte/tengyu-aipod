# Task: 侵权检测业务服务（切片 3 - 侵权检测）

## 目标

扫输入 → 预处理 → 并发调百炼 → 解析风险值 → 物理复制图到 `03-检测/{level}/`。

## 输入

参考文档（按重要性排序）：
- `docs/spec/04-detection.md §4-8`

## 验收标准

- [ ] `runDetectionBatch(config)` 主流程
- [ ] 输入：图片路径数组 + skill_id + threshold + 模型
- [ ] 预处理用 sharp-preprocess-pool（加白底强制 + 压缩可选）
- [ ] 并发调 bailian-adapter visionCompletion，response_format=json_object
- [ ] 通用解析器：`parseDetectionResponse(text)` 提取 score + reason
- [ ] 按 threshold 分类到 pass/review/block
- [ ] 物理 copy 图到 `03-检测/{level}/{印花ID}.{ext}`
- [ ] 数据库 `detection_results` 表登记
- [ ] 重复检测策略：模型+skill 版本一致则用缓存
- [ ] 失败标记 'preprocess_failed' 或 'llm_parse_failed'，不污染分类
- [ ] 进度 IPC 推送

## 不做

- 不实现批量分类调整（用户改阈值后历史不动）
- 不实现自定义模型微调

## 实施提示

图片 hash 用 SHA256 of file content 作为缓存键。

## 完成后

```bash
git add -A
git commit -m "feat(task): detection module orchestration service"
python3 .trellis/scripts/task.py archive 05-23-detection-module-service
```
