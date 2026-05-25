# Task: PS 三态检测器（切片 7 - PS 套版（Windows-only））

## 目标

检测 Photoshop installed / running / com_connected 三态。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §2`
- `docs/adr/0007-photoshop-windows-only-v1.md`

## 本机真实环境

- Windows + Photoshop：主理人 Windows 本机，已检测到 `Adobe Photoshop 2026` 进程。
- 真实 PSD 模板：
  - `C:\Users\niilo\Desktop\钥匙扣x.psd`
  - `C:\Users\niilo\Desktop\mao 杯子.psd`
- 印花素材根目录：通过 `process.env.PS_MATERIAL_ROOT` 读取，当前本机路径为 `C:\Users\niilo\Desktop\印花素材`。
- 输出根目录：通过 `process.env.PS_OUTPUT_ROOT` 读取，当前本机路径为 `C:\Users\niilo\Desktop\新建文件夹`。
- 真实 Photoshop 测试守护：
  - `REAL_PS=1` 才运行真实 Photoshop / COM 测试。
  - `REAL_PS_MUTATE=1` 才允许覆盖输出文件或关闭未保存测试文档。
  - 本 task 不做破坏性输出写入，默认不需要 `REAL_PS_MUTATE=1`。

## 验收标准

- [ ] 类 `PhotoshopStatusChecker`
- [ ] Windows 注册表读 Photoshop 路径（用 winreg / registry-js）
- [ ] 进程列表查 Photoshop.exe（用 ps-list）
- [ ] 尝试 COM 连接（ActiveXObject / `New-Object -ComObject Photoshop.Application` 等价真实 COM → 拿 version）
- [ ] 返回 { installed, running, com_connected, version, last_check_at }
- [ ] Mac 上立即返回 { installed: false, running: false, com_connected: false }
- [ ] IPC `photoshop:get-status`
- [ ] 渲染进程定期刷新（30 秒）

## 不做

- 不实现 PS 版本最低要求检测（v1 默认支持 CC 2018+）

## 实施提示

用 `winax` 或等价方式调 COM。当前主理人本机未安装 Visual Studio C++ Build Tools，`winax` 原生模块无法通过 node-gyp 构建；本 task 使用 Windows PowerShell `New-Object -ComObject Photoshop.Application` 作为真实 COM bridge。注意 try/catch 包裹（PS 没装就报错）。所有 Windows-only 逻辑必须有 `process.platform === 'win32'` 守护，非 Windows 不能因为 COM / Windows 命令 import 失败导致 build 挂掉。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop status checker"
python3 .trellis/scripts/task.py archive 05-23-ps-status-checker
```
