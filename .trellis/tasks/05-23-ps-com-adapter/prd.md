# Task: Photoshop COM Adapter（切片 7 - PS 套版）

## 目标

封装 PS COM 调用：启动 PS / 跑 JSX 文件 / 错误捕获。

## 输入

参考文档（按重要性排序）：
- `docs/spec/05-photoshop.md §8`

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

`winax` 加载 PS COM 后第一次调用慢（启动 PS）。

## 完成后

```bash
git add -A
git commit -m "feat(task): photoshop COM adapter"
python3 .trellis/scripts/task.py archive 05-23-ps-com-adapter
```
