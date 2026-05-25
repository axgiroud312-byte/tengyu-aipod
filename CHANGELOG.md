# Changelog

## Unreleased

### Added

- PS 套版能力：Windows 本机通过 Photoshop COM bridge 调用真实 Photoshop，支持 PSD 模板扫描、JSX 生成、智能对象替换、多模板批次、裁切策略、跳过已完成、进度日志和基础 UI。
- PS 套版真实验证：已在本机 Photoshop 27.7.0 上执行可用 fixture 范围内的真实 COM 测试，并生成输出证据目录。

### Known Limitations

- PS 套版 v1 为 Windows-only，需要 Photoshop 2023+，通过 `New-Object -ComObject Photoshop.Application` + `DoJavaScriptFile` 执行；macOS 不支持该能力。
- 真实 PS 测试需要显式设置 `REAL_PS=1`；会写入真实输出目录或覆盖文件的操作还需要 `REAL_PS_MUTATE=1`。
- 当前本机 E2E fixture 只有 2 个 PSD 和 3 张素材，未满足 3 PSD + 5 印花的完整手动矩阵。
- 当前仓库还没有可执行的采集、检测、生图、上架模块实现，因此 v1.0.0 全链路 E2E 尚未放行。
