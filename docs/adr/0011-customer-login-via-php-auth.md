# ADR-0011 — 客户登录复用 PHP 统一登录，Next 只做授权

**状态**：Accepted
**日期**：2026-06-02

---

## 背景

原 v1 设计不做客户端授权拦截，客户记录只用于 Admin 后台管理。现在商业化需求调整为：客户必须登录，并由管理员在后台授权后，才能使用 Workbench。

腾域已有 PHP 统一登录体系：

```text
https://www.tengyuai.com/
```

PHP 登录成功后返回：

```json
{
  "uid": 123,
  "secret": "xxxxxxxx"
}
```

旧 PHP 登录态是按 `uid + secret` 校验的单点登录机制；同一 `uid` 只有一个当前 `secret`，新登录会让旧登录态失效。

## 决策

采纳“PHP 负责登录，Next 负责授权”的方案：

- 客户端登录方式复用旧 PHP：微信扫码、手机号验证码。
- 客户端主进程保存 `uid + secret`，渲染进程不直接拿 `secret`。
- 客户端生成稳定 `finger` 并在 PHP 登录、轮询、用户信息校验请求中携带。
- Next 新增 `POST /api/customer-auth/verify`，临时调用 PHP `/user/user/info` 验证 `uid + secret + finger`。
- Next 以 PHP `uid` 作为 `CustomerAccount.php_uid`，查找或自动创建客户账号。
- 首次登录客户默认为 `pending`，管理员授权后变为 `active`。
- `active` 必须有 `expires_at`；`expires_at` 小于当前时间时按 `expired` 处理。
- `disabled`、`pending`、`expired` 客户不能进入 Workbench。
- 客户端停留在 `pending` 登录页时每 3 秒复查一次授权，管理员授权后自动进入 Workbench。
- 客户端启动时强校验，运行中每 5 分钟复查一次。
- 发现 PHP 返回 `nologin: 1` 或 Next 授权失效时，客户端清空本地登录态并回登录页。

Next 数据库不保存 PHP `secret`。

## 客户状态

| 状态 | 含义 | 是否可用 |
|---|---|---|
| `pending` | 首次登录后等待管理员开通 | 否 |
| `active` | 已授权且未到期 | 是 |
| `disabled` | 管理员禁用 | 否 |
| `expired` | `active` 但 `expires_at` 已过期 | 否 |

`expired` 是计算状态，不一定需要作为数据库 enum 落库。

## 数据模型

新增 `CustomerAccount`：

- `id`
- `php_uid`
- `nickname`
- `avatar_url`
- `phone`
- `account`
- `status`
- `expires_at`
- `notes`
- `approved_at`
- `approved_by_admin_id`
- `disabled_at`
- `last_login_at`
- `created_at`
- `updated_at`

规则：

- `php_uid` 唯一。
- `active` 状态必须有 `expires_at`。
- `secret` 不保存到 Next 数据库。
- 旧 `Customer` 表第一版不做破坏性删除，但 `/admin/customers` 不再作为主客户授权入口。

## 接口边界

客户端 IPC：

- `customerAuth:getState`
- `customerAuth:getQrcode`
- `customerAuth:checkWechatLogin`
- `customerAuth:sendSms`
- `customerAuth:getSmsCountdown`
- `customerAuth:loginByPhone`
- `customerAuth:verify`
- `customerAuth:logout`

Next 客户授权接口：

```http
POST /api/customer-auth/verify
```

请求：

```json
{
  "uid": 123,
  "secret": "xxxxxxxx",
  "finger": "device-fingerprint"
}
```

Admin API：

```http
GET   /admin/api/customer-accounts
GET   /admin/api/customer-accounts/:id
POST  /admin/api/customer-accounts/:id/approve
PATCH /admin/api/customer-accounts/:id
POST  /admin/api/customer-accounts/:id/disable
POST  /admin/api/customer-accounts/:id/enable
```

Admin 登录继续使用邮箱密码和管理员 JWT，不接微信、不接 PHP 登录；后台管理员账号由 `/admin/admins` 独立管理。

## 设备指纹

第一版使用最小硬件信息哈希：

- `hostname`
- `platform`
- `arch`
- `userData` 路径

不采集网卡 MAC。生成后本地持久化，保证同一机器稳定。

## 影响

正向影响：

- 客户准入可由 Admin 后台控制。
- 微信扫码和手机号验证码复用旧 PHP 体系，不重新开发 OAuth。
- 沿用旧 PHP 单点登录规则，不新增席位系统。
- Next 继续保持轻量，只保存授权状态，不保存 `secret`。

代价：

- Workbench 启动依赖 PHP 登录服务和 Next 授权服务。
- 服务端不可用时，未完成授权校验的客户不能进入 Workbench。
- `pending` 页面会短轮询授权接口，pending 客户量异常增长时需要关注 Next/PHP 授权接口压力。
- 同一账号在另一端重新登录后，当前 Workbench 会被踢回登录页。

## 不做

- 不重新开发微信开放平台 OAuth。
- 不做后台席位数。
- 不做多机同时在线。
- 不做手机号绑定或修改。
- 不做微信和手机号账号合并。
- 不做套餐管理、支付或自助续费。
- 不做模块级权限。
- 不让服务端代理生图、LLM，或接触用户图片、API Key、任务数据。
