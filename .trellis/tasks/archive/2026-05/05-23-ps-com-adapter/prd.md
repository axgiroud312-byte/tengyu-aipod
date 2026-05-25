# Task: Photoshop COM Adapter（切片 7 - PS 套版）

## 目标

封装 PS COM 调用：启动 PS / 跑 JSX 文件 / 错误捕获。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §8`
- `docs/adr/0007-photoshop-windows-only-v1.md`

## 本机真实环境

- Windows + Photoshop：主理人 Windows 本机，已检测到 `Adobe Photoshop 2026` 进程，真实 COM 版本读取已返回 `27.7.0`。
- 真实 PSD 模板：
  - `C:\Users\niilo\Desktop\钥匙扣x.psd`
  - `C:\Users\niilo\Desktop\mao 杯子.psd`
- 印花素材根目录：通过 `process.env.PS_MATERIAL_ROOT` 读取，当前本机路径为 `C:\Users\niilo\Desktop\印花素材`。
- 输出根目录：通过 `process.env.PS_OUTPUT_ROOT` 读取，当前本机路径为 `C:\Users\niilo\Desktop\新建文件夹`。
- 真实 Photoshop 测试守护：
  - `REAL_PS=1` 才运行真实 Photoshop / COM 测试。
  - `REAL_PS_MUTATE=1` 才允许覆盖输出文件或关闭未保存测试文档。
  - 禁止程序 quit Photoshop；只能在二级守护开启时关闭测试自己打开的文档，避免丢主理人的其它工作。

## 验收标准

- [ ] 类 `PhotoshopComAdapter`（仅 Windows，Mac 抛 UnsupportedError）
- [ ] 全局 Mutex（用 async-mutex）串行所有 PS 调用
- [ ] 方法：launchApp() / runJsxFile(path) / getActiveDocument() / closeAll()
- [ ] runJsxFile 通过 app.DoJavaScriptFile(path)
- [ ] 异常分类：PS_NOT_RUNNING / PS_COM_FAILED / JSX_EXEC_FAILED
- [ ] tryFixCom() 函数：尝试 regsvr32 重注册（要管理员权限，否则提示用户）

## 不做

- 不实现并发调用 PS（PS 是单实例的）

## 实施提示

优先复用 `ps-status-checker` 已验证的 Windows PowerShell COM bridge：`New-Object -ComObject Photoshop.Application`。主理人本机未安装 Visual Studio C++ Build Tools，`winax` 原生模块无法构建，所以本阶段用 PowerShell COM 作为等价真实 COM 接入。所有 Windows-only 逻辑必须有 `process.platform === 'win32'` 守护，非 Windows 通过 AppError 优雅失败，不能出现 import error。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop COM adapter"
python3 .trellis/scripts/task.py archive 05-23-ps-com-adapter
```
