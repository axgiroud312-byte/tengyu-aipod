# Task: 比特浏览器 Adapter（切片 6 - 采集（也供上架用））

## 目标

封装比特浏览器本地 HTTP API：列出 profile / 开关 profile / 拿 CDP 端点。

## 输入

参考文档（按重要性排序）：
- `docs/spec/02-collection.md §7.1`

## 验收标准

- [ ] 类 `BitBrowserClient`
- [ ] baseUrl 默认 http://127.0.0.1:54345（用户可改）
- [ ] 方法：listProfiles, openProfile, closeProfile, getProfileStatus
- [ ] openProfile 返回 { http, ws } CDP 端点
- [ ] 错误：BROWSER_NOT_CONNECTED (连不上)、PROFILE_NOT_FOUND
- [ ] vitest 单测 + msw mock

## 不做

- 不实现 profile 创建/删除（用户在比特浏览器后台管理）

## 实施提示

比特浏览器 API 文档（用户提供）：列出 profile 用 POST /browser/list。

## 完成后

```bash
git add -A
git commit -m "feat(task): bit browser adapter"
python3 .trellis/scripts/task.py archive 05-23-bit-browser-adapter
```
