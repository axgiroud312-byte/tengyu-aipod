# Task: 上架模块 E2E（切片 8 - 上架）

## 目标

3 个真实模板（Temu 服装 / Temu 百货 / Shein）各跑一遍真实上架验证。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只作 research 上下文，不 Port DOM 代码）

## 真实测试基线（MVP v1）

**全部用主理人本机比特浏览器 `2-1111` 窗口 + 真实店小秘**，禁止 mock。接入方式必须是 `bit-browser-adapter list-profiles` 找到 `2-1111`，再通过 `connectOverCDP` 接入；禁止新建 profile 或 mock CDP。

测试守护：`REAL_LISTING=1` 才启用真实 DOM / E2E；涉及破坏性动作（生成 SKU / 上传图片 / 上传视频）必须再显式设置 `REAL_LISTING_MUTATE=1`。

环境准备清单：
- [ ] 比特浏览器 `2-1111` profile 已登录店小秘并保持
- [ ] 3 个模板编辑页可访问：
  - Temu 服装：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515
  - Temu 百货：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551
  - Shein：https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551
- [ ] 真实素材目录就位：
  - `/Users/macmini/Desktop/服装素材摆放举例`（排除 `GzG00010`）
  - `/Users/macmini/Desktop/素材文件夹`
  - `/Users/macmini/Desktop/服装素材摆放举例/GzG0001`

启用方式：`REAL_LISTING=1 REAL_LISTING_MUTATE=1 pnpm -F @tengyu-aipod/client e2e --grep "listing e2e"`

## 验收标准

- [ ] **Temu 服装**：用 `服装素材摆放举例`（排除 `GzG00010`）批量跑，5 项核心动作（店铺名 / 标题 / 图片 / 一键 SKU / 一键视频）全部成功，每个货号草稿被改对
- [ ] **Temu 百货**：用 `素材文件夹` 批量跑，同上 5 项
- [ ] **Shein**：用 `GzG0001` 跑，同上 5 项
- [ ] 验证：断点续传（中断后再跑跳过 success）
- [ ] 验证：连续失败暂停（mock 5 次失败触发）
- [ ] 验证：listing-profile-lock 互斥（同一 profile 不能并发）
- [ ] 录像 / 截图 / 网络流量证据保存到 `.trellis/tasks/05-23-listing-module-e2e/evidence/`
- [ ] 验证记录写到 `info.md`，含每个模板的命中率、失败原因分类

## 不做

- 不真发布到平台（保存草稿即可）
- 不在 CI 跑（`REAL_LISTING=1` 守护）

## 实施提示

手动 + 半自动结合：脚本驱动 3 个模板各跑一遍，主理人在旁边盯着关键 stage（生成 SKU / 上传视频）。每个 stage 截图存证。

## 完成后

```bash
git add -A
git commit -m "test(task): listing module manual e2e"
python3 .trellis/scripts/task.py archive 05-23-listing-module-e2e
```
