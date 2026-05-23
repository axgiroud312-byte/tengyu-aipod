# Task: v1.5: macOS 代码签名 + 公证（v1.5 - 打包）

## 目标

Apple Developer Program + 公证。

## 输入

参考文档（按重要性排序）：
- `docs/spec/09-cross-cutting.md §10.3`

## 验收标准

- [ ] 注册 Apple Developer Program（¥99/年）
- [ ] 创建 Developer ID Application 证书
- [ ] electron-builder 配置 mac.identity + notarize.appleId/appleIdPassword
- [ ] Notarize 通过后 dmg 不再弹「无法验证开发者」
- [ ] GitHub Actions 配置签名 + 公证

## 不做

- 无明确排除项（按需收敛）

## 实施提示

公证需要 Mac OS 12+ 和正确的 entitlements.plist。

## 完成后

```bash
git add -A
git commit -m "chore(task v1.5): macos code signing and notarization"
python3 .trellis/scripts/task.py archive 05-23-v15-sign-mac
```
