# Task: 客户端首次启动引导（切片 1 - 第 7 个）

## 目标

实现客户端首次启动的 4 步向导：激活码 → 素材目录 → API Keys → 完成。

## 输入

- 参考：`docs/spec/09-cross-cutting.md §8`（4 步引导详细 UI）

## 验收标准

### Step 1 — 激活码

- [ ] 用户输入激活码（4 段 16 字符，自动转大写）
- [ ] 用户输入设备名（默认机器名）
- [ ] 调 `window.api.activation.activate({ code, device_name })` IPC
- [ ] 主进程：
  - 生成 device_fingerprint（SHA256 of CPU + 主板 + 网卡 MAC）
  - POST `/api/activate`
  - 成功 → 把 token 加密存 OS keychain（依赖 task-keychain）
  - 失败 → 把错误码翻译成中文友好消息返回 UI

### Step 2 — 素材总目录

- [ ] 默认建议路径：`~/腾域aipod素材/` （或 `Documents/腾域aipod素材/`）
- [ ] [浏览...] 按钮调系统目录选择对话框
- [ ] 选完后立即创建 5 大类子目录 + `.workbench/`
- [ ] 保存到 `app.getPath('userData')` 下的配置文件

### Step 3 — API Keys（可全跳过）

- [ ] 4 个输入框：晨羽 / Grsai / 阿里云百炼 / 比特浏览器地址
- [ ] 每个有 [跳过] 按钮 + [测试连接] 按钮
- [ ] [测试连接] 简单调一次最便宜的端点（晨羽 /balance/info / 百炼 list models / Grsai 直接生成测试图）
- [ ] 填了的 API Key 加密存 OS keychain
- [ ] [全部跳过] 按钮跳到 Step 4

### Step 4 — 完成

- [ ] 显示"✓ 软件已准备就绪"
- [ ] [开始使用] 按钮 → 进入主界面
- [ ] [查看教程视频] 链接（可暂时指向 placeholder URL）

### 路由

- [ ] 首次启动检测：若 SQLite `activation_state` 表为空 → 强制路由到 `/onboarding`
- [ ] 完成后写 `activation_state` 行 + 路由到 `/`

## 不做

- 不实现真的客服联系功能（链接到 placeholder）
- 不实现教程视频（v1.5）
- 不在 Step 3 强制要求至少填一个 API Key

## 实施提示

设备指纹生成（跨平台）：

```ts
import { createHash } from 'crypto'
import os from 'os'

function generateDeviceFingerprint(): string {
  const cpu = os.cpus()[0]?.model ?? ''
  const platform = os.platform()
  const arch = os.arch()
  const networkInterfaces = os.networkInterfaces()
  const macs = Object.values(networkInterfaces)
    .flat()
    .map(i => i?.mac)
    .filter(Boolean)
    .filter(m => m !== '00:00:00:00:00:00')
    .sort()
    .join(',')
  
  const seed = `${platform}|${arch}|${cpu}|${macs}|${os.hostname()}`
  return createHash('sha256').update(seed).digest('hex')
}
```

UI 用 shadcn/ui 的 Stepper（如果有）或自己实现简单的 Progress + 4 个 Card 切换。

## 完成后

```bash
git add -A
git commit -m "feat(task-12): client onboarding 4-step wizard"
python3 .trellis/scripts/task.py archive 05-23-client-onboarding
```
