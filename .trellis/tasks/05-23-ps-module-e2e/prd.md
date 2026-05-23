# Task: PS 套版 E2E（Windows 手动）（切片 7 - PS 套版）

## 目标

在 Windows 真实 PS 环境跑手动 E2E（不在 CI）。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 准备测试 fixture：3 个 PSD（单 SO / 多 SO / 嵌套 SO）+ 5 张印花
- [ ] 手动跑：选印花 + 选 3 个模板 + 默认配置 + 开始
- [ ] 验证：05-货号成品 下生成 3 个批次目录
- [ ] 验证：每个批次有 5 个货号文件夹
- [ ] 验证：嵌套 SO 模板 UI 显示警告
- [ ] 验证：跳过已完成（再跑一次只跳过）
- [ ] 把验证记录写到 .trellis/tasks/05-23-ps-module-e2e/info.md

## 不做

- 不自动化（PS COM 在 CI 跑不动）

## 实施提示

测试 fixture PSD 放 packages/client/tests/fixtures/psd/。

## 完成后

```bash
git add -A
git commit -m "test(task): photoshop module manual e2e on windows"
python3 .trellis/scripts/task.py archive 05-23-ps-module-e2e
```
