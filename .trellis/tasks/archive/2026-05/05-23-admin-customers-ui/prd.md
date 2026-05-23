# Task: Admin 客户管理 UI（切片 1 - 第 4 个）

## 目标

实现 `/admin/customers` 客户列表 + `/admin/customers/:id` 客户详情。

## 输入

- 参考：`docs/spec/08-server.md §6.5-6.6`

## 验收标准

### 客户列表

- [ ] `/admin/customers`：表格
- [ ] 字段：客户名 / 手机 / 微信 / 激活码数 / 最长剩余天 / 总设备数（用 / 总）/ 最近活跃 / 状态 / 操作
- [ ] 搜索（姓名 / 手机 / 微信）
- [ ] 排序（按最近活跃 / 创建时间）

### 客户详情

- [ ] `/admin/customers/:id`：
  - 基本信息卡片（姓名 / 手机 / 微信 / 备注 / 状态 / 创建时间） + [编辑] [封号该客户]
  - 该客户名下所有激活码（同 `/admin/codes` 的子集）
  - 所有设备列表（含码、设备名、指纹、激活时间、最近活跃、[解绑]）
  - [+ 给该客户发新激活码] 按钮（跳到 codes/new 预填客户）

### API

- [ ] `GET /admin/api/customers`
- [ ] `GET /admin/api/customers/:id`
- [ ] `PATCH /admin/api/customers/:id` 改信息
- [ ] `POST /admin/api/customers/:id/ban` 封号（影响该客户所有码）

## 不做

- 不实现 [+ 新建客户] 独立流程（统一走 codes/new 的"单个创建"模式）
- 不实现导出客户名单（v1.5）

## 实施提示

客户列表的"最长剩余天"用 SQL 子查询：

```ts
const customers = await db.customer.findMany({
  include: {
    codes: {
      where: { is_active: true, expires_at: { gt: new Date() } },
      orderBy: { expires_at: 'desc' },
      take: 1,  // 最长剩余的码
      include: { devices: true },
    },
  },
})

// 在 UI 层算 max_remaining_days = (customer.codes[0]?.expires_at - now) / day
```

## 完成后

```bash
git add -A
git commit -m "feat(task-09): admin customers management UI"
python3 .trellis/scripts/task.py archive 05-23-admin-customers-ui
```
