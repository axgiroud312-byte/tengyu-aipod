# Task: 上架断点续传（切片 8 - 上架）

## 目标

listing_status 表 + 启动时跳过 success 货号。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §9`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只作 research 上下文，不 Port DOM 代码）

## 真实测试基线（MVP v1）

- 主理人本机比特浏览器：`2-1111`
- 真实测试守护：`REAL_LISTING=1`
- 破坏性操作二级守护：`REAL_LISTING_MUTATE=1`
- 真实模板与素材：
  - Temu 服装：`https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515`，素材 `/Users/macmini/Desktop/服装素材摆放举例`（排除 `GzG00010`）
  - Temu 百货：`https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551`，素材 `/Users/macmini/Desktop/素材文件夹`
  - Shein：`https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551`，素材 `/Users/macmini/Desktop/服装素材摆放举例/GzG0001`
- 5 项核心动作覆盖：替换店铺名称、替换标题、替换图片、一键生成 SKU、一键上传视频

## 验收标准

- [ ] listing_status 表 schema（spec §9）
- [ ] 每个 listing 处理前查表：success → 跳过
- [ ] 处理中标 uploading；完成标 success；失败标 failed
- [ ] runner/preload 支持 [启用断点续传] 与 [仅重试 failed] 参数，UI 控件在 `listing-module-ui` 接入
- [ ] 重试失败：仅重试 status=failed
- [ ] evidence 保留路径写到 status 行

## 不做

- 无明确排除项（按需收敛）

## 实施提示

Unique key: (batch_path, sku_code, platform, workspace_id)。

## 完成后

```bash
git add -A
git commit -m "feat(task): listing resume from checkpoint"
python3 .trellis/scripts/task.py archive 05-23-listing-resume
```
