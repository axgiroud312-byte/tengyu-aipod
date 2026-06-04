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
- 完整任务最初版：新增固定跨模块流程页面和主进程服务，支持采集目录 / 文生图 / 图生图 / 已有印花作为来源，按可选抠图、可选侵权检测、PS 套版、标题生成顺序执行。
- 完整任务运行记录：新增 `pipeline_runs` / `pipeline_steps` 本地 SQLite 记录、进度事件、取消入口和最近运行列表；检测中 `block` 拦截，`pass` / `review` 放行。

### Known Limitations

- PS 套版 v1 为 Windows-only，需要 Photoshop 2023+，通过 `New-Object -ComObject Photoshop.Application` + `DoJavaScriptFile` 执行；macOS 不支持该能力。
- 完整任务最初版包含 PS 套版，所以同样仅能在 Windows 启动；macOS 上完整任务入口提示不可启动。
- 完整任务最初版不包含上架，不支持暂停/恢复/断点续跑，也不是自由流程编辑器；这些留给后续通用编排引擎。
- 真实 PS 测试需要显式设置 `REAL_PS=1`；会写入真实输出目录或覆盖文件的操作还需要 `REAL_PS_MUTATE=1`。
- 当前本机 E2E fixture 只有 2 个 PSD 和 3 张素材，未满足 3 PSD + 5 印花的完整手动矩阵。
- v1.0.0 全链路 E2E 仍需用真实账号和真实素材做最终人工放行；采集模块已有本地实现和定向测试。
