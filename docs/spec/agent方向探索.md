# Agent 方向探索

> 非正式规格：这是一次技术方向讨论记录，不是已拍板的产品 / 架构 spec。实现前必须回到 `docs/CONTEXT.md`、PRD、正式 spec 和 ADR 校验。

更新时间：2026-05-29

## 参考入口

- Pi GitHub 仓库：https://github.com/earendil-works/pi
- `pi-agent-core` 代码入口：https://github.com/earendil-works/pi/tree/main/packages/agent
- `pi-coding-agent` 代码入口：https://github.com/earendil-works/pi/tree/main/packages/coding-agent
- `pi-coding-agent` session 相关入口：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts

## 本次讨论结论

这次主要澄清的是：`pi-agent-core` 是否自带“本地历史会话管理系统”。

当前理解是：`pi-agent-core` 更像一个 Agent 运行时核心，它负责单个 Agent 的消息状态、工具调用循环、模型交互和运行过程中的上下文维护。它并不等同于一个完整产品里的“会话列表 + 本地保存 + 恢复 + 命名 + 历史管理”系统。

也就是说，`pi-agent-core` 有运行时上下文，但默认不代表它会自动把每个会话持久化到本地文件、SQLite 或其他数据库里。

## Session 的三种含义

为了避免后面继续混淆，先把 session 拆成三层。

### 1. Agent 实例内存

一个活着的 Agent 实例通常会持有自己的消息历史和运行状态，例如：

```ts
const agentA = new Agent(...)
const agentB = new Agent(...)
```

在程序运行期间：

```text
agentA 记住会话 A 的上下文
agentB 记住会话 B 的上下文
```

只要这两个对象还在内存里，它们就可以分别保持独立上下文。

### 2. 应用层 Session 映射

如果腾域 Workbench 做多会话窗口，应用层需要维护类似这样的结构：

```ts
const sessions = new Map<string, Agent>()

sessions.set("session_a", agentA)
sessions.set("session_b", agentB)
```

这样在单次程序运行期间可以做到：

```text
窗口 A -> session_a -> agentA -> messages A
窗口 B -> session_b -> agentB -> messages B
窗口 C -> session_c -> agentC -> messages C
```

这就是“开几个 session，它们能分别独立记住各自上下文”的来源。

但这里的前提是：程序没有销毁对应 Agent 实例，也没有从 `sessions` 里删除它。

### 3. 本地持久化 Session

完整产品里用户期待的 session 通常还包括：

```text
历史会话列表
会话标题
创建时间 / 更新时间
消息持久化
工具调用记录
重启后恢复
会话归档 / 删除
```

这一层如果只用 `pi-agent-core`，大概率需要我们自己实现。

## 当前判断

我们的判断可以压缩成一句话：

```text
pi-agent-core 有单个 Agent 的运行时上下文状态；
但完整的本地历史会话管理，需要产品层自己做，或研究 pi-coding-agent 是否已经提供可复用实现。
```

程序运行期间，如果我们创建多个 Agent 实例，并用 `sessionId` 做映射，那么这些会话可以互相独立保存上下文。

程序重启后，如果没有把 `messages`、工具结果、会话元数据写入本地存储，那么这些上下文会随着内存清空而消失。

窗口关闭也类似：如果只是隐藏窗口，Agent 实例仍然留在内存里，上下文还在；如果关闭窗口时把对应 session 从 Map 删除，且没有持久化，那么上下文也会消失。

## 对腾域 Workbench 的启发

如果后续要在腾域 Workbench 里探索 Agent 方向，可以按下面这条产品层架构理解：

```text
运行时：
sessionId -> Agent 实例 -> 内存 messages

持久化：
sessionId -> SQLite / JSONL / 本地文件 -> messages + metadata

恢复时：
读取本地 messages -> 创建 Agent -> 注入初始上下文 -> 继续对话
```

一个更产品化的结构可能是：

```ts
type AgentSessionRecord = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  model: string
  systemPrompt: string
  messages: AgentMessage[]
}
```

运行时再配一个管理器：

```ts
class AgentSessionManager {
  private agents = new Map<string, Agent>()

  async openSession(sessionId: string) {
    const saved = await sessionStore.load(sessionId)
    const agent = new Agent({
      // model / tools / systemPrompt / messages 等由实际 API 确认
    })
    this.agents.set(sessionId, agent)
    return agent
  }
}
```

注意：上面只是结构草图，具体字段和 API 需要明天读 `pi-agent-core` / `pi-coding-agent` 源码后确认。

## pi-agent-core 与 pi-coding-agent 的分工假设

从目前看到的资料推测，Pi 可能是分层设计：

```text
pi-ai            -> 多 provider LLM 调用层
pi-agent-core    -> Agent loop、工具调用、运行时 state
pi-coding-agent  -> 更完整的编码 Agent、内置工具、session 系统、扩展机制
pi-tui           -> 终端 UI
```

因此明天要重点判断：

1. 如果我们要做“腾域自己的 AI 工作台”，是不是直接基于 `pi-agent-core` 更灵活。
2. 如果我们想复用现成 session、工具、权限、事件系统，`pi-coding-agent` 是否能拆出来接入 Electron。
3. `pi-coding-agent` 的 session persistence 是否强绑定 CLI/TUI，还是可以独立复用。
4. `pi-agent-core` 的 state/messages 是否支持初始化注入、序列化和恢复。

## 明天继续探索的问题清单

1. 阅读 `packages/agent`，确认 `Agent` 的 state 结构、messages 类型、初始化方式。
2. 阅读 `packages/coding-agent/src/core/agent-session.ts`，确认它的 session 管理做了哪些事。
3. 找到 Pi 的持久化实现：是 SQLite、JSON 文件，还是项目自定义 store。
4. 判断 `pi-coding-agent` 的 session 层是否可以不带 TUI 单独用于 Electron 主进程。
5. 对比我们自己实现 `SessionStore` 与复用 Pi 上层 session 的成本。
6. 明确腾域 Workbench 需要的是“业务 Agent”还是“编码 Agent”，避免直接搬一个过重的 coding-agent 架构。

## 暂定方向

短期更稳的探索路线是：

1. 先读 `pi-agent-core`，确认最小 Agent 运行时能力。
2. 再读 `pi-coding-agent`，只借鉴它的 session、权限、工具事件和上下文压缩设计。
3. 腾域 Workbench 内部先设计自己的 `AgentSessionStore`，因为我们的 session 要和业务任务、货号、模块、Artifact、Workflow Step 绑定。
4. 如果 Pi 的上层 session 能独立复用，再评估是否接入；如果强绑定 coding-agent，就只借鉴设计。

当前最重要的边界是：

```text
Agent runtime memory 不等于 product session persistence。
```

这条边界明天继续探索时要一直保留。
