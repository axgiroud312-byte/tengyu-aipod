# Changelog

## Unreleased

### Added

- 采集模块：比特浏览器接入 / CDP / 点击 / 滚动 / 会话 FSM / 注入脚本 / records / 图池扫描 / 商品页主图分组 / 运行期日志弹窗
- 检测模块：百炼适配 / 阈值配置 / 成本估算 / 工作台 UI / 一键加入待套版 / E2E
- 标题模块：服务 / Skill 缓存 / UI / E2E
- 生图 Grsai：adapter / 并发控制 / 骨架 / 提示词服务 / 三条 UI 链路（txt2img / img2img / extract）/ E2E
- 生图 ComfyUI：晨羽 adapter / HTTP adapter / 实例管理 / 执行引擎 / 抠图 / 三条 UI 链路 / E2E
- 上架模块（Temu + Shein）：listing-automation-builder SKILL 四层结构 / Profile 锁 / 批次加载 / 断点续传 / 证据 / UI / 失败重试 / 真实店小秘 smoke
- PS 套版能力：Windows 本机通过 Photoshop COM bridge 调用真实 Photoshop，支持 PSD 模板扫描、JSX 生成、智能对象替换、多模板批次、裁切策略、跳过已完成、进度日志和基础 UI。
- PS 套版真实验证：已在本机 Photoshop 27.7.0 上执行可用 fixture 范围内的真实 COM 测试，并生成输出证据目录。
- 完整任务最初版：新增固定跨模块流程页面和主进程服务，支持采集目录 / 文生图 / 图生图作为页面来源，底层兼容已有印花入口，按可选抠图、可选侵权检测、PS 套版、标题生成顺序执行。
- 完整任务印花货号：启动前填写印花货号，PS 前复制到 `02-印花工作区/等待套版/{runId}/`；单张按 `{印花货号}.{ext}` 命名，多张自动追加 `-01`、`-02`，PS 输出货号文件夹同名。
- 完整任务运行记录和预览：新增 `pipeline_runs` / `pipeline_steps` 本地 SQLite 记录、进度事件、取消入口、最近运行列表、来源图/提示词/运行产物预览；检测中 `block` 拦截，默认 `pass` / `review` 放行，也可选择只放行 `pass`。

### Changed

- 完整任务页：AI 生成提示词模式下的“印花要求”改为下拉式输入，默认收起显示摘要，展开后输入并可收回，减少来源配置区的视觉占用。
- 完整任务页：抠图、侵权检测、PS 套版和标题生成改为显式开关，未开启的后续步骤不再阻塞启动；图生图来源改为上传/删除参考图，来源图预览支持折叠。

### Known Limitations

- PS 套版 v1 为 Windows-only，需要 Photoshop 2023+，通过 `New-Object -ComObject Photoshop.Application` + `DoJavaScriptFile` 执行；macOS 不支持该能力。
- 完整任务仅在启用 PS 套版时要求 Windows；关闭 PS 套版后可在 macOS 运行前置步骤。
- 完整任务最初版不包含上架，不支持暂停/恢复/断点续跑，也不是自由流程编辑器；这些留给后续通用编排引擎。
- 真实 PS 测试需要显式设置 `REAL_PS=1`；会写入真实输出目录或覆盖文件的操作还需要 `REAL_PS_MUTATE=1`。
- 当前本机 E2E fixture 只有 2 个 PSD 和 3 张素材，未满足 3 PSD + 5 印花的完整手动矩阵。
- v1.0.0 全链路 E2E 仍需用真实账号和真实素材做最终人工放行；采集模块已有本地实现和定向测试。
