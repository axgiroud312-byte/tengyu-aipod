# Task: Sharp 图像预处理 Worker 池（切片 2 - 标题生成模块（也供 detection 用））

## 目标

Worker Thread 池 + sharp 实现透明底加白 + 压缩 + base64 编码，避免阻塞主进程。

## 输入

参考文档（按重要性排序）：
- `docs/spec/04-detection.md §3` (预处理管线)
- `docs/spec/09-cross-cutting.md §B`

## 验收标准

- [ ] Worker Thread 池大小 = `min(cpus/2, 4)`（用户可在设置覆盖 1-8）
- [ ] Worker 实现：`flatten({ background: '#ffffff' })` + 可选 `resize({ width, fit: 'inside' })` + `jpeg({ quality: 85 })`
- [ ] 输出到 `.workbench/tmp/{module}/{taskId}/{hash}_preprocessed.{ext}`
- [ ] 返回 `{ outputPath, mimeType, sizeBytes, dataUrl }`
- [ ] 支持 input 是文件路径 or Buffer
- [ ] 低端电脑（< 4 核或 < 4GB RAM）自动降到 worker=1
- [ ] 异常分类：input 文件不存在 / sharp 解码失败 / 磁盘满

## 不做

- 不实现复杂滤镜（v1 只做加白 + resize）
- 不做缓存（hash 不同就重做）

## 实施提示

sharp 装 `pnpm add -F @tengyu-aipod/client sharp@latest`。Electron 打包注意 sharp 的 native binary 重编译（用 electron-rebuild）。

## 完成后

```bash
git add -A
git commit -m "feat(task): sharp preprocess worker pool"
python3 .trellis/scripts/task.py archive 05-23-sharp-preprocess-pool
```
