# Task: v1.5: i18n 英文支持（v1.5 - 横切）

> ⚠️ **本 task 推迟到 v1.5 实施**。当前阶段（切片 2-4 开发中）只执行 spec/09 §9.1 的"留钩子"约定——所有渲染进程字符串包 `t()`，但 `t()` 是直返中文的占位实现。
> 到 v1.5 真正实施时，本 task 才 `task.py start`。

## 前置（v1 阶段已完成）

- ✅ `docs/spec/09-cross-cutting.md §9.1` 已定 `t()` 钩子约定
- ✅ 切片 2-4 的 UI 代码均已用 `t()` 包裹（Codex 实施 task 时遵守此规则）

## 目标（v1.5）

把占位 `t()` 替换为真正的 i18next 实现 + 提取所有中文字符串到 `locale/en.json`。

## 输入

参考文档（按重要性排序）：
- `docs/spec/09-cross-cutting.md §9`（含 v1 占位约定 + v1.5 计划）

## 验收标准

- [ ] 客户端集成 react-i18next，替换 `locale/t.ts` 占位实现
- [ ] 建 `packages/client/src/renderer/src/locale/{zh.json,en.json}`
- [ ] 用 `i18next-parser` 自动从源码扫出所有 `t('...')` 中文字面量 → 生成 `zh.json`
- [ ] 翻译 `zh.json` → `en.json`（人工或 LLM 辅助）
- [ ] UI 加语言切换器（设置面板）
- [ ] OS locale 自动检测默认语言
- [ ] 字符串插值规则统一切到 i18next 语法（`{{n}}`）
- [ ] 服务端 admin UI 也 i18n（可选 v2）

## 不做

- 不做日语/西班牙语等小语种（按用户反馈再加）
- 不 i18n 主进程日志 / CLI / 错误消息（用户不直接看）

## 实施提示

- i18next + locize 可选用于翻译管理
- `i18next-parser` 配置好后，每次 build 前自动同步 key

## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): i18n english support"
python3 .trellis/scripts/task.py archive 05-23-v15-i18n-english
```
