# Task: 状态徽章 + 定期轮询（切片 1 - 第 9 个，最后一个）

## 目标

客户端右上角显示激活状态徽章 + 每 30 分钟轮询 `/api/status` + 时钟回拨检测 + 离线宽限。

## 输入

- 参考：`docs/spec/09-cross-cutting.md §13.1`（徽章 UI）
- 参考：`docs/PRD.md §10`（v1 安全 7 项基础防御 - 第 3, 4 项）

## 验收标准

### 徽章 UI

- [ ] 主窗口右上角永远展示徽章（不挡内容）
- [ ] 状态：
  - 🟢 激活·剩余 N 天
  - 🟡 即将过期·N 天内（< 7 天显示）
  - 🔴 已过期（阻断使用，仅开放"输入新激活码"）
  - 🔴 已封号（阻断使用 + 显示原因）
  - 🟢 试用·N 天剩余（如果是匿名码）
- [ ] 点徽章 → 弹出激活信息卡片（设备名、绑定数、码后 4 位、[解绑本机] [输入新激活码]）

### 轮询

- [ ] 主进程内每 30 分钟（推荐）调一次 `/api/status`
- [ ] 成功 → 更新数据库 `activation_state.cached_status_json`
- [ ] 失败 → 看错误类型：
  - 网络断开 → 继续用缓存（不影响使用）
  - 401 UNAUTHORIZED → 阻断 + 弹"激活已失效，请重新激活"
  - 5xx → 重试 3 次后用缓存
- [ ] 每次调用前**记录服务端时间戳**到 `activation_state.last_server_check`

### 时钟回拨检测

- [ ] 每次启动 + 每次任务执行前调用 `verifyClock()`：
  - 读 `activation_state.last_server_check`
  - 读本机当前时间
  - 若本机时间 < last_server_check → 异常，阻断使用并提示"系统时间异常，请校准"
- [ ] 用户手动校准后允许继续

### 离线宽限

- [ ] 如果 `now() - last_server_check > 7 days` → 阻断 + 强制重连
- [ ] < 7 天 → 允许离线使用，但每次启动 toast 提示"已 X 天未联网"

### 状态变化推送

- [ ] 通过 IPC `activation:status-changed` 推给渲染进程
- [ ] 徽章 UI 用 Zustand store 订阅，实时更新

### 关键操作前检查

- [ ] 生图 / 上架等关键操作启动前调 `requireActiveAndRecent()`：
  - 检查激活 + last_server_check 在 1 小时内
  - 否则强制先调一次 status 同步

## 不做

- 不在客户端做"代币交易"
- 不实现自动重新激活（用户手动）

## 实施提示

```ts
// main/services/activation/poller.ts
class ActivationPoller {
  private intervalId: NodeJS.Timeout | null = null
  
  start() {
    this.poll()  // 立即一次
    this.intervalId = setInterval(() => this.poll(), 30 * 60 * 1000)
  }
  
  async poll() {
    const token = await keychain.getSecret('activation_token')
    if (!token) return
    
    try {
      const res = await fetch(`${SERVER_URL}/api/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        await this.handleUnauthorized()
        return
      }
      const data = await res.json()
      await db.activationState.update({
        where: { id: 1 },
        data: {
          cached_status_json: JSON.stringify(data.data),
          last_server_check: Date.now(),
        },
      })
      mainWindow.webContents.send('activation:status-changed', data.data)
    } catch (e) {
      // 网络断 → 不更新 last_server_check，继续用缓存
    }
  }
}

// main/lib/clock-check.ts
export async function verifyClock(): Promise<{ ok: boolean; reason?: string }> {
  const state = await db.activationState.findUnique({ where: { id: 1 }})
  if (!state) return { ok: false, reason: 'NOT_ACTIVATED' }
  
  const now = Date.now()
  if (now < state.last_server_check) {
    return { ok: false, reason: 'CLOCK_ROLLED_BACK' }
  }
  
  if (now - state.last_server_check > 7 * 86400 * 1000) {
    return { ok: false, reason: 'OFFLINE_TOO_LONG' }
  }
  
  return { ok: true }
}
```

## 完成后

```bash
git add -A
git commit -m "feat(task-14): client status badge + polling + clock check"
python3 .trellis/scripts/task.py archive 05-23-client-status-badge
```

至此**切片 1 完成**——激活码闭环可用，可以发 v0.1.0 给信任的朋友试用。
```bash
git tag v0.1.0
git push origin v0.1.0
```
