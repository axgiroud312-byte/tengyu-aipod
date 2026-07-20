# PS 套版模板 Checklist（运营 / 设计）

> 目的：让默认任务稳定走 **路径 A + 原生切片快路径**。  
> 相关：[photoshop-speed-stability-recommendations.md](./photoshop-speed-stability-recommendations.md) · [spec/05-photoshop.md](./spec/05-photoshop.md)

## 必做（否则会慢或失败）

1. **用户切片或图层切片**  
   - 多视图成品必须在 PSD 里切好。  
   - **不要依赖自动切片**（程序会忽略自动切片）。  
   - 无有效切片时任务仍会跑，但会回退 `duplicate + crop`，**明显变慢**。

2. **印花目标层用嵌入式智能对象**（默认）  
   - 链接 SO 仅在明确需要时使用，并手动选路径 B（进入内部替换）。

3. **默认走路径 A**  
   - 智能对象替换方式选「直接替换内容」。  
   - 路径 B 只给 300dpi 链接 SO 等特殊模板。

4. **目标 SO 图层名唯一**  
   - 推荐 `@印花` 前缀或固定命名，避免多图层重名导致选错层。

5. **替换范围优先「最上方」或「自动」**  
   - 完整任务通常一印花一货号；`全部智能对象` 会更慢。

6. **打开「跳过已完成」**  
   - 重跑 / 中断续跑只补缺口。

## 建议（吞吐与稳定）

7. 去掉无用大图层、隐藏占位层，控制 PSD 体积。  
8. 切片命名稳定、可读（便于 Save for Web 文件名对齐）。  
9. 本机 PS：History States 调低（如 5–20），暂存盘留足空间。  
10. 印花尺寸与 SO 画布由**模板 + 上游导出约定**匹配；套版**不会**自动缩放印花。

## 任务日志怎么读

| 日志 stage | 含义 |
|---|---|
| `template_path_profile` + `fast_path_ok` | 可走快路径 |
| `native_slice_detected` | 识别到有效原生切片 |
| `native_slice_fallback` / `slow_export` | 无有效切片，裁切慢路径 |
| `native_slice_export_fallback` | Save for Web 对不齐，本货号回退 bounds 裁切（慢） |
| `purge_histories` | 长跑清理 PS 历史缓存（默认约每 25 组） |

## 明确不要

- 把自动切片当有效导出区域  
- 全员默认路径 B  
- 期望套版阶段自动改印花尺寸  
