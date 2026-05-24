# Task: Temu PopTemu - page-parser.ts（切片 8 - 上架 - Temu PopTemu）

## 目标

实现 Temu PopTemu 页面状态解析器 `page-parser.ts`：只读真实 DOM，返回 observed_state，供后续 executor/workflow 判断“现在页面处于什么状态、动作是否已经完成”。

本 task 是切片 8 的第 6 步。必须基于第 5 步已验证的真实 selector 契约继续，不允许 fixture HTML、不允许 mock CDP、不允许执行任何写入动作。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.2`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `.agents/skills/listing-automation-builder/SKILL.md`
- `.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/research/temu-selector-source-map.md`
- `.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/evidence/real-selector-hit-report.json`
- `/Users/macmini/Desktop/一键pod/上架程序` 相关源码（只作框架/状态字段参考，不 Port DOM 屎山）

## 切片 8 v1 真实范围基线

### 3 个模板

| 平台 | 店小秘编辑页 URL | 真实素材根目录 |
|---|---|---|
| Temu 服装 | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`，排除 `GzG00010` |
| Temu 百货 | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

本 task 只实现 Temu parser，但 PRD 必须记录完整切片 8 v1 基线，避免后续上下文丢失。

### 每个模板 workflow 必须覆盖的 5 项核心动作

1. 替换店铺名称
2. 替换标题
3. 替换图片
4. 一键生成 SKU
5. 一键上传视频

parser 必须能读取上述动作所需状态：店铺当前值、标题/英文标题/货号字段值、图片数量、SKU 一键生成入口、SKU 表格状态、视频入口/已有视频状态、保存/发布按钮状态、toast/loading/login/blocking modal 状态。

## 验收标准

- [ ] 新增 `parseDraftPage(page): Promise<TemuPopDraftPageState>`
- [ ] 返回结构包含：`url` / `page_title` / `template_key` / `shop_context` / `workflow_step` / `is_login_required` / `is_loading` / `is_blocking_modal`
- [ ] 返回字段状态：`shop_field` / `category_field` / `title_field` / `english_title_field` / `sku_field`
- [ ] 返回上传/图片区状态：`carousel_images` / `material_images` / `preview_images` / `description_images` / `video_section`
- [ ] 返回 SKU 状态：`variant_attribute_section` / `one_click_sku` / `sku_table` / `sku_category_batch` / `packing_list_batch`
- [ ] 返回提交状态：`shipping_template` / `save_button` / `publish_button` / `success_toast` / `failure_toast`
- [ ] 每个字段都基于真实 DOM 查询，不传 `ElementHandle` 出来，只返回数据
- [ ] 找不到元素不抛错，返回 `found=false` / `count=0`，便于 executor 做结构化错误
- [ ] 新增真实 parser 测试，默认跳过，`REAL_LISTING=1` 时通过 Bit Browser `2-1111` + Playwright `connectOverCDP` 连接两个 Temu 真实模板并断言状态识别正确
- [ ] 真实测试证据写入 `.trellis/tasks/05-23-listing-temu-parser/evidence/`

## 真实测试基线（MVP v1）

**测试目标 = 主理人本机比特浏览器 `2-1111` 窗口 + 真实店小秘**。禁止 fixture HTML / 假 DOM / mock CDP。

v1 真实模板（共 2 个 Temu 草稿）：
- Temu 服装：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515
- Temu 百货：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551

接入方式：用 `bit-browser-adapter` list-profiles 找到 `2-1111` → `connectOverCDP` 拿到 Playwright Page，禁止新建 profile / mock CDP。

测试守护：真实联调用 `REAL_LISTING=1` 环境变量启用，CI / 默认本地测试跳过。

真实断言要求：
- parser 单测必须直接打在真实店小秘 DOM 上，不能使用 fixture HTML。
- 单元层不 mock CDP；只允许已有 bit-browser adapter 自身 HTTP 协议单测继续 mock。
- parser 真实测试只读页面，不点击、不上传、不保存、不发布。

## 不做

- 不执行任何动作（只读不写）
- 不填标题、不替换图片、不生成 SKU、不上传视频、不保存/发布
- 不新增 executor/workflow/smoke 逻辑

## 实施提示

- 严格使用 `dianxiaomi-temu-pop/selectors.ts`，不要在 parser 中散落新 selector；如真实 DOM 需要新 selector，先加到 selector 表。
- ElementHandle 可以短暂内部使用，但不能出现在返回结构里。
- `workflow_step` 只表示页面粗状态，例如 `login_required` / `loading` / `blocked` / `editing` / `unknown`。
- 图片/视频上传是否成功只做状态读取，不做动作判断；具体“目标素材是否上传完成”留给 executor/workflow/smoke。

## 完成后

```bash
git add .trellis/tasks/05-23-listing-temu-parser packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop
git commit -m "feat(task): temu pop page parser"
python3 .trellis/scripts/task.py archive 05-23-listing-temu-parser
```
