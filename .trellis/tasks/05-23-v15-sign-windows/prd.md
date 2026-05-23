# Task: v1.5: Windows 代码签名（v1.5 - 打包）

## 目标

购买 Authenticode 证书 + electron-builder 配置签名。

## 输入

参考文档（按重要性排序）：
- `docs/spec/09-cross-cutting.md §10.3`

## 验收标准

- [ ] 购买 Sectigo / DigiCert 代码签名证书（¥800-2000/年）
- [ ] 证书 P12 文件存安全位置（不入 git）
- [ ] electron-builder 配置 certificateFile + certificatePassword（env var）
- [ ] 构建后 .exe / .msi 用 signtool 验证签名
- [ ] 在 GitHub Actions 配置 CI 签名（用 secret 存证书）
- [ ] 首次启动不再触发 SmartScreen 警告（可能仍需 EV 证书）

## 不做

- v1 不签（省钱）

## 实施提示

EV 证书 ¥3000+/年但能立即免 SmartScreen，按预算选。

## 完成后

```bash
git add -A
git commit -m "chore(task v1.5): windows code signing"
python3 .trellis/scripts/task.py archive 05-23-v15-sign-windows
```
