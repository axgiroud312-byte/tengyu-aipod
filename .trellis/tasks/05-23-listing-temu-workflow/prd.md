# Task: Temu PopTemu - workflow.ts（12 阶段状态机）（切片 8 - 上架 - Temu PopTemu）

## 目标

Temu PopTemu 的业务工作流：严格按 `listing-automation-builder` 四层结构，把已完成的 selectors / page-parser / action-executor 串成 12 阶段状态机。workflow 层只做业务编排、证据保存和阶段结果，不直接写选择器或复杂 DOM 操作。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.4`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `.agents/skills/listing-automation-builder/SKILL.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只参考 runner / stage / evidence 框架，不 Port 店小秘 DOM 逻辑）
- 已归档任务：
  - `.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/`
  - `.trellis/tasks/archive/2026-05/05-23-listing-temu-parser/`
  - `.trellis/tasks/archive/2026-05/05-23-listing-temu-executor/`

## 验收标准

- [ ] 导出 `runListingItem(page, item, config): Promise<ListingResult>`
- [ ] 12 个 stage：`enter_page` / `page_ready` / `confirm_shop_context` / `fill_title_and_sku` / `upload_material_images` / `upload_video` / `process_color_skc` / `reuse_size_chart` / `generate_sku_code` / `process_description` / `submit_publish` / `publish_result`
- [ ] 5 项核心动作必须通过 action-executor 编排：替换店铺名称、替换标题、替换图片、一键生成 SKU、一键上传视频
- [ ] 每 stage 完成保存证据（截图 + DOM）
- [ ] stage 失败抛错让 runner 决定重试
- [ ] 返回 `stages` 数组（用于诊断），每个 stage 包含 `observed_state`、`target_state`、`transition`、`success_evidence`
- [ ] 服装模板和百货模板都能进入同一 workflow，按模板差异选择图片组：服装优先 `material`，百货优先 `preview`，否则回落到 `carousel` / `sku`

## 真实测试基线（MVP v1）

workflow 必须**完整覆盖 Temu 服装 + Temu 百货 2 个模板**，每个模板都跑通 5 项核心动作（替换店铺名 / 替换标题 / 替换图片 / 一键生成 SKU / 一键上传视频）。

真实模板：
- Temu 服装：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515（素材 `/Users/macmini/Desktop/服装素材摆放举例` 排除 `GzG00010`）
- Temu 百货：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551（素材 `/Users/macmini/Desktop/素材文件夹`）

核心动作：
1. 替换店铺名称
2. 替换标题
3. 替换图片
4. 一键生成 SKU
5. 一键上传视频

接入：bit-browser `2-1111` + `list-profiles` + `connectOverCDP`。不要新建 profile，不 mock CDP。

断言：selectors / parser / executor / workflow 的真实测试必须直接打在真实店小秘 DOM 上，不用 fixture HTML。

测试守护：`REAL_LISTING=1` 启用，CI 默认跳过。

上传 / 一键生成 SKU 是真实草稿变更，默认测试只跑低风险只读或同值写入；`REAL_LISTING_MUTATE=1` 才允许 workflow 真实执行上传图片、上传视频和一键生成 SKU。若真实素材目录没有视频文件，记录为真实素材缺失阻塞，不能造假视频 fixture。

smoke 留到 `listing-temu-smoke`，本 task 只实现 workflow 和 guarded real workflow test。

参考：`/Users/macmini/Desktop/一键pod/上架程序`（只 Port 框架）。

## 四层边界

- `selectors/`：只放静态定位规则，workflow 不新增散落选择器。
- `page-parser/`：只读真实 DOM，workflow 每个阶段前后都通过 parser 识别状态。
- `action-executor/`：动作原语，负责重新定位、执行、重新 parser 验证。
- `workflow/`：12 阶段业务编排，负责根据 item/config 决定跑、跳过或失败，不直接操作 DOM 细节。

## 不做

- 不实现选择器云端派发（v1.5）
- 不发布真实商品；`submit_publish` / `publish_result` 在 `save-draft` 模式下只记录跳过或草稿保存状态，真实发布留给主理人确认。
- 不补 Shein workflow（后续 task 单独做）

## 实施提示

12 阶段顺序固定。某些 stage（upload_video / process_description / submit_publish）按 config 和素材实际情况决定是否跑，但 stage 仍必须返回诊断结果。

## 完成后

```bash
git add -A
git commit -m "feat(task): temu pop workflow (12 stages)"
python3 .trellis/scripts/task.py archive 05-23-listing-temu-workflow
```
