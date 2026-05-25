# Task: 上架证据保存（切片 8 - 上架）

## 目标

每 stage 保存截图 + DOM 快照到 .workbench/tmp/listing/{taskId}/evidence/。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §10`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `docs/adr/0008-temp-file-manager-and-cleanup.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只作 research 上下文，不 Port DOM 代码）

## 真实测试基线（MVP v1）

全部真实验证都以主理人本机比特浏览器 `2-1111` 窗口 + 真实店小秘为目标，接入方式必须是 `bit-browser-adapter list-profiles` 找到 `2-1111`，再通过 `connectOverCDP` 接入；禁止新建 profile 或 mock CDP。

测试守护：`REAL_LISTING=1` 才启用真实 DOM 测试，CI / 默认测试跳过；破坏性动作（生成 SKU / 上传图片 / 上传视频）必须再显式设置 `REAL_LISTING_MUTATE=1`。

3 个真实模板：
- Temu 服装：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515
  - 素材：`/Users/macmini/Desktop/服装素材摆放举例`（排除 `GzG00010`）
- Temu 百货：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551
  - 素材：`/Users/macmini/Desktop/素材文件夹`
- Shein：https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551
  - 素材：`/Users/macmini/Desktop/服装素材摆放举例/GzG0001`

5 项核心动作的每个 stage 都要能落证据：替换店铺名称、替换标题、替换图片、一键生成 SKU、一键上传视频。

## 验收标准

- [ ] 工具 `saveStageEvidence(page, stage, result)`
- [ ] 保存：screenshot.png / dom.html / state.json
- [ ] 路径：.workbench/tmp/listing/{taskId}/evidence/{profileId}/{skuCode}/stage-{NN}-{stage}/
- [ ] 失败时优先保存（用户调试用）
- [ ] 成功也保存（24 小时后由 TempFileManager 清理）
- [ ] Temu / Shein workflow 复用同一个 evidence helper，不在平台层重复写截图/DOM 保存逻辑
- [ ] evidence 根目录由 TempFileManager / runner 指向 `.workbench/tmp/listing/{taskId}`，workflow 只在其下追加 `evidence/{profileId}/{skuCode}/stage-*`
- [ ] v1.5 可加「成功保留 7 天」配置

## 不做

- 无明确排除项（按需收敛）

## 实施提示

DOM 快照用 page.content()，截图用 page.screenshot()。

## 完成后

```bash
git add -A
git commit -m "feat(task): listing evidence storage"
python3 .trellis/scripts/task.py archive 05-23-listing-evidence
```
