# Task: Temu PopTemu - smoke 真实验证（切片 8 - 上架 - Temu PopTemu）

## 目标

在真实店小秘环境跑一遍完整 listing 验证。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只参考流程，不 Port DOM 代码）

## 真实测试基线（MVP v1）

**必须用主理人本机比特浏览器 `2-1111` 窗口 + 真实店小秘草稿**，禁止 fixture / mock。

接入：bit-browser-adapter list-profiles 找 `2-1111` → connectOverCDP。

测试守护：`REAL_LISTING=1 pnpm -F @tengyu-aipod/client e2e --grep "temu smoke"`。
破坏性操作（二级守护）：生成 SKU / 上传图片 / 上传视频 只有在 `REAL_LISTING_MUTATE=1` 时允许真实执行。

## 验收标准

- [ ] 主理人本机 `2-1111` 窗口已登录店小秘并保持
- [ ] 跑 **Temu 服装** 模板：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515
  - 素材：`/Users/macmini/Desktop/服装素材摆放举例`（排除 `GzG00010`）
  - 验证：店铺名 / 标题 / 图片 / 一键 SKU / 一键视频 全部成功
- [ ] 跑 **Temu 百货** 模板：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551
  - 素材：`/Users/macmini/Desktop/素材文件夹`
  - 验证：同上 5 项
- [ ] 5 项核心动作必须覆盖：替换店铺名称、替换标题、替换图片、一键生成 SKU、一键上传视频
- [ ] 12 阶段全部完成 + listing_status='success'
- [ ] 店小秘后台能看到草稿被改对
- [ ] 录像 / 截图存到 `.trellis/tasks/05-23-listing-temu-smoke/evidence/`
- [ ] 验证记录写到 `info.md`

## 不做

- 不真发布到 Temu（保存草稿即可）
- 不在 CI 跑（`REAL_LISTING=1` 守护）

## 实施提示

主理人会保持 `2-1111` 窗口登录并打开两个模板页。参考 `/Users/macmini/Desktop/一键pod/上架程序` 的提交流程，但选择器全部按 SKILL 重写。

## 完成后

```bash
git add -A
git commit -m "test(task): temu pop manual smoke validation"
python3 .trellis/scripts/task.py archive 05-23-listing-temu-smoke
```
