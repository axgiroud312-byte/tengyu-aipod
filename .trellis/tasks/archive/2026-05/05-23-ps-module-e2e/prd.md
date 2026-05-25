# Task: PS 套版 E2E（Windows 手动）（切片 7 - PS 套版）

## 目标

在 Windows 真实 PS 环境跑手动 E2E（不在 CI）。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

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
git add -- <明确路径>
git commit -m "test(task): photoshop module manual e2e on windows"
python .\.trellis\scripts\task.py archive .\.trellis\tasks\05-23-ps-module-e2e --no-commit
```
