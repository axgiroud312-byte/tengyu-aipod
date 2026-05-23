# Task: OS Keychain Token 存储（切片 1 - 第 8 个）

## 目标

封装 OS keychain 加密存储工具，安全保存 activation_token 和所有外部 API Keys。

## 输入

- 参考：`docs/spec/00-overview.md §3, §10`（API Key 永远 OS keychain）
- 参考：Electron 官方 `safeStorage` API

## 验收标准

- [ ] 主进程模块 `packages/client/src/main/lib/keychain.ts`：
  - `setSecret(key: string, value: string): Promise<void>` — 加密 + 持久化
  - `getSecret(key: string): Promise<string | null>` — 读取 + 解密
  - `deleteSecret(key: string): Promise<void>`
  - `hasSecret(key: string): Promise<boolean>`
- [ ] 用 `electron.safeStorage` 做加密
- [ ] 加密后的 buffer 保存到 `app.getPath('userData')/secrets.json`（base64 编码）
- [ ] 启动时检查 `safeStorage.isEncryptionAvailable()` —— false 时回退到明文（仅开发模式）并发出 warning
- [ ] 提供 IPC：
  - `keychain:has` { key } → boolean
  - 不提供 `get` IPC（渲染进程不应直接拿明文 secret）
- [ ] 单元测试：set / get / delete / has 各覆盖

### 关键约束

- **渲染进程永远不能拿到 secret 明文**
- 渲染进程的 IPC 接口只能：
  - 设置 secret（提交后立即加密 + 存）
  - 检查是否存在
  - 调外部 API 时由主进程内部用 secret，不传给 renderer

### 已知 keys

| key | 用途 |
|---|---|
| `activation_token` | 客户端 JWT |
| `chenyu_api_key` | 晨羽智云 |
| `grsai_api_key` | Grsai |
| `bailian_api_key` | 阿里云百炼 |
| `bitbrowser_url` | 比特浏览器地址（非 secret，但同存方便管理）|

## 不做

- 不实现 keychain 迁移（v1 没历史数据）
- 不上 OAuth 密码学方案（v1 直接 safeStorage 够）

## 实施提示

```ts
// main/lib/keychain.ts
import { safeStorage, app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const FILE = path.join(app.getPath('userData'), 'secrets.json')

async function readStore(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(FILE, 'utf-8')) } catch { return {} }
}

async function writeStore(store: Record<string, string>) {
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), 'utf-8')
}

export async function setSecret(key: string, value: string) {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('safeStorage not available; falling back to plain (dev only)')
  }
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString('base64')
    : Buffer.from(value).toString('base64')
  const store = await readStore()
  store[key] = encrypted
  await writeStore(store)
}

export async function getSecret(key: string): Promise<string | null> {
  const store = await readStore()
  const val = store[key]
  if (!val) return null
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(val, 'base64').toString('utf-8')
  }
  return safeStorage.decryptString(Buffer.from(val, 'base64'))
}
```

## 完成后

```bash
git add -A
git commit -m "feat(task-13): OS keychain encrypted secret storage"
python3 .trellis/scripts/task.py archive 05-23-client-keychain
```
