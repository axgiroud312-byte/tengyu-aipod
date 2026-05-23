# Task: 采集注入脚本（切片 6 - 采集）

## 目标

通过 Playwright addInitScript 注入到比特浏览器页面的 JS，监听 click/scroll/img 加载并回调主进程。

## 输入

参考文档（按重要性排序）：
- `docs/spec/02-collection.md §4.1, §5.1`

## 验收标准

- [ ] 脚本作为字符串嵌入主进程代码
- [ ] 监听 click 事件：识别 IMG 元素 + 找最近商品链接 + 解析原图 URL
- [ ] 监听 scroll：累计可见的 IMG + 按规则过滤
- [ ] exposeBinding '__poseidonSendToHost' 回调主进程
- [ ] 脚本能识别当前 platform（按 URL）
- [ ] 脚本读 platformRule.original_image_resolver 用对应策略提取原图
- [ ] 在 platform 允许域外不触发回调

## 不做

- 不实现 dynamic platform 切换（一次会话一个 platform）

## 实施提示

脚本写到独立 .ts 文件 → build 时 inline 成字符串引入。

## 完成后

```bash
git add -A
git commit -m "feat(task): collection injected page script"
python3 .trellis/scripts/task.py archive 05-23-collection-injected-script
```
