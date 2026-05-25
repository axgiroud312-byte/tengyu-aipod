# Task: Shein - smoke 验证（切片 8 - 上架 - Shein）

## 目标

真实 Shein 环境验证。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只参考流程，不 Port DOM 代码）

## 真实测试基线（MVP v1）

**必须用主理人本机比特浏览器 `2-1111` 窗口 + 真实店小秘 Shein 草稿**，禁止 fixture / mock。

接入：bit-browser-adapter list-profiles 找 `2-1111` → connectOverCDP。

测试守护：`REAL_LISTING=1 pnpm -F @tengyu-aipod/client e2e --grep "shein smoke"`。
破坏性操作（二级守护）：生成 SKU / 上传图片 / 上传视频 只有在 `REAL_LISTING_MUTATE=1` 时允许真实执行。

## 验收标准

- [ ] 主理人本机 `2-1111` 窗口已登录店小秘并保持
- [ ] 跑 **Shein** 模板：https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551
  - 素材：`/Users/macmini/Desktop/服装素材摆放举例/GzG0001`
  - 验证：店铺名 / 标题 / 图片 / 一键 SKU / 一键视频 全部成功
- [ ] 5 项核心动作必须覆盖：替换店铺名称、替换标题、替换图片、一键生成 SKU、一键上传视频
- [ ] 所有 stage 完成 + listing_status='success'
- [ ] 店小秘后台能看到草稿被改对
- [ ] 录像 / 截图存到 `.trellis/tasks/05-23-listing-shein-smoke/evidence/`
- [ ] 验证记录写到 `info.md`

## 不做

- 不真发布到 Shein（保存草稿即可）
- 不在 CI 跑（`REAL_LISTING=1` 守护）

## 实施提示



## 完成后

```bash
git add -A
git commit -m "test(task): shein manual smoke"
python3 .trellis/scripts/task.py archive 05-23-listing-shein-smoke
```
