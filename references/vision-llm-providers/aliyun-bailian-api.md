# 阿里云百炼 API 参考（腾域 aipod 集成版）

> 抓取自 https://help.aliyun.com/zh/model-studio/ 于 2026-05-23。
> 阿里云百炼是腾域的**视觉/LLM 横切 provider**，同时服务于：
> - **生图提示词模块**：文本用 qwen3.5/qwen3.6 系列，图生图/提取用视觉模型看参考图后返回 `{ "prompts": [...] }`
> - **侵权检测模块**：用 qwen3-vl-* / qwen-vl-* / qwen3.5-plus 等视觉模型判断印花风险
> - **标题生成模块**：可用视觉模型一步看图写标题，也可用两阶段（视觉描述 + 文本模型）

## 官方文档入口

| 用途 | 链接 |
|---|---|
| 百炼控制台（拿 API Key） | https://bailian.console.aliyun.com/ |
| API Key 创建页 | https://bailian.console.aliyun.com/?tab=app#/api-key |
| 模型大全 + 计费 | https://help.aliyun.com/zh/model-studio/models |
| 模型调用计费详情 | https://help.aliyun.com/zh/model-studio/model-pricing |
| 视觉理解 | https://help.aliyun.com/zh/model-studio/vision |
| OpenAI 兼容调用 VL | https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai |
| DashScope 原生 API | https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope |
| 首次调用指南 | https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen |

---

## 1. 基础信息

百炼提供 **4 套接口模式**，腾域**首选 OpenAI 兼容**（接入成本最低）。

| 模式 | base_url（中国内地） | 适用 |
|---|---|---|
| **OpenAI 兼容 Chat Completions** ⭐ | `https://dashscope.aliyuncs.com/compatible-mode/v1` | LLM + 视觉，统一接口 |
| OpenAI 兼容 Responses | 同上 | 新的 OpenAI Responses API 风格 |
| Anthropic 兼容 Messages | 同上 | Claude 风格调用 |
| DashScope 原生 | `https://dashscope.aliyuncs.com/api/v1` | 功能最完整，腾域备用 |

### 多地域 base_url

| 地域 | OpenAI 兼容 base_url | DashScope 原生 base_url |
|---|---|---|
| 北京（中国内地） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `https://dashscope.aliyuncs.com/api/v1` |
| 新加坡（国际） | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `https://dashscope-intl.aliyuncs.com/api/v1` |
| 弗吉尼亚（全球） | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` | `https://dashscope-us.aliyuncs.com/api/v1` |

### 认证

```
Authorization: Bearer sk-xxx
```

API Key 前缀：`sk-`，长度约 32 字符。**各地域 Key 不通用**，要分别创建。

### 统一响应（OpenAI 兼容）

完全跟 OpenAI 一致：
```json
{
  "choices": [
    {
      "message": { "role": "assistant", "content": "..." },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 123,
    "completion_tokens": 456,
    "total_tokens": 579
  }
}
```

---

## 2. 视觉理解模型（侵权检测 + 标题生成"看图"环节）

### 2.1 模型清单（截至 2026-05）

| 模型 | 定位 | 中国内地价格（元/百万Token） |
|---|---|---|
| **qwen3-vl-plus** ⭐ | 最新视觉旗舰 | 输入 1 / 输出 10（0-32K档） |
| **qwen3-vl-flash** ⭐ | 便宜快速 | 输入 0.15 / 输出 1.5 |
| **qwen-vl-max** | 上代旗舰，仍可用 | 输入 1.6 / 输出 4 |
| **qwen-vl-plus** | 上代均衡 | 输入 0.8 / 输出 2 |
| **qwen3.6-plus**（含视觉） | 全模态 | 输入 2 / 输出 12 |
| **qwen3.5-plus**（含视觉） | 通用视觉/文本 | 以百炼控制台当前价格为准 |
| **qwen3.5-flash**（含视觉） | 快速低价 | 以百炼控制台当前价格为准 |

**腾域推荐**：
- 侵权检测：**qwen3-vl-flash**（便宜，判侵权不需要旗舰能力）
- 标题生成：**qwen3-vl-plus**（标题质量直接影响转化率，值得花贵的）
- 生图参考图提示词：**qwen3.5-plus** 或 **qwen3.6-plus**
- 最终选哪个 model 在客户端本地设置页选择，云端 Skill 不保存模型 ID

### 2.2 调用示例（OpenAI 兼容，图片用 URL）

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-xxx",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

completion = client.chat.completions.create(
    model="qwen3-vl-plus",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": "https://example.com/print.png"}},
                {"type": "text", "text": "这张印花是否侵犯知名品牌商标？输出 JSON: {risk: 0-100, reason: 文字说明}"}
            ]
        }
    ]
)
print(completion.choices[0].message.content)
```

### 2.3 图片传入方式

| 方式 | 用法 | 适用 |
|---|---|---|
| 公网 URL | `image_url: { url: "https://..." }` | 图已在云端 |
| 本地 base64 | `image_url: { url: "data:image/png;base64,..." }` | 腾域常用 |
| DashScope 文件 ID | DashScope 原生模式才支持 | 大文件复用 |

腾域客户端使用 base64 模式（图在本地，不上传到公网）。

### 2.4 图像限制

- 单图最大 10MB（实测，可能调整）
- 单次请求最多 N 张图（要查具体模型，一般是 80~100 张）
- 支持格式：PNG / JPEG / JPG / WebP / BMP

---

## 3. LLM 模型（标题生成的"写标题"环节）

如果标题生成的流程是"先 VL 看图描述，再 LLM 写标题"（两阶段），那纯 LLM 阶段用以下：

| 模型 | 定位 | 中国内地价格（元/百万Token） |
|---|---|---|
| **qwen-max** | 通用旗舰 | 输入 2.4 / 输出 9.6（无阶梯） |
| **qwen3-max** | 新一代旗舰 | 输入 2.5 / 输出 10（0-32K档） |
| **qwen3.6-plus** | 性价比款 | 输入 2 / 输出 12（0-32K档） |
| **qwen3.6-max-preview** | 顶级 | 输入 9 / 输出 54（贵） |
| **qwen3.5-plus** | 通用高质量 | 以百炼控制台当前价格为准 |
| **qwen3.5-flash** | 快速低价 | 以百炼控制台当前价格为准 |

**腾域推荐**：标题/提示词优先用 **qwen3.5-plus** 或 **qwen3.6-plus**；追求成本时用 flash，效果不够再升旗舰模型。

**也可以"一步到位"**：直接用 qwen3-vl-plus 看图+写标题一气呵成，省一次 API 调用。这是更简洁的方案。

### 3.1 LLM 调用（OpenAI 兼容）

```python
completion = client.chat.completions.create(
    model="qwen3.6-plus",
    messages=[
        {"role": "system", "content": "你是跨境电商运营专家..."},
        {"role": "user", "content": "为这件商品写标题：（描述）"}
    ]
)
```

---

## 4. 腾域集成要点

### 4.1 在哪些模块使用
- `pod-workbench/src/modules/detection/` — 侵权检测
- `pod-workbench/src/modules/title-generation/` — 标题生成

⚠️ **同一份 API Key 服务两个模块**，但**两个模块用不同的 skill（prompt 模板）+ 可能不同的 model**。skill 配置由云端派发，模型由客户端本地设置页选择，模块只关心"我要做这件事，调哪个 skill"。

### 4.2 API Key 存储

- Electron `safeStorage` 加密 → OS keychain
- 用户在"设置 → 视觉/LLM 服务商"里填一次
- 全局共享给检测和标题两个模块用

### 4.3 调用流程（伪代码 - 侵权检测）

```
1. 检测模块拿到一批待检测的印花（从 02-生图/{provider}/04-抠图/）
2. 拉云端最新"侵权检测 skill"：
   - prompt 模板（含 {image} 占位符和判定指引）
   - 推荐模型（如 qwen3-vl-flash）
   - 输出格式约束（JSON Schema）
3. 对每张图：
   a. base64 编码
   b. 拼接 messages（system + user with image + prompt）
   c. POST /v1/chat/completions
   d. 解析返回 JSON → { risk: 0-100, reason: "..." }
4. 按阈值归类 → 物理复制图到 03-检测/pass、03-检测/review、03-检测/block
5. 数据库登记每张图的判决、风险值、模型版本、skill 版本
```

### 4.4 调用流程（标题生成）

```
1. 标题模块扫描 05-货号成品/{SKU}/，每个货号取第一张图
2. 拉云端最新"标题生成 skill"
3. 调 qwen3-vl-plus（看图+写标题一步走）或两阶段（VL 描述 → LLM 写标题）
4. 输出 → 写入 05-货号成品/titles.xlsx 的"标题"列
```

### 4.5 错误处理

| 错误情况 | 我们的处理 |
|---|---|
| 401 | API Key 失效 → 提示重填 |
| 429 | 限速 → 退避重试（OpenAI 客户端自带重试） |
| 内容违规（特定 error code） | 跳过该图 + UI 提示 |
| 模型返回非预期 JSON | 重试 1 次；仍失败标记为"待人工"，不污染数据 |
| 网络超时（> 30 秒） | 重试 2 次 |

### 4.6 计费

- 余额查询：百炼**没有像晨羽那样的 `/balance/info` API**（百炼是阿里云账户余额体系），腾域**不在客户端做余额展示**，让用户去阿里云控制台看。
- 单次调用费用估算：客户端按 `usage.prompt_tokens` + `usage.completion_tokens` × 模型单价做本地估算（精度有限，仅展示用）。

---

## 5. 踩坑记录（实施过程中追加）

- 暂无

---

## 6. 已知不确定项（待实施验证）

- [ ] qwen3-vl-flash 在"判断商标侵权"任务上的准确率是否够用
- [ ] qwen3-vl-plus vs 两阶段（VL+LLM）在"看图写标题"上的质量差
- [ ] base64 图片的实际大小限制
- [ ] 单次请求传多张图的最大数量
- [ ] 推荐的"返回 JSON 格式约束"提示词写法（确保模型输出严格 JSON 不挂逻辑）
- [ ] 错误码列表（哪些是临时错误可重试，哪些是永久错误要放弃）
- [ ] Batch 调用半价的实际使用方式（看到很多模型标"Batch 半价"，可能值得做批量优化）
- [ ] 上下文缓存折扣的使用条件（一些模型标"上下文缓存享有折扣"）

实施前用免费额度（百炼新用户送各 100 万 Token）跑通最小例子。
