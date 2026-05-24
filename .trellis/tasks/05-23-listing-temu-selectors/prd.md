# Task: Temu PopTemu - selectors.ts（切片 8 - 上架 - Temu PopTemu）

## 目标

Temu PopTemu 平台的选择器表（只放静态规则），覆盖切片 8 v1 的两个 Temu 模板：服装和百货。

本 task 是切片 8 的第 5 步，也是第一个真实 DOM task。必须先通过本机比特浏览器 `2-1111` 连接真实店小秘页面完成侦察，再实现 `selectors.ts` 和真实 selector 命中测试。选择器文件只放静态定位规则，不读 DOM、不点击、不写业务流程。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.1`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `.agents/skills/listing-automation-builder/SKILL.md`
- `.trellis/tasks/05-23-listing-temu-selectors/research/temu-selector-source-map.md`

## 切片 8 v1 真实范围基线

### 3 个模板

| 平台 | 店小秘编辑页 URL | 真实素材根目录 |
|---|---|---|
| Temu 服装 | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`，排除 `GzG00010` |
| Temu 百货 | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

本 task 只实现 Temu selectors，但 PRD 必须记录完整切片 8 v1 基线，避免后续上下文丢失。

### 每个模板 workflow 必须覆盖的 5 项核心动作

1. 替换店铺名称
2. 替换标题
3. 替换图片
4. 一键生成 SKU
5. 一键上传视频

selectors 必须为上述动作准备静态定位候选：店铺上下文/店铺选择、标题输入、图片上传区、SKU 生成入口、视频上传入口，以及保存/发布、toast、登录态、loading、遮罩等状态判定 selectors。

## 验收标准

- [ ] **先打开真实店小秘 Temu PopTemu 草稿页面侦察**
- [ ] 列出所有要操作的字段的候选选择器（css/text/label/placeholder/role 多前缀）
- [ ] 覆盖：shop_context / shop_name_control / title_input / english_title_input / sku_input / one_click_sku_button / save_button / publish_button / carousel_images / material_images / preview_images / color_skc / video_uploader / size_chart_dropdown / description_images / etc.
- [ ] 登录页判定 indicators 列表
- [ ] 成功 toast / 失败 toast 选择器
- [ ] 每个 selector 至少 2 个候选（fallback）
- [ ] 侦察过程截图 + DOM 快照保存到 evidence/
- [ ] 新增真实 selector 测试，默认跳过，`REAL_LISTING=1` 时通过 `bit-browser-adapter` 的 `listProfiles` + Playwright `connectOverCDP` 连接 `2-1111` 并断言两个真实 Temu 模板的 selector 命中
- [ ] 生成页面侦察报告、复用分析、文件归属计划、自动化契约草案、动作状态转换契约，保存到本 task 的 evidence/research 目录

## 真实测试基线（MVP v1）

**测试目标 = 主理人本机比特浏览器 `2-1111` 窗口 + 真实店小秘**。禁止 fixture HTML / 假 DOM。

v1 真实模板（共 2 个 Temu 草稿）：
- Temu 服装：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515
- Temu 百货：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551

接入方式：用 `bit-browser-adapter` list-profiles 找到 `2-1111` → `connectOverCDP` 拿到 Playwright Page，**禁止新建 profile / mock CDP**。

测试守护：真实联调用 `REAL_LISTING=1` 环境变量启用，CI / 沙箱默认跳过。

真实断言要求：
- selectors 单测必须直接打在真实店小秘 DOM 上，不能使用 fixture HTML。
- 允许单元层 mock 的只有 `bit-browser-adapter` 自己的 HTTP 协议；本 task 的真实 selector 测试不能 mock CDP。
- 真实测试证据需要写入 `.trellis/tasks/05-23-listing-temu-selectors/evidence/`，至少包含两个模板的截图、DOM 快照和 selector 命中报告。

参考：`/Users/macmini/Desktop/一键pod/上架程序`（只参考框架/历史侦察，不 Port DOM 屎山）。

## 不做

- `selectors.ts` 不访问页面（这是静态规则，不读 DOM）
- 不点击（不写动作）
- 不执行替换标题、上传图片、生成 SKU、上传视频；这些留给 parser/executor/workflow/smoke tasks
- 不保存或发布真实草稿

## 实施提示

**必须按 listing-automation-builder SKILL 流程：先侦察后实现**。

文件归属：
- 新增 `packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/selectors.ts`
- 新增 `packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/selectors.real.test.ts`
- 侦察脚本/证据尽量放在 task evidence/research 下，不混入运行时代码

## 完成后

```bash
git add .trellis/tasks/05-23-listing-temu-selectors packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop
git commit -m "feat(task): temu pop selectors"
python3 .trellis/scripts/task.py archive 05-23-listing-temu-selectors
```
