---
title: "Claude code 的 QueryEngine"
date: 2026-04-02T 0:500:17Z
category: "claude code"
tags: ["agent"]
---

# {{ $frontmatter.title }}

说是QueryEngine(搜索引擎),其实我更想叫他agent loop启动器
用户通过它来启动agentloop

## QueryEngine在什么时候使用？

在用户每一次对话之后启用，这意味着启动一次会话就是启动一个QueryEngine对象，QueryEngine对象会在每次对话的时候启动一个agentloop

::: tip
注：/btw就是QueryEngine的一次最小实现
  ask() 便捷函数（L1186）

  是 QueryEngine 的一次性包装：创建引擎 → submitMessage() → 结束后回写文件缓存。适合不需要多轮对话的场景。
:::
```markdown
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


也可以说:
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

## QueryEngine的设计

```markdown
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
## QueryEngine的流程

```markdown
初始化阶段
    - 包装 canUseTool 以追踪权限拒绝
    - 确定模型（用户指定 / 默认 mainLoop 模型）
    - 确定思考配置（adaptive / disabled）
    - 通过 fetchSystemPromptParts() 构建系统提示词
    - 注入 memory mechanics 提示词（如有自定义 system prompt + 环境变量覆盖）

 1. 用户输入处理
    - 通过 processUserInput() 处理用户输入（支持斜杠命令）
    - 新消息推入 mutableMessages
    - 持久化 transcript — 在进入 API 循环前就写入，保证进程被杀后可 --resume

 2. 用户输入处理
    - 通过 processUserInput() 处理用户输入（支持斜杠命令）
    - 新消息推入 mutableMessages
    - 持久化 transcript — 在进入 API 循环前就写入，保证进程被杀后可 --resume

 3. 查询循环 (for await (const message of query({...})))
    - 调用核心 query() 函数与 Claude API 交互
    - 根据消息类型分发处理：
      - assistant — 记录 stop_reason，推入消息，yield 标准化消息
      - user — turn 计数 +1，推入消息
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

