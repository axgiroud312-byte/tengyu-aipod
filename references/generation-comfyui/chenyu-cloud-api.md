# 晨羽智云 API 参考（腾域 aipod 集成版）

> 抓取自官方文档 2026-07-18，作为 comfyui 生图模块对接的工程参考。
> 官方文档持续更新，**实施前重新核对**。

## 官方文档入口

| 用途 | 链接 |
|---|---|
| 文档首页 | https://enterprise.chenyu.cn |
| 简介 | https://enterprise.chenyu.cn/userguide/introduction |
| 快速开始 | https://enterprise.chenyu.cn/userguide/quickstart |
| API 认证 | https://enterprise.chenyu.cn/userguide/authentication |
| API 参考索引 | https://enterprise.chenyu.cn/api-reference/introduction |
| 控制台（注册/拿 Key） | https://www.chenyu.cn/console/apiServer |
| 官方文档 LLM 索引 | https://chenyu.mintlify.app/llms.txt |

---

## 1. 基础信息

```
Base URL:      https://www.chenyu.cn/api/open/v2
Auth Header:   Authorization: Bearer <API_KEY>
Content-Type:  application/json
Encoding:      UTF-8
Methods:       GET / POST
```

API Key 前缀：文档里出现过 `cy_xxx` 和 `sk-xxx` 两种，**以控制台实际给的为准**。

### 统一响应格式

```json
{
  "code": 0,         // 0 = 成功；其他 = 失败
  "msg": "成功",
  "data": { ... }    // 查询和创建接口有业务数据；动作接口可能省略
}
```

### HTTP 状态码

| 码 | 含义 |
|---|---|
| 200 | 成功（业务结果看 body.code） |
| 400 | 参数错误 |
| 401 | API Key 无效/过期/未授权 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 429 | 限速（响应头 `Retry-After` 给秒数） |
| 500 | 服务器错误 |

### 实例状态码（重要）

| status | 含义 |
|---|---|
| 1 | 已创建 / 初始化中 |
| 2 | 运行中 ✅（可连接 ComfyUI） |
| 21 | 关机中 |
| 22 | 已关机 |

### 限速处理

```
收到 429 → 读取 Retry-After 响应头 → 指数退避（2^n + jitter）重试 → 最多 3 次
```

---

## 2. 认证

```
Authorization: Bearer <你的 API Key>
```

- API Key 在控制台 → API管理 → 创建。**Key 仅显示一次，必须本地妥存。**
- 客户端**不要硬编码 Key**，必须存 OS keychain（Electron 用 `safeStorage`）。
- 401 时：Key 无效 / 过期 / 被禁用。
- 验证 Key 有效：当前实现调 `GET /balance/info`，但设置页只显示连接成功/失败，**不展示余额**。

---

## 3. 资源查询（创建实例前用）

### 3.1 GET /pod/list — 应用市场 Pod

Pod = 预装应用环境的镜像模板（如"PyTorch 深度学习"、"ComfyUI 工作流"等）。

请求参数（query）：
- `page` (int, 可选)
- `page_size` (int, 可选)
- `name` (string, 可选) — 名称模糊匹配

响应（示例）：
```json
{
  "code": 0,
  "data": {
    "pod_list": [
      {
        "title": "PyTorch 深度学习环境",
        "uuid": "pod_xxxx",
        "remark": "预装 PyTorch 2.0...",
        "pod_tag": ["v1.0", "v2.0"],     // 可用版本标签
        "price": {                        // 单位：元
          "hour": 2.5, "day": 50.0,
          "week": 300.0, "month": 1200.0, "year": 12000.0
        }
      }
    ],
    "total": 1
  }
}
```

**对腾域的意义**：创建入口只保留标题精确匹配 `杭州慎思comfyui镜像` 的 POD，并用其 `pod_tag` 列表提供版本选择；创建时由主进程再次查询并校验 UUID。

### 3.2 GET /gpu/list — GPU 型号

响应（示例）：
```json
{
  "code": 0,
  "data": {
    "gpu_list": [
      {
        "gpu_name": "NVIDIA RTX 4090",
        "gpu_uuid": "gpu_xxxx",
        "status": 1,                      // 1 = 可用
        "price": { "hour": 5.50, ... }   // 单位：元/小时
      }
    ],
    "total": 2
  }
}
```

**实际计费 = Pod.price + GPU.price**（待跑通确认）。

### 3.3 GET /image/market/list — 市场镜像

需要时再查（创建实例可以走 `create_by_image` 而不是 `create_by_pod`）。
响应里含 `components`：`CUDA / Python / PyTorch / TensorFlow / Ubuntu` 版本。

---

## 4. 实例生命周期

### 4.1 POST /instance/create_by_pod — 创建实例

请求体：
```json
{
  "pod_uuid": "pod_xxxx",
  "pod_tag": "latest",           // 或具体版本如 "v2.0"
  "gpu_uuid": "gpu_xxxx",
  "gpu_nums": 1                  // 支持 1/2/4/8
  // 注：文档示例里出现过 "auto_start": 1 字段，待实测
}
```

成功响应：
```json
{
  "code": 0,
  "data": {
    "instance_uuid": "inst_xxxx",
    "status": 1,
    "title": "...",
    "create_time": 1703145600,    // 秒级时间戳
    "start_time": 1703145660,
    "image_uuid": "...",
    "image_name": "...",
    "image_tag": "v2.0",
    "gpu_uuid": "...",
    "gpu_name": "NVIDIA RTX 4090",
    "gpu_nums": 1,
    "charging_type": 1,
    "shutdown_regular": { "shutdown_time": 1703232000, "enable": true }
  }
}
```

**实例启动需要 1-3 分钟**（视镜像大小、网络、资源繁忙度）。
创建后**轮询 instance/list 或 instance/info**，等 `status=2` 才可连接 ComfyUI。

### 4.2 GET /instance/list — 列出我的实例

请求参数（query）：
- `page`, `page_size`

响应（每条字段同 4.3，新增 `total`）。

### 4.3 GET /instance/info — 实例详情（含 ComfyUI 地址）

请求参数（query）：
- `instance_uuid` (string, required)

响应：
```json
{
  "code": 0,
  "data": {
    "instance_uuid": "...",
    "status": 2,
    "title": "...",
    "create_time": 1699000000,
    "start_time": 1699001000,
    "server_url": ["https://xxx.chenyu.team"],    // 简版地址列表
    "server_map": [                                // ⭐ 完整端口映射
      {
        "title": "ComfyUI",                        // 或 "Jupyter Lab" 等
        "url": "https://comfyui-instxxx.chenyu.team",
        "port_type": "http",
        "protocol": "tcp"
      },
      {
        "title": "SSH Terminal",
        "url": "ssh://ssh-instxxx.chenyu.team:22",
        "port_type": "ssh",
        "protocol": "tcp",
        "ssh_info": {
          "host": "instxxx.gzxx.chenyu.team",
          "port": 22001,
          "username": "root",
          "password": "generated_password_xxx"
        }
      }
    ],
    "save_image_status": 3,
    "charging_type": 1,
    "shutdown_regular": { "shutdown_time": 0, "enable": false },
    "image_uuid": "...", "image_name": "...", "image_tag": "...",
    "gpu_uuid": "...", "gpu_name": "...", "gpu_nums": 1
  }
}
```

**腾域获取 ComfyUI 地址的逻辑**：
```
从 server_map 中找 port_type=="http" 且 title 含 "ComfyUI" 的条目
取其 url 作为 ComfyUI 的 HTTPS 端点
```

### 4.4 POST /instance/startup — 开机

请求体：
```json
{
  "instance_uuid": "...",       // required
  "gpu_uuid": "...",            // 可选，覆盖创建时的 GPU
  "gpu_nums": 1                 // 可选，覆盖创建时的数量
}
```

只对已关机实例（status=22）有效。开机后状态变 1 → 2。

成功响应只有 `{ "code": 0, "msg": "启动成功" }`，没有 `data`。

### 4.5 POST /instance/shutdown — 关机

请求体：`{ "instance_uuid": "..." }`

只对运行中实例（status=2）有效。**数据保留**（不丢失），可再次 startup。

成功响应只有 `code` 和 `msg`，没有 `data`。

### 4.6 POST /instance/restart — 重启

请求体：`{ "instance_uuid": "..." }`

### 4.7 POST /instance/destroy — 销毁（不可逆！）

请求体：`{ "instance_uuid": "..." }`

**永久删除所有数据**。腾域主实例列表不展示销毁；仅放在"高级设置"折叠区，必须二次确认，避免误删用户数据。
日常换运行状态只走 shutdown / startup。

### 4.8 POST /instance/save_image — 保存为个人镜像

留作高级功能，v1 不实现。

### 4.9 POST /instance/update_title — 更新标题

请求体：`{ "instance_uuid": "...", "title": "主力生图 4090" }`。

创建接口本身不接收标题；需要在创建成功后调用本接口。成功响应只有 `code` 和 `msg`，没有 `data`。

---

## 5. 关机策略 API（⚠️ 重要！）

### 5.1 POST /instance/shutdown_timer — 定时关机 ✅ 已上线

请求体：
```json
{
  "enable": true,
  "shutdown_time": 1703232000,     // 秒级时间戳（最小 5 分钟后）
  "instance_uuid": "..."
}
```

**取消**：`enable=false` 或 `shutdown_time=0`。

只有运行中的实例才能设置。成功响应只有 `code` 和 `msg`，没有 `data`。

> ⚠️ 文档示例的"60"既被当时间戳又被当分钟，参数语义有冲突。**实施前用一个真实实例测一遍**确定到底是时间戳还是分钟数。

### 5.2 POST /instance/set_idle_close — 空闲关机 ❌ **官方标注"未上线"**

文档显示此接口标题为"设置空闲关机(未上线)"。

约束（上线后可用）：
- `idle_period_minutes` 只能是 **10 / 30 / 60 / 120**（不支持 5 分钟）
- "空闲"定义：GPU 利用率 < 10% **且** 显存利用率 < 10%
- 设 0 = 取消

**对腾域的影响**：v1 **不能依赖空闲关机**。退而求其次用定时关机。

### 5.3 推荐的关机策略（v1）

```
创建实例时:
  ↓
轮询到实例运行后调 shutdown_timer，设定 N 小时后强制关机（N 默认 1）
  ↓
设置页实例管理:
  用户显式点击"关机" → 调 /instance/shutdown
  用户暂时不关 → 由定时关机兜底（不会无限计费）
```

**优势**：定时关机由晨羽侧执行，**软件崩溃/断网/进程被杀都不影响**。

---

## 6. 计费 API

### 6.1 GET /balance/info — 查询余额

无参数。响应：
```json
{
  "code": 0,
  "data": {
    "balance": 1250.50,        // 充值余额（元）
    "card_balance": 500.00     // 算力卡余额（元）
  }
}
```

**可用总额 = balance + card_balance**（待确认是否两者都能用于实例计费）。

### 6.2 GET /bill/list — 消费流水

按需查询历史账单，腾域客户端可在"设置 → 用量"里展示。

### 6.3 GET /recharge/list — 充值记录

### 6.4 GET /card/list — 算力卡

---

## 7. 工作流 API（⚠️ 草稿/Beta）

晨羽内置了"工作流市场"概念，可以直接 `submit` 一个工作流让晨羽帮你跑（不需要你自己调 ComfyUI HTTP）。

**但是**：
- 官方文档明确标注"**工作流管理（草稿）**"
- 接口可能变更
- 需要工作流先发布到晨羽市场（不适合我们派发的"印花提取/抠图"自定义工作流）
- 走预扣费 → 结算模式，账务模型复杂

### 7.1 POST /workflow/run/submit

请求体：
```json
{
  "workflow_id": "wf_xxx",
  "revision_id": "wfr_xxx",
  "inputs": { ... },                          // 来自工作流详情的 editable_parameter_manifest
  "idempotency_key": "用户生成的 UUID",       // ⭐ 防重复提交
  "accept_external_cost_risk": false          // 工作流要调外部模型时设 true
}
```

响应：
```json
{
  "code": 0,
  "data": {
    "run_order_id": "wfrun_xxx",       // 后续查进度/结果用这个
    "quote_amount": "0.03000000",      // 报价（预扣）
    "freeze_status": "frozen",
    "run_status": "queued",             // queued / running / succeeded / failed
    "task_id": "task_xxx",
    "prompt_id": "prompt_xxx",
    "idempotent_replay": false
  }
}
```

错误响应含 `data.error.engine_code` 和 `data.error.detail`，便于定位是输入问题还是执行引擎问题。

### 7.2 其他工作流 API

- GET `/workflow/market/list` — 工作流市场
- GET `/workflow/market/info` — 详情含可编辑参数清单
- GET `/workflow/run/list` — 运行列表
- GET `/workflow/run/info` — 单次运行详情
- GET `/workflow/run/execution` — 实时进度 + 日志 + 输出

### 腾域的取舍

主生图链路不用晨羽工作流接口，走 ComfyUI 原生 API：
- `POST {server_url}/upload/image` — 上传素材
- `POST {server_url}/prompt` — 提交工作流（body 含完整 workflow JSON）
- `GET {server_url}/history/{prompt_id}` — 轮询进度
- `GET {server_url}/view?filename=...` — 下载产物

工作流 JSON 现在由客户端本地导入和缓存，符合 ADR 思路：服务器不代理生图。

当前代码可保留晨羽 workflow market/run/execution 的轻量客户端能力，用于后续验证官方工作流接口；但用户在腾域生图模块跑杭州慎思 POD 时，默认路径仍是"默认云机 + ComfyUI 原生 HTTP"。

---

## 8. 客户端集成要点（腾域专用）

### 8.1 API Key 存储

- Electron `safeStorage` 加密 → 写入 OS keychain
- 启动时解密加载到主进程内存
- 渲染进程通过 IPC 拿到具体 API 调用结果，**不直接访问 Key**

### 8.2 实例选择和创建流程

```
1. /balance/info        仅用于验证 Key；UI 不展示余额
2. /gpu/list            列出 GPU（按可用状态/默认配置选择）
3. 杭州慎思comfyui镜像的实际 UUID + 用户选择的 pod_tag + GPU → /instance/create_by_pod
4. 轮询 /instance/info（每 5 秒）直到 status=2 且解析到 ComfyUI URL
5. /instance/update_title    可选设置用户自定义名称
6. /instance/shutdown_timer  可选设定时关机（仅运行状态可调用）
7. 保存为设置页的"默认云机"

实例管理：
1. /instance/list       列出当前 API Key 下全部实例
2. /instance/startup    用户点击开机后，行状态显示"初始化等待中"，轮询到 running
3. /instance/shutdown   用户点击关机后，行状态显示"关闭中"，轮询到 stopped
4. set-active-instance  保存默认云机；生图只发送到默认云机
```

### 8.3 ComfyUI 调用流程

```
（默认云机已设置、状态为 running、ComfyUI URL 已拿到）

1. 刷新默认云机状态；不是 running 时提示用户先去设置页开机，不自动开机
2. POST {comfyui_url}/upload/image    上传素材图
3. 加载本地导入的工作流 JSON          本机缓存，按版本本地保存
4. 把图片名/提示词/参数注入到 workflow 的 input 节点
5. POST {comfyui_url}/prompt          提交工作流，拿 prompt_id
6. 轮询 GET {comfyui_url}/history/{prompt_id}
7. 完成 → 从 history.outputs 找产物文件名
8. GET {comfyui_url}/view?filename=xxx  下载产物
9. 落到 `02-印花工作区/{能力目录}/{任务名}/{印花ID}.png`
10. 数据库登记血缘（来源、工作流ID、版本、provider="comfyui-chenyu"）
```

ComfyUI 路径页面只显示默认云机状态卡：未设置 / 开机中 / 运行中 / 关机中 / 已关机、实例 UUID、ComfyUI 地址和刷新按钮。刷新调用 `chenyu:refresh-active-instance`，开机/关机仍去设置页处理。

### 8.4 错误处理优先级

| 错误 | 处理 |
|---|---|
| 401 | API Key 失效 → 提示用户重新填 |
| 429 | 限速 → Retry-After 退避重试 |
| 500 | 服务端故障 → 用户级提示 + 重试按钮 |
| 默认云机未设置/未运行 | 提示用户到设置页选择默认云机并开机；不自动开机 |
| 实例 status=21/22 | 设置页显示关闭中/已关机；生图模块提示先开机 |
| ComfyUI 地址识别失败 | 设置页允许用户手动填写地址作为兜底 |
| ComfyUI 连接超时 | 实例还没起好或网络问题 → 提示刷新/重试 |
| /prompt 提交失败 | 工作流 JSON 有问题或显存不够 → 提示用户 |
| /history 超时（> 5 min/张） | 任务卡死 → 提示用户 |
| 产物下载失败 | 自动重试 3 次 → 仍失败标记该图失败 |

### 8.5 费用显示取舍

- 设置页主界面不展示余额、不做费用估算，避免日常操作界面过重。
- 客户端仍可使用 `/balance/info` 做 API Key 连通性检查。
- 云机费用风险通过"用户显式开机/关机"和晨羽侧定时关机兜底控制。

---

## 9. 已知不确定项（待实施时验证）

- [ ] `create_by_pod` 是否支持 `auto_start: 1` 参数（快速开始示例里有，create-by-pod 详情页没列出）
- [ ] `shutdown_timer.shutdown_time` 究竟是秒级时间戳还是分钟数（文档自相矛盾）
- [ ] `set_idle_close` 何时上线
- [ ] Pod.price 和 GPU.price 是相加还是择一计费
- [ ] ComfyUI 端口在 `server_map` 中的 `title` 究竟叫什么（猜测是 "ComfyUI"，实际可能是别的）
- [ ] 实例启动后 ComfyUI 是否需要再单独启动（看 Pod 镜像是否预启动了 ComfyUI 服务）

实施前**用一个真实账号跑一遍最小流程**（create → list → info → shutdown_timer → ComfyUI 连接 → 简单 prompt → shutdown），把这些不确定项全部清掉。
