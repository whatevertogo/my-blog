---
title: "Claude Code 的 QueryEngine 深度解析"
date: 2026-04-02
category: "I say"
tags: ["agent", "claude code", "架构分析", "源码解读"]
---

# {{ $frontmatter.title }}

如果你用过 Claude Code，可能会好奇：当我输入一条消息后，Claude 是如何理解我的意图、调用工具、执行命令，并在多轮对话中保持上下文的？答案就是 **QueryEngine**。

说是 QueryEngine（查询引擎），其实它更像是 **Agent Loop 的启动器和管理器**。用户通过它来启动 Agent Loop，它与 Claude API 交互、管理工具执行、处理上下文压缩，并维护整个对话的生命周期。

## QueryEngine 在什么时候使用？

**每次用户与 Claude Code 对话时**，都会创建一个 QueryEngine 对象。一个 QueryEngine 实例对应一次完整的对话（conversation），而每次 `submitMessage()` 调用则对应对话中的一轮（turn）。

::: tip 实际例子
`/btw` 命令就是 QueryEngine 的一次最小实现。它使用 `ask()` 便捷函数（`QueryEngine.ts:1186`），这是 QueryEngine 的一次性包装：创建引擎 → `submitMessage()` → 结束后回写文件缓存。适合不需要多轮对话的场景。
:::

### 调用链路

```
用户输入
  → QueryEngine.submitMessage()          [QueryEngine.ts:209]
    → processUserInput()                  [utils/processUserInput/processUserInput.ts]
    → fetchSystemPromptParts()            [utils/queryContext.ts]
    → query()                             [query.ts:219]
      → queryLoop()                       [query.ts:241]
        → appendUserContext()             [utils/api.ts]
        → addCacheBreakpoints()           [services/api/claude.ts:3061]
        → API 调用                        [services/api/claude.ts:1697]
        → 流式响应处理                     [services/api/claude.ts:1760+]
        → 工具执行                         [services/tools/toolOrchestration.ts]
        → autoCompact 检查                 [services/compact/autoCompact.ts]
```

### 两种使用方式

```
外部调用入口
  │
  ├── ask() 函数 [QueryEngine.ts:1186-1295]
  │   ├── new QueryEngine(config)
  │   │   └── 克隆文件状态缓存 (cloneFileStateCache)
  │   ├── engine.submitMessage(prompt, options)
  │   │   └── yield* engine.submitMessage(...)
  │   └── finally: setReadFileCache(engine.getReadFileState())
  │
  └── 直接使用 QueryEngine 类
      ├── new QueryEngine(config)
      └── for await (const msg of engine.submitMessage(prompt))
              └── 处理每个 SDKMessage
```

**`ask()` vs 直接使用 QueryEngine**：
- `ask()` 是便捷函数，适合一次性问答场景
- 直接使用 QueryEngine 适合需要多轮对话、保持状态的场景

## QueryEngine 的设计

### 核心类结构

```typescript
QueryEngine (类)
├── 私有状态
│   ├── config: QueryEngineConfig          # 配置对象（不可变引用）
│   ├── mutableMessages: Message[]         # 可变消息数组（跨轮次持久化）
│   ├── abortController: AbortController   # 中断控制器
│   ├── permissionDenials: SDKPermissionDenial[]  # 权限拒绝记录
│   ├── totalUsage: NonNullableUsage       # 累计 token 使用量
│   ├── discoveredSkillNames: Set<string>  # 技能发现跟踪
│   ├── loadedNestedMemoryPaths: Set<string>  # 已加载的嵌套记忆路径
│   └── readFileState: FileStateCache      # 文件读取状态缓存
│
├── 公共方法
│   ├── submitMessage()     # 提交消息并开始一轮对话（核心入口）
│   ├── interrupt()         # 中断当前请求
│   ├── getMessages()       # 获取消息历史
│   ├── getReadFileState()  # 获取文件读取状态
│   ├── getSessionId()      # 获取会话 ID
│   └── setModel()          # 设置模型
```

### QueryEngineConfig 配置项

`QueryEngineConfig` 是 QueryEngine 的配置对象，包含了运行所需的所有依赖和设置：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `cwd` | string | 当前工作目录 |
| `tools` | Tools | 可用工具集合 |
| `commands` | Command[] | 斜杠命令列表 |
| `mcpClients` | MCPServerConnection[] | MCP 服务器连接 |
| `canUseTool` | CanUseToolFn | 工具权限检查函数 |
| `initialMessages` | Message[] | 初始消息（用于恢复对话） |
| `customSystemPrompt` | string | 自定义系统提示词 |
| `userSpecifiedModel` | string | 用户指定的模型 |
| `maxTurns` | number | 最大轮数限制 |
| `maxBudgetUsd` | number | 最大预算（美元） |

## QueryEngine 的完整工作流程

让我们通过一个实际场景来理解 QueryEngine 是如何工作的：

**场景**：你在 Claude Code 中输入 "帮我重构 src/utils.ts 文件"。

### 阶段 1：初始化

```
submitMessage() 被调用
  │
  ├── 1. 包装 canUseTool 以追踪权限拒绝
  │   └── 记录哪些工具被拒绝，用于 SDK 报告
  │
  ├── 2. 确定模型和配置
  │   ├── 模型：用户指定 or 默认 mainLoop 模型
  │   └── 思考配置：adaptive / disabled
  │
  ├── 3. 构建系统提示词
  │   ├── fetchSystemPromptParts() 获取工具定义、MCP 配置等
  │   ├── 注入 memory mechanics 提示词（如启用）
  │   └── 合并自定义提示词
  │
  └── 4. 加载技能和插件
      ├── getSlashCommandToolSkills() 加载技能
      └── loadAllPluginsCacheOnly() 加载插件（仅缓存）
```

### 阶段 2：用户输入处理

```
processUserInput() 处理用户输入
  │
  ├── 解析斜杠命令（如 /compact, /model 等）
  ├── 处理附件（图片、文档等）
  ├── 更新消息数组
  └── 持久化 transcript（确保进程被杀后可 --resume）
```

**关键设计**：在进入 API 循环之前就写入 transcript，这是为了保证即使进程在 API 响应前被杀死，对话仍然可以恢复。

### 阶段 3：查询循环（核心）

```
for await (const message of query({...}))
  │
  ├── 调用 query() 函数与 Claude API 交互
  │   ├── 构建 API 请求（系统提示词 + 消息历史）
  │   ├── 添加缓存断点（addCacheBreakpoints）
  │   ├── 流式接收响应
  │   └── 处理工具调用
  │
  ├── 根据消息类型分发处理：
  │   ├── assistant → 记录 stop_reason，推入消息，yield 标准化消息
  │   ├── user → turn 计数 +1，推入消息
  │   ├── progress → 进度更新（工具执行中）
  │   ├── attachment → 附件处理（文件内容、结构化输出等）
  │   ├── stream_event → 流式事件（token 使用量更新）
  │   └── system → 系统消息（压缩边界、API 错误重试等）
  │
  ├── 检查终止条件：
  │   ├── 超过最大轮数（maxTurns）→ 返回错误
  │   ├── 超过预算（maxBudgetUsd）→ 返回错误
  │   └── 结构化输出重试超限 → 返回错误
  │
  └── 自动上下文压缩检查
      └── 如果 token 使用量超过阈值，触发 compact
```

### 阶段 4：结果返回

```
查询循环结束
  │
  ├── 提取文本结果
  │   └── 从最后一条 assistant 消息中提取文本内容
  │
  ├── 构建结果对象
  │   ├── duration_ms: 总耗时
  │   ├── duration_api_ms: API 耗时
  │   ├── num_turns: 对话轮数
  │   ├── total_cost_usd: 总成本
  │   ├── usage: token 使用量
  │   └── permission_denials: 权限拒绝记录
  │
  └── yield result 消息
```

## 关键设计决策

### 1. 为什么使用 AsyncGenerator？

`submitMessage()` 是一个异步生成器函数（`async *`），这意味着它可以：

- **流式输出**：不需要等待整个对话完成，可以逐条 yield 消息
- **保持状态**：生成器暂停时，所有局部变量都保持状态
- **支持中断**：通过 `interrupt()` 方法可以中断生成器

**实际场景**：当你在终端看到 Claude 逐字输出响应时，就是 AsyncGenerator 在逐条 yield 消息。

### 2. 为什么 mutableMessages 是跨轮次持久化的？

```typescript
private mutableMessages: Message[]  // 跨轮次持久化
```

**原因**：一个 QueryEngine 实例对应一次完整的对话。每次 `submitMessage()` 只是对话中的一轮，需要保留之前的消息历史才能维持上下文。

**对比**：
- `ask()` 函数：一次性使用，用完即弃
- QueryEngine 类：多轮对话，状态持久化

### 3. Transcript 持久化策略

```typescript
// 在进入 API 循环前就写入 transcript
if (persistSession && messagesFromUserInput.length > 0) {
  const transcriptPromise = recordTranscript(messages)
  if (isBareMode()) {
    void transcriptPromise  // fire-and-forget
  } else {
    await transcriptPromise  // 等待写入完成
  }
}
```

**为什么这样设计？**

如果进程在 API 响应前被杀死（比如用户在 Cowork 模式下点击 Stop），transcript 中只有用户消息，没有 API 响应。这样 `--resume` 功能可以找到对话记录并恢复。

### 4. 权限拒绝追踪

```typescript
// 包装 canUseTool 以追踪权限拒绝
const wrappedCanUseTool: CanUseToolFn = async (...) => {
  const result = await canUseTool(...)
  if (result.behavior !== 'allow') {
    this.permissionDenials.push({
      tool_name: sdkCompatToolName(tool.name),
      tool_use_id: toolUseID,
      tool_input: input,
    })
  }
  return result
}
```

**用途**：记录哪些工具调用被拒绝，最终在 result 消息中返回给 SDK 调用者。

### 5. 压缩边界处理

```typescript
// 压缩边界消息：释放压缩前的消息以供 GC
if (mutableBoundaryIdx > 0) {
  this.mutableMessages.splice(0, mutableBoundaryIdx)
}
```

**为什么需要？** 压缩后，旧的消息已经被摘要替代，不再需要保留。及时释放可以减少内存占用，特别是在长对话中。

## QueryEngine 与 query.ts 的关系

QueryEngine 和 query.ts 是两个不同层次的模块：

| 维度 | QueryEngine | query.ts |
|------|-------------|----------|
| **职责** | 对话生命周期管理 | 单次 API 交互循环 |
| **状态** | 跨轮次持久化 | 单次查询状态 |
| **输入** | 用户消息（字符串） | 消息数组 + 系统提示词 |
| **输出** | SDKMessage 流 | Message 流 |
| **功能** | 权限、transcript、结果构建 | API 调用、工具执行、压缩检查 |

**调用关系**：
```
QueryEngine.submitMessage()
  └── query() [query.ts]
        └── queryLoop()  // 核心 API 交互循环
```

## 总结

QueryEngine 是 Claude Code 的核心组件之一，它：

1. **管理对话生命周期**：一个实例对应一次完整对话
2. **协调多轮交互**：通过 AsyncGenerator 实现流式输出
3. **维护状态持久化**：消息历史、文件缓存、token 使用量
4. **处理边界情况**：中断恢复、权限追踪、上下文压缩

理解 QueryEngine 是理解 Claude Code 架构的关键第一步。
      - progress — inline 持久化防止 resume 时链断裂
      - stream_event — 追踪 token 用量（message_start/delta/stop）
      - attachment — 处理 structured output、max_turns_reached、queued_command
      - system — 处理 compact_boundary（释放 GC）、snip replay、api_error 重试
      - tool_use_summary — 直接 yield 给 SDK

 4. 预算/限制检查（每轮循环末尾）
    - maxBudgetUsd 预算上限检查
    - structured output 重试次数限制检查
    - maxTurns 轮次上限（通过 attachment 信号）

 5. 结果产出
    - 成功 → yield { type: 'result', subtype: 'success', ... }
    - 执行错误 → yield { type: 'result', subtype: 'error_during_execution', ... }（附带诊断信息）
    - 预算超限 / 轮次超限 / 结构化输出重试耗尽 → 各自的 error result
```

## QueryEngine的作用

###  QueryEngine — 会话编排层（Orchestrator）

  负责"围绕" queryloop(agent loop) 的所有外围工作：

  1. 构建系统提示词 — fetchSystemPromptParts(), memory prompt, 自定义 prompt
  2. 处理用户输入 — processUserInput()，支持斜杠命令
  3. 持久化 transcript — 在 API 调用前就写入，保证可 resume
  4. 消息标准化与分发 — 把 query() yield 出来的内部消息转换成 SDKMessage 格式
  5. 用量/预算追踪 — token 累计、maxBudgetUsd 检查、maxTurns 检查
  6. 权限追踪 — 包装 canUseTool 收集拒绝记录
  7. 结果产出 — 最终 yield 一个 { type: 'result', ... } 消息


## 为什么要有QueryEngine

```markdown
  1. 把跨 turn 的状态封装成对象

  在 QueryEngine 出现之前，所有这些状态散落在 print.ts 的闭包变量里（mutableMessages、readFileState、权限记录等），通过 ask() 函数的参数传来传去。

  QueryEngine 把它们收拢成了一个对象的生命周期：

  // 之前：print.ts 维护一堆散变量
  let mutableMessages = []
  let readFileState = ...
  // 每次 ask() 传入，结束时回写
  ask({ mutableMessages, getReadFileCache, setReadFileCache, ... })

  // 之后：QueryEngine 持有状态
  class QueryEngine {
    private mutableMessages: Message[]
    private readFileState: FileStateCache
    private totalUsage: NonNullableUsage
    private permissionDenials: SDKPermissionDenial[]
    // ...
  }

  2. 支持多轮对话（多 turn 复用同一引擎）

  这是核心动机。看注释（L176-183）：

  ▎ One QueryEngine per conversation. Each submitMessage() call starts a new turn within the same conversation. State (messages, file cache, usage, etc.)      
  persists across turns.

  - SDK/Agent SDK 场景：外部代码创建一个 QueryEngine，多次调用 submitMessage()，消息和用量跨 turn 累积
  - ask() 是一次性的：每次都 new QueryEngine() → submitMessage() → 丢弃，适合 REPL 里 "一发一收" 的简单场景

  3. 提供中断和自省能力

  interrupt()        // 外部中止当前查询
  getMessages()      // 拿到当前对话全部消息
  getReadFileState() // 拿到文件缓存
  setModel(model)    // 动态切换模型

  ask() 是个 generator，一旦结束就什么都没了。QueryEngine 作为对象，调用方可以在 turn 之间随时做这些操作。

  为什么要写它？——三个驱动因素

  ① Agent SDK 的需求

  SDK 调用方（比如 Claude Desktop、第三方集成）需要：
  - 一个对话持续多轮，不丢状态
  - 随时 interrupt() 停掉当前生成
  - 在 turn 之间切换模型、查询内部状态

  这些用无状态的 ask() 函数做不到，必须提升为有状态对象。

  ② 从 print.ts 解耦

  print.ts 是 REPL 的入口，有 ~2200 行。把会话管理逻辑抽到 QueryEngine 后：
  - print.ts 只负责 UI 交互、命令队列、stdin/stdout
  - QueryEngine 只负责查询生命周期
  - 职责清晰，各自可测试

  ③ 为未来 REPL 重构做准备

  注释说 "(in a future phase) the REPL"。目前 REPL（print.ts）还是通过 ask() 间接使用，但架构上已经预留了 REPL 直接用 QueryEngine 的路径——届时 REPL 也会变成   
  "一个对话一个引擎" 的模式。

  总结

  ┌───────────────────────────────────┬───────────────────────────────┐
  │           │       ask() 函数       │        QueryEngine 类         │
  ├───────────────────────────────────┼───────────────────────────────┤
  │ 生命周    │ 单次，用完即弃         │ 跨 turn 持久                  │
  ├───────────────────────────────────┼───────────────────────────────┤
  │ 使用方    │ REPL (print.ts)        │ SDK / Agent SDK               │
  ├───────────────────────────────────┼───────────────────────────────┤
  │ 状态管理  │ 靠外部闭包变量         │ 自持                          │
  ├───────────────────────────────────┼───────────────────────────────┤
  │ 中断/自省 │ 不支持                 │ interrupt(), getMessages() 等 │
  ├───────────────────────────────────┼───────────────────────────────┤
  │ 本质      │ QueryEngine 的便捷包装 │ 核心抽象                      │
  └───────────────────────────────────┴───────────────────────────────┘

  一句话：QueryEngine 是把 ask() 从"一次性的过程"升级为"有状态的对象"，让 SDK 调用方可以在同一个对话中多轮交互、随时控制。
```

## queryloop()做了什么？

```markdown

queryLoop() 详解

    queryLoop() 位于 query.ts:241，是 Claude Code 的核心 agent loop——
    一个 while(true) 循环（L307-L1728，约 1400 行）。

    循环结构

    每轮迭代的流程：

    while (true) {
      1. 准备消息（compact boundary 截取、content replacement、snip）
      2. 调用 Claude API（流式）
      3. 解析响应中的 tool_use
      4. 执行工具
      5. if (有工具调用且需要继续) → continue
      6. if (没有工具调用 / stop_reason=end_turn) → break
    }

    关键机制

    消息准备阶段（L365-520）：
    - getMessagesAfterCompactBoundary() — 只取 compact boundary 之后的消息
    - applyToolResultBudget() — 裁剪过大的工具输出
    - snip projection / microcompact — 上下文压缩策略
    - projectView() — 将内部消息投影成发给 API 的格式

    API 调用与流式处理：
    - 发送消息给 Claude，流式接收响应
    - 每收到一个 content_block（text / tool_use）就 yield 出去
    - 跟踪 stop_reason：end_turn 表示完成，tool_use 表示需要执行工具

    工具执行：
    - 解析 tool_use block，匹配注册的工具
    - 通过 canUseTool 检查权限
    - 执行工具，收集结果
    - 将 tool_result 追加到消息列表，continue 进入下一轮

    7 个 continue 站点：
    这些是触发"再来一轮"的条件——每执行完一个工具就 continue，让模型看到工具结果后决定下一步。典型场景：
    - L950: tool_use 执行完毕，继续
    - L1115: 子 agent (AgentTool) 执行完毕，继续
    - L1165: reactive compact 后继续
    - L1220/1251: budget/token 相关恢复后继续
    - L1305: 错误重试后继续
    - L1340: 决策为 continue

    退出条件（break）：
    - stop_reason === 'end_turn' 且无工具调用 → 正常结束
    - maxTurns 达到上限 → yield attachment 信号
    - token budget 耗尽 → break
    - 不可恢复的 API 错误 → throw

    状态管理：
    用 let state: State 对象管理跨迭代的可变状态（消息、turn 计数、compact 追踪等），每个 continue 站点用 state = { ...state, changedField } 更新。

    总结

    queryLoop() 就是一个经典的 ReAct loop（Reason + Act 循环）：模型思考 → 调用工具 → 观察结果 → 再思考，直到模型认为任务完成。QueryEngine
    包在外面负责"装修"（提示词、持久化、格式化），queryLoop() 是真正的引擎。

```

## 我是这么想的

Anthropic发现他们代码跟不上需求了，开始只是根据agentloop写了一个agent，后来发现需求越来越多越来越多

```markdown
我觉得我写的更好的设计？

  RuntimeService（门面）
    ├── SessionState × N（会话运行态）
    │     ├── AgentStateProjector（事件投影）
    │     ├── SessionWriter（JSONL 持久化）
    │     └── Broadcaster（SSE 扇出）
    ├── AgentLoop（单 turn 编排）
    │     ├── turn_runner（步循环）
    │     ├── llm_cycle（LLM 调用）
    │     └── tool_cycle（工具执行）
    ├── CapabilityRouter（工具分发）
    └── PolicyEngine（策略引擎）

每一层只依赖下面一层，不跨层。对比 Claude Code 的 queryLoop() 把所有这些塞在一个 1400 行函数里。
 1. Event Sourcing + CQRS 投影 vs 可变数组

  Claude Code 的做法：

  // 就地修改 messages 数组
  mutableMessages.push(userMessage)
  mutableMessages.push(assistantMessage)
  // 崩溃后靠 transcript 文件恢复，但 transcript 只是"最后一次写磁盘的快照"

  你的做法：

  StorageEvent（不可变事实）→ AgentStateProjector.fold() → AgentState（派生视图）

  好在哪里：

  - 可重放：ensure_session_loaded() 从磁盘回放全部事件，投影重建完整状态。Claude Code 靠 transcript 文件，只能恢复到"最后一次 API
  调用前"的快照
  - 可审计：每个 StorageEvent 带自增 storage_seq，事件流是完整的操作日志
  - 可回溯：SSE 断线后用 {storage_seq} 作游标，从断点续播，不丢事件。Claude Code 的 SSE 事件 id 是 {storage_seq}.{subindex}
  但它的状态不是从事件流派生的，是就地修改后的内存快照

  2. 模块化步循环 vs 1400 行巨型循环

  Claude Code 的 queryLoop() 是一个 while(true) 里塞了：
  - 消息准备（compact、snip、projection）
  - API 调用
  - 流式解析
  - 工具匹配
  - 权限检查
  - 错误重试
  - 预算检查
  - 7 个 continue 站点

  你的 turn_runner 里 while 循环只做三件事：

  loop {
      // 1. 组装 prompt，调 LLM
      let output = llm_cycle::generate_response(...).await?;
      // 2. 没 tool_calls → 结束
      if output.tool_calls.is_empty() { break; }
      // 3. 有 tool_calls → 执行工具，追加结果，continue
      let tool_msgs = tool_cycle::execute_tool_calls(...).await?;
      messages.extend(tool_msgs);
  }

  好在哪里：

  - LLM 调用的细节（流式接收、delta 拼装、事件广播）封装在 llm_cycle.rs
  - 工具执行（策略检查、调用、结果收集）封装在 tool_cycle.rs
  - 步循环本身只做"调度"，不涉及任何具体逻辑
  - 每个模块可以独立测试，Claude Code 的 queryLoop 极难单测

  3. 独立 PolicyEngine vs 内联权限检查

  Claude Code 的权限检查是 canUseTool() 散落在循环体内，和工具执行逻辑耦合在一起。

  你的设计是三层解耦：

  PolicyEngine（策略判断）→ ApprovalBroker（用户交互）→ CapabilityInvoker（执行）

  tool_cycle 里的流程：

  match policy.check_capability_call(&descriptor, &input).await? {
      PolicyVerdict::Allow  => 执行,
      PolicyVerdict::Deny   => 返回错误给 LLM,
      PolicyVerdict::Ask    => ApprovalBroker::request() → 用户决定,
  }

  好在哪里：

  - 可插拔：换策略不需要改 agent loop。可以做成"全允许"、"全拒绝"、"写操作需审批"等不同策略实现
  - 可测试：mock PolicyEngine 就能测工具执行的正常/拒绝/询问三条路径
  - 职责单一：策略判断不知道工具怎么执行，工具执行不知道策略为什么允许/拒绝

  4. CapabilityRouter + CapabilityInvoker vs 直接匹配

  Claude Code 用 tool name 直接匹配注册的工具函数。你的设计多了一层抽象：

  Tool trait（核心契约，在 core crate）
    → ToolCapabilityInvoker（适配器）
      → CapabilityInvoker（统一调用接口）
        → CapabilityRouter（路由表）

  好在哪里：

  - Tool ⊂ Capability：未来加新的能力类型（MCP、子 agent、工作流）不需要改路由器，只需实现新的 CapabilityInvoker
  - 热插拔：RuntimeGovernance 可以运行时重新加载能力注册表，不重启服务。Claude Code 的工具注册是启动时冻结的
  - 编译隔离：tools crate 只依赖 core，不依赖 runtime。Claude Code 的工具定义和 loop 在同一个包里

  5. 并发安全 vs 单线程假设

  Claude Code 是 Node.js 单进程，不存在并发问题。你的设计要面对：

  // 防止同一 session 并发提交 turn
  let was_idle = session.running.swap(true, Ordering::SeqCst);
  if !was_idle { return Err(TurnConflict); }

  // 会话存储：无锁并发读，独占写
  sessions: DashMap<String, Arc<SessionState>>

  // 中断：原子布尔，每个 step 边界检查
  CancelToken { cancelled: AtomicBool }

  好在哪里：

  - 这不是"比它好"的问题，而是你的架构天然支持多用户场景（多个 SSE 客户端连同一个服务，不同 session 并行跑 turn）
  - Claude Code 的 QueryEngine 设计上就没考虑并发——同一个引擎同时 submitMessage() 会怎样？文档没说

  6. Phase 状态机 vs 隐式阶段

  你的 EventTranslator 在翻译事件时维护显式的 Phase 状态机：

  Idle → Thinking → Streaming → CallingTool → Streaming → ... → Idle

  每个 AgentEvent 都附带 phase 信息，SSE 客户端据此更新 UI。

  Claude Code 没有显式 phase——前端靠推断"收到 text delta 就是在 streaming，收到 tool_use 就是在调工具"。

  好在哪里：

  - 前端不需要猜测当前状态，服务端明确告诉它
  - Phase 可以驱动 UI 状态（禁用/启用输入框、显示 spinner、切换面板）
  - 状态转换是可审计的——每个 PhaseChanged 事件都记入 JSONL

  Claude Code 的 QueryEngine 是"从实践中长出来的"——先有 ask()，发现不够用，包装成 QueryEngine，过程中保留了大量的耦合和隐式约定。queryLoop()  
  1400 行就是所有妥协的堆叠。

  "先想清楚再写"
  ——Event Sourcing 管持久化，Projector 管状态推导，PolicyEngine 管策略，CapabilityRouter 管分发，turn_runner
  只管循环。每层只做一件事，层与层之间靠 trait 和 DTO 通信。

```

