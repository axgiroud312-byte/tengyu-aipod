# Task: PS 裁切策略（切片 7 - PS 套版）

## 目标

三种裁切模式：none / auto / guides。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §4.3`

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

- [ ] `deriveClipAreas(scanResult, mode): ClipArea[]`
- [ ] none → 单一全图 area
- [ ] guides → 按参考线划分网格
- [ ] auto → 优先 guides，无参考线 fallback 到 SO 祖先 bounds
- [ ] 无参考线无 SO 祖先 fallback 到 none
- [ ] 返回的 area 含 x/y/w/h
- [ ] JSX 用 duplicate + crop + saveAs 实现

## 不做

- 不实现自定义裁切区域 UI（v1.5）

## 实施提示

guides 网格：水平参考线 + 垂直参考线 cross 出格子。

## 完成后

```bash
git add -- <明确路径>
git commit -m "feat(task): photoshop clipping strategy"
python .\.trellis\scripts\task.py archive .\.trellis\tasks\05-23-ps-clipping --no-commit
```
