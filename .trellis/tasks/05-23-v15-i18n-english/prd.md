# Task: v1.5: i18n 英文支持（v1.5 - 横切）

## 目标

引入 i18next + 提取所有中文字符串到 locale/en.json。

## 输入

参考文档（按重要性排序）：
- `docs/spec/09-cross-cutting.md §9`

## 验收标准

- [ ] 客户端集成 react-i18next
- [ ] 建 packages/client/src/renderer/src/locale/{zh.json,en.json}
- [ ] 用 useTranslation hook 替换所有硬编码字符串
- [ ] UI 加语言切换器（设置面板）
- [ ] OS locale 自动检测默认语言
- [ ] 服务端 admin UI 也 i18n（可选 v2）

## 不做

- 不做日语/西班牙语等小语种（按用户反馈再加）

## 实施提示

i18next + locize 可选用于翻译管理。

## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): i18n english support"
python3 .trellis/scripts/task.py archive 05-23-v15-i18n-english
```
