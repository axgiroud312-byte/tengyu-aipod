# Task: Import listing-automation-builder SKILL（切片 8 - 上架（强制第一步））

## 目标

把 `一键pod/上架程序/.agents/skills/listing-automation-builder/SKILL.md` 复制到腾域 `.agents/skills/`，作为开发上架代码的方法论宪法。

本 task 是切片 8 的强制第一步，只导入方法论和声明规则；不实现任何店小秘 DOM 操作。后续 19 个 listing task 必须在此 skill 存在后再执行。

## 输入

参考文档（按重要性排序）：
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `docs/spec/07-listing.md §2`
- `.trellis/tasks/05-23-listing-skill-import/research/listing-source-map.md`

## 切片 8 v1 真实范围基线

### 3 个模板

| 平台 | 店小秘编辑页 URL | 真实素材根目录 |
|---|---|---|
| Temu 服装 | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`，排除 `GzG00010` |
| Temu 百货 | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

### 每个模板 workflow 必须覆盖的 5 项核心动作

1. 替换店铺名称
2. 替换标题
3. 替换图片
4. 一键生成 SKU
5. 一键上传视频

### 真实测试基线

- 测试目标是本机已打开的比特浏览器 `2-1111` 窗口；主理人会保持它登录店小秘并打开模板编辑页，或允许脚本自动 navigate 到上表 URL。
- 必须通过 `bit-browser-adapter` 的 `list-profiles` + Playwright `connectOverCDP` 接入该窗口；不要新建 profile，不要 mock CDP。
- selectors / parser / executor / workflow 的断言直接打在真实店小秘 DOM 上，不使用 fixture HTML。
- smoke 测试（`temu-smoke` / `shein-smoke`）必须真实把测试素材上传到真实模板页面，并断言上传后的 DOM 状态；完成后回滚或保留草稿由主理人决定。
- 单元层只允许 mock：`bit-browser-adapter` 自己的 HTTP 协议、`AppError` 错误格式、纯文件读写。素材路径扫描可以用真实目录。
- 真实测试用 `process.env.REAL_LISTING=1` 守护；CI 默认跳过，主理人本地 `REAL_LISTING=1 pnpm e2e` 或相关 test filter 才执行。
- 本 task 只导入 skill，不触达真实 DOM；真实 DOM 质量门从 `listing-temu-selectors` / `listing-shein-selectors` 等 task 开始执行。

## 验收标准

- [x] 复制 SKILL.md 到 .agents/skills/listing-automation-builder/SKILL.md
- [x] 确认 `.claude/skills`、`.cursor/skills`、`.codex/skills` 也有副本（本仓库已存在这些 skill 目录，因此同步复制）
- [x] 在 CLAUDE.md 顶部声明：开发上架模块时必须加载此 SKILL
- [x] 在切片 8 的所有 listing 类 task 的 prd.md 都引用此 SKILL（已 done）
- [x] `implement.jsonl` 和 `check.jsonl` 包含 `docs/spec/07-listing.md`、ADR-0004、外部源码 research 上下文
- [ ] commit

## 不做

- 不实现任何上架代码（这只是导入方法论）

## 实施提示

用 cp 命令：cp -r /Users/macmini/Desktop/一键pod/上架程序/.agents/skills/listing-automation-builder/ .agents/skills/

## 完成后

```bash
git add -A
git commit -m "chore(task): import listing-automation-builder SKILL"
python3 .trellis/scripts/task.py archive 05-23-listing-skill-import
```
