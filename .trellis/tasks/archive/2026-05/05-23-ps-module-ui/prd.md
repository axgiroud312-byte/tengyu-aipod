# Task: PS 套版前端 UI（切片 7 - PS 套版）

## 目标

套版模块的 UI（状态栏 + 输入选择 + 配置 + 进度 + 预览）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §6.3`

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

- [ ] Mac 上显示灰显提示
- [ ] Windows 上顶部状态栏（installed/running/COM + 修复按钮）
- [ ] 印花文件夹选择（默认 04-待套版印花/）
- [ ] 模板多选（用户选 N 个 PSD/PSB）
- [ ] 替换范围（auto/top/all）/ 适配方式（仅 fit v1）/ 裁切模式 / 导出格式
- [ ] [跳过已完成] / 失败重试次数
- [ ] [开始套版] → 进度面板
- [ ] 完成后右侧缩略图网格 + 双击打开

## 不做

- v1 适配方式仅 fit

## 实施提示

模板多选用 shadcn/ui 的 Combobox + multiple。

## 完成后

```bash
git add -- <明确路径>
git commit -m "feat(task): photoshop module UI"
python .\.trellis\scripts\task.py archive .\.trellis\tasks\05-23-ps-module-ui --no-commit
```
