# Task: Admin 激活码管理 UI（切片 1 - 第 3 个）

## 目标

实现 `/admin/codes` 激活码列表 + 三种创建模式 + 单码操作。

**这是后台最重要的页面，你的日常运维都在这里。**

## 输入

- 参考：`docs/spec/08-server.md §6.3-6.4`（激活码列表 + 创建）
- 参考：`docs/adr/0002-activation-code-no-accounts.md`

## 验收标准

### 列表页

- [ ] `/admin/codes`：表格展示所有激活码
- [ ] 字段：码 / 客户名 / 联系方式 / 天数 / 设备 / 已激活 / 剩余天 / 批次 / 状态 / 操作
- [ ] 筛选：全部 / 已激活 / 未激活 / 即将过期(7天) / 已封号
- [ ] 批次过滤下拉
- [ ] 搜索（按码 / 客户名 / 手机号）
- [ ] 排序（按到期日 / 创建日）
- [ ] 分页（默认 50 行）

### 创建激活码

- [ ] 顶部 [+ 新建激活码] 按钮 → 弹出 Dialog 或跳转 `/admin/codes/new`
- [ ] 三种模式 Tab：
  - **单个创建**：客户信息 + 智能匹配 + 激活码配置
  - **批量匿名**：天数 + 设备数 + 数量 + 批次备注 → 下载 CSV
  - **批量预绑客户**：天数 + 设备数 + 上传 CSV → 预览 → 生成 → 下载 CSV
- [ ] 单个创建：按手机号智能匹配老客户
- [ ] 批量匿名：生成的码以 `batch_id = uuid` 标记
- [ ] 批量预绑：解析 CSV（columns: name, phone, email?, wechat?, notes?）+ 显示重复客户提示

### 码操作

- [ ] `[+30天]` / `[+90天]` / `[+365天]` / 自定义天数
- [ ] `[改设备数]` → 弹窗 → 若改小到 < 已激活，强制选解绑哪些
- [ ] `[解绑设备]` → 列出该码的设备 → 选某条解绑（删 DeviceActivation 行）
- [ ] `[封号]` → 确认 → `is_active = false`
- [ ] `[关联客户]`（匿名码专用）→ 选已有客户或新建

### 码生成器

- [ ] 工具函数 `generateCode()`：格式 `POD-XXXX-YYYY-ZZZZ`，每段大写字母+数字，全机器内确保唯一

### API

- [ ] `POST /admin/api/codes` 创建（单/批量）
- [ ] `GET /admin/api/codes` 列表 + 过滤 + 分页
- [ ] `PATCH /admin/api/codes/:code` 改天数/设备数/状态
- [ ] `POST /admin/api/codes/:code/unbind-device` 解绑
- [ ] `POST /admin/api/codes/:code/link-customer` 关联客户

## 不做

- 不发激活码邮件（v1 你手动发）
- 不实现"自动续费"逻辑
- 不实现导出/导入功能（v1.5）

## 实施提示

码生成：

```ts
import { randomBytes } from 'crypto'

function generateCode(): string {
  const CHARS = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789'  // 去掉 O/0/1/l 易混
  function segment() {
    const bytes = randomBytes(4)
    return Array.from(bytes).map(b => CHARS[b % CHARS.length]).join('')
  }
  return `POD-${segment()}-${segment()}-${segment()}`
}
```

CSV 解析推荐用 `papaparse`。

UI 用 shadcn/ui 的 Dialog / Table / Form / Select / Tabs。

## 完成后

```bash
git add -A
git commit -m "feat(task-08): admin codes management UI"
python3 .trellis/scripts/task.py archive 05-23-admin-codes-ui
```
