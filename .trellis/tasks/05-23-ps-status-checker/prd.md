# Task: PS 三态检测器（切片 7 - PS 套版（Windows-only））

## 目标

检测 Photoshop installed / running / com_connected 三态。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §2`

## 验收标准

- [ ] 类 `PhotoshopStatusChecker`
- [ ] Windows 注册表读 Photoshop 路径（用 winreg / registry-js）
- [ ] 进程列表查 Photoshop.exe（用 ps-list）
- [ ] 尝试 COM 连接（new ActiveXObject('Photoshop.Application') → 拿 version）
- [ ] 返回 { installed, running, com_connected, version, last_check_at }
- [ ] Mac 上立即返回 { installed: false, running: false, com_connected: false }
- [ ] IPC `photoshop:get-status`
- [ ] 渲染进程定期刷新（30 秒）

## 不做

- 不实现 PS 版本最低要求检测（v1 默认支持 CC 2018+）

## 实施提示

用 `winax` 包调 COM。注意 try/catch 包裹（PS 没装就报错）。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop status checker"
python3 .trellis/scripts/task.py archive 05-23-ps-status-checker
```
