---
title: "Agent Loop is All You Need: Claude Code 的 queryLoop 源码解析"
date: 2026-04-05
category: "i say and i do"
tags:
  - AI 编程工具
  - Claude Code
  - 源码解读
description: "从源码角度解析 Claude Code 为什么出色——答案藏在 Agent Loop 的实现细节里"
---

## 引言

大家都在想 Claude Code 为什么如此出色，为什么能在智能体领域表现优异。其实，答案很简单：**Agent Loop 就是你需要的所有内容了**。

但"简单"不等于"简陋"。Agent Loop 这个概念人人都懂——观察、思考、行动、反馈的循环——可为什么偏偏 Claude Code 做得最好？答案藏在 `queryLoop()` 的源码里。


## 什么是 Agent Loop？

Agent Loop 是一种基于循环的智能体架构，它允许智能体在不断地与环境交互中选择不同决策和使用工具。业界常见的 Agent Loop 包括以下几个步骤：

```markdown
1. agent 得到输入
2. agent 分析输入并思考选择工具
3. agent 执行动作
4. agent 获取反馈并更新策略
5. 重复以上步骤，直到任务完成
```

借用智谱和 Anthropic 的图片，我们可以更直观地理解 Agent Loop 的流程：

![agentloop1](/images/agentloop.png)
![agentloop2](/images/agentloop2.png)
![agentloop3](/images/agentloop3.png)

概念上，每个 AI 编程工具都在做这件事。**但执行的深度决定了结果的差异。**

## 为什么 Claude Code 出色？

答案藏在 `queryLoop()` 的源码里。这个位于 `query.ts:241` 的函数，是一个约 1400 行的 `while(true)` 循环，是 Claude Code 的真正引擎。外层 `QueryEngine` 负责会话管理，内层 `queryLoop()` 负责核心循环。

同一个 Agent Loop 五步，Claude Code 每一步都比别人做得深。我们逐步来看。

### 步骤 1：agent 得到输入——输入远不止用户消息

普通的 Agent Loop 里，"得到输入"就是拿到用户的文字消息。但在 Claude Code 的 `queryLoop()` 中，模型拿到的"输入"是一整套精心组装的上下文包：

**消息准备管线**：每轮迭代开头，`queryLoop()` 不是直接把历史消息丢给模型，而是经过四级处理：

```typescript
// query.ts — 每轮迭代开头的消息准备
let messagesForQuery = [...getMessagesAfterCompactBoundary(messages)]

// 1. Tool Result Budget — 裁剪过大的工具输出，防止撑爆上下文
messagesForQuery = await applyToolResultBudget(messagesForQuery, ...)

// 2. History Snip — 剪除过长的历史细节
const snipResult = snipModule!.snipCompactIfNeeded(messagesForQuery)

// 3. Microcompact — 缓存编辑级别的微压缩
const microcompactResult = await deps.microcompact(messagesForQuery, ...)

// 4. Autocompact — 摘要级上下文压缩（当 token 接近上限时触发）
const { compactionResult } = await deps.autocompact(messagesForQuery, ...)
```

**附件系统（Attachments）**：模型的输入不只是消息历史，还有从各种来源收集的附件：

```typescript
// query.ts — 工具执行后，收集所有附件注入到下一轮输入中

// 文件变更附件（其他进程编辑的文件会被检测到）
for await (const attachment of getAttachmentMessages(...)) {
  toolResults.push(attachment)
}

// Memory 预取（异步加载的记忆文件，与模型流式输出并行）
if (pendingMemoryPrefetch?.settledAt !== null) {
  const memoryAttachments = await pendingMemoryPrefetch.promise
  for (const memAttachment of memoryAttachments) {
    toolResults.push(createAttachmentMessage(memAttachment))
  }
}

// Skill 发现预取（发现可用的技能，97% 在模型输出期间就完成了）
if (skillPrefetch && pendingSkillPrefetch) {
  const skillAttachments = await skillPrefetch.collectSkillDiscoveryPrefetch(...)
  toolResults.push(...skillAttachments)
}

// 队列中的命令（后台任务完成通知、用户排队消息）
const queuedCommandsSnapshot = getCommandsByMaxPriority(sleepRan ? 'later' : 'next')
  .filter(cmd => isMainThread ? cmd.agentId === undefined : ...)
```

**系统提示词的动态构建**：

```typescript
// 每轮都重新拼接完整的系统提示词
const fullSystemPrompt = asSystemPrompt(
  appendSystemContext(systemPrompt, systemContext)
)
```

**这意味着什么？** 模型每一轮看到的不是"上次对话 + 用户新消息"这么简单，而是一个经过压缩、裁剪、附件注入、技能发现的**完整工作上下文**。其他工具给模型看的是流水账，Claude Code 给模型看的是精编杂志。

### 步骤 2：agent 分析输入并思考选择工具——思考过程的保护

这一步的核心是调用 Claude API。大多数工具就是"发消息，等回复"。Claude Code 在这一步做了两件关键的事：

**流式接收 + 流式工具执行**：模型在流式输出 `tool_use` 块时，Claude Code 不等模型输出完毕，就开始执行工具了：

```typescript
// query.ts — 边流式接收，边执行工具
for await (const message of deps.callModel({...})) {
  if (message.type === 'assistant') {
    const msgToolUseBlocks = message.message.content.filter(c => c.type === 'tool_use')
    // 模型刚输出一个 tool_use 块，立即加入执行队列
    for (const toolBlock of msgToolUseBlocks) {
      streamingToolExecutor.addTool(toolBlock, message)
    }
    // 同时获取已完成工具的结果
    for (const result of streamingToolExecutor.getCompletedResults()) {
      yield result.message
    }
  }
}
```

**模型过载降级**：当主模型过载返回错误时，`queryLoop()` 会自动切换到 `fallbackModel` 继续工作：

```typescript
// query.ts — 模型降级
const callModel = async (params) => {
  try {
    return await deps.callModel({ ...params, model: currentModel })
  } catch (error) {
    if (isOverloaded(error) && fallbackModel) {
      return await deps.callModel({ ...params, model: fallbackModel })
    }
    throw error
  }
}
```

**这意味着什么？** "分析并思考"这一步不是同步等待——模型在思考的时候，工具已经在执行了。主模型过载时，用户不会看到报错，系统默默切换模型继续工作。

### 步骤 3：agent 执行动作——智能并发调度

这是工程复杂度最高的一步。Claude Code 不是简单地"一个一个执行工具"，而是做了**智能批处理**：

```typescript
// toolOrchestration.ts — 将工具调用分为并发安全的批次
function partitionToolCalls(toolUseMessages, toolUseContext): Batch[] {
  return toolUseMessages.reduce((acc, toolUse) => {
    const isConcurrencySafe = tool?.isConcurrencySafe(parsedInput.data)
    // 连续的只读工具合并到同一个批次，并发执行
    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      // 有副作用的操作单独成批，串行执行
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }
  }, [])
}
```

逻辑很清晰：
- **Read、Glob、Grep** 等只读工具 → 连续的合并到一批，并发执行
- **Write、Edit、Bash** 等有副作用的工具 → 串行执行，保证安全
- **每批之间** → 串行，前一批的结果影响后一批的执行

**工具执行中的权限检查**：每个工具执行前都要过权限关：

```typescript
// toolExecution.ts — 权限检查 → hooks → 执行
for await (const update of streamedCheckPermissionsAndCallTool(
  tool, toolUseID, toolInput, toolUseContext, canUseTool, ...
)) {
  yield update
}
```

**工具每轮结束后刷新**：MCP 服务器可能在执行过程中新连接，所以每轮结束时刷新可用工具列表：

```typescript
// query.ts — 刷新工具列表
if (updatedToolUseContext.options.refreshTools) {
  const refreshedTools = updatedToolUseContext.options.refreshTools()
  if (refreshedTools !== updatedToolUseContext.options.tools) {
    updatedToolUseContext = { ...updatedToolUseContext, options: { ...updatedToolUseContext.options, tools: refreshedTools } }
  }
}
```

**这意味着什么？** 如果模型决定同时读取 10 个文件，这 10 个 Read 调用并发执行。如果接着要写 3 个文件，写操作会串行排队。读取的安全性由 `isConcurrencySafe` 判断，开发者不需要手动标注。

**子代理系统（Agent Tool）**：除了内置工具，Claude Code 还能通过 `Agent` 工具派生子代理。子代理有独立的上下文，但共享父代理的基础设施：

```typescript
// createSubagentContext.ts — 创建隔离的子代理上下文
export function createSubagentContext(parentContext, agentId, agentType) {
  return {
    ...parentContext,
    agentId,
    agentType,
    // 子代理的 setAppState 是 no-op，防止污染父状态
    setAppState: () => {},
    // 但 setAppStateForTasks 仍然指向根 store
    setAppStateForTasks: parentContext.setAppStateForTasks,
    // 独立的权限追踪
    localDenialTracking: createDenialTrackingState(),
    // 继承父代理的系统 prompt 以共享缓存
    renderedSystemPrompt: parentContext.renderedSystemPrompt,
  }
}
```

子代理支持两种模式：**Fork**（全新实例，独立上下文）和 **Resume**（恢复之前的子代理，保持状态）。子代理的 `setAppState` 是空操作，防止它污染父代理的 UI 状态；但 `setAppStateForTasks` 仍然指向根 store，这样子代理可以注册跨生命周期的任务。

### 步骤 4：agent 获取反馈并更新策略——反馈的丰富度决定了下一轮的质量

工具执行完毕后，`queryLoop()` 不是简单地把结果拼回去，而是经过一系列处理，构建出一个极其丰富的反馈包：

**工具结果摘要（Tool Use Summary）**：模型使用的工具和结果太多时，会用 Haiku 模型生成一个摘要，不阻塞下一轮循环：

```typescript
// query.ts — 工具摘要异步生成
nextPendingToolUseSummary = generateToolUseSummary({
  tools: toolInfoForSummary,  // 工具名、输入、输出
  signal: abortController.signal,
  lastAssistantText,  // 最后一条 assistant 消息的文本
}).then(summary => summary ? createToolUseSummaryMessage(summary, toolUseIds) : null)
  .catch(() => null)
```

这个摘要在**下一轮**迭代中 yield 给 UI。也就是说，上一轮的工具摘要与下一轮的模型输出是并行的。

**错误恢复——反馈不是终点，是起点**：当反馈中包含错误时，`queryLoop()` 不会把错误抛给用户，而是注入回循环让模型修正：

- **max_output_tokens 截断** → 注入 meta 消息让模型"从中断处继续"，最多重试 3 次
- **prompt-too-long** → 先 withhold 错误，尝试响应式压缩后 continue
- **stop hook 阻断** → 将错误注入循环让模型修正行为

```typescript
// max_output_tokens 截断恢复
const recoveryMessage = createUserMessage({
  content: `Output token limit hit. Resume directly — no apology, no recap.
            Pick up mid-thought if that is where the cut happened.`,
  isMeta: true,
})
state = { messages: [...messagesForQuery, ...assistantMessages, recoveryMessage], ... }
continue
```

**响应式压缩**：如果 API 返回 413（上下文太长），错误被"扣留"（withhold），系统先尝试压缩再重试：

```typescript
// 错误被扣留，不立即 yield
if (reactiveCompact?.isWithheldPromptTooLong(message)) { withheld = true }
if (isWithheldMaxOutputTokens(message)) { withheld = true }
if (!withheld) { yield yieldMessage }
```

还有**熔断器**：连续 3 次压缩都失败，就停止尝试，避免浪费 API 调用：

```typescript
// autoCompact.ts — 源码注释
// 1,279 sessions had 50+ consecutive failures (up to 3,272)
// wasting ~250K API calls/day globally
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
```

**这意味着什么？** 反馈不只是"工具返回了什么"，而是经过摘要、错误恢复、压缩保护后的**高质量反馈**。模型在下一轮拿到的不是原始工具输出，而是经过精心处理的上下文。

### 步骤 5：重复以上步骤，直到任务完成——状态管理的精巧设计

循环的"重复"看似简单，但 1400 行的循环如何不变成面条代码？关键在状态管理。

`queryLoop()` 把状态分为两类：

**不可变参数**（整个查询期间不变）：
```typescript
const { systemPrompt, userContext, systemContext, canUseTool, fallbackModel, maxTurns } = params
```

**可变状态**（每次 continue 时整体替换）：
```typescript
type State = {
  messages: Message[]                // 消息列表
  toolUseContext: ToolUseContext      // 工具上下文
  autoCompactTracking: ...           // 压缩追踪
  maxOutputTokensRecoveryCount: number  // token 恢复计数
  hasAttemptedReactiveCompact: boolean  // 是否尝试过响应式压缩
  pendingToolUseSummary: Promise | undefined  // 待处理的工具摘要
  turnCount: number                  // 当前轮数
  transition: Continue | undefined   // 上一次 continue 的原因
}
```

每个 continue 站点不是零散地修改变量，而是**整体替换 State 对象**：

```typescript
const next: State = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  toolUseContext: toolUseContextWithQueryTracking,
  turnCount: nextTurnCount,
  ...
  transition: { reason: 'next_turn' },  // 记录为什么 continue
}
state = next
```

`transition` 字段记录了"上一次为什么 continue"，用于防止无限循环——比如已经 drain 过 collapse 但仍然 413，就不会再 drain 了。

**终止条件**：循环只有两种正常退出：
- `return { reason: 'completed' }` — 模型输出 `end_turn`，无工具调用
- `return { reason: 'max_turns' }` — 达到最大轮数限制

**这意味着什么？** 1400 行的 `while(true)` 循环没有变成意大利面条，归功于"不可变参数 + 可变 State 整体替换"的设计。每次迭代开始时，所有状态都是从 State 解构出来的，保证读到的是一致快照。

## 总结：Agent Loop 的实现深度决定智能体的能力上限

回到标题：**Agent Loop is All You Need**。

这句话有两层含义：

1. **概念上**：Agent Loop 的五步确实是智能体的核心架构，不需要更花哨的框架。

2. **实践上**：知道 Agent Loop 的概念和真正实现好一个 Agent Loop 是完全不同的事情。Claude Code 的出色不是因为有什么神秘的算法，而是在每一步都比别人做得更深：

| 步骤 | 普通实现 | Claude Code |
|------|---------|-------------|
| 1. 得到输入 | 用户消息原文 | 四级压缩 + 附件注入 + Memory/Skill 预取 |
| 2. 分析思考 | 同步调 API | 流式接收 + 流式工具执行 + 模型过载自动降级 |
| 3. 执行动作 | 全部串行 | 只读并发 + 写入串行 + 子代理 Fork/Resume + 工具列表动态刷新 |
| 4. 获取反馈 | 工具结果原文 | 摘要生成 + 错误 withhold + 响应式压缩 + 熔断器 |
| 5. 循环状态 | 散变量 | 不可变参数 + State 对象整体替换 + transition 防死循环 |

**Agent Loop 的概念是简单的。但把简单的事做到极致——这就是 Claude Code 出色的原因。**


## Astrcode 的 Agent Loop


### 架构对比：巨型函数 vs 组件化

Claude Code 的 `queryLoop()` 是一个函数扛下所有：

```
queryLoop() — 1400 行
├── 消息准备（四级压缩）
├── API 调用
├── 流式解析
├── 工具匹配
├── 权限检查
├── 错误重试
├── 7 个 continue 站点
└── State 管理
```

Astrcode 的 `AgentLoop` 是一个结构体，持有 8 个独立组件，每个组件各司其职：

```rust
// agent_loop.rs — AgentLoop 结构体
pub struct AgentLoop {
    factory: DynProviderFactory,       // LLM Provider 工厂
    capabilities: CapabilityRouter,    // 能力路由器（工具注册表）
    policy: Arc<dyn PolicyEngine>,     // 策略引擎
    approval: Arc<dyn ApprovalBroker>, // 审批代理
    prompt: PromptRuntime,             // Prompt 运行时
    context: ContextRuntime,           // Context 运行时
    compaction: CompactionRuntime,     // Compaction 运行时
    hooks: HookRuntime,                // 生命周期 hook
    request_assembler: RequestAssembler, // 请求装配器
}
```

核心循环被拆成三个独立模块：**turn_runner**（步循环编排）、**llm_cycle**（LLM 调用）、**tool_cycle**（工具执行）。

### AgentLoop 是怎么被组装出来的？

上面说了结构，但 AgentLoop 不是凭空出现的。我们来看看它从零到运行的完整组装流程，对比 Claude Code 的做法。

**Claude Code 的组装**：所有东西塞进一个巨大的构造函数参数对象。

```typescript
// ask() 函数 — Claude Code 的组装方式
const engine = new QueryEngine({
  cwd, tools, commands, mcpClients, agents,
  canUseTool, getAppState, setAppState,
  initialMessages: mutableMessages,
  readFileCache: cloneFileStateCache(getReadFileCache()),
  customSystemPrompt, appendSystemPrompt,
  userSpecifiedModel, fallbackModel, thinkingConfig,
  maxTurns, maxBudgetUsd, taskBudget, jsonSchema,
  verbose, handleElicitation, replayUserMessages,
  includePartialMessages, setSDKStatus, abortController,
  orphanedPermission,
  // ... 还有 feature flag 控制的条件参数
})
```

25+ 个参数一次性传入，没有分层，没有验证，没有中间状态。整个 QueryEngine 是一个"全有或全无"的对象——你要么给它所有东西，要么别创建它。

**Astrcode 的组装**：分三层逐步构建，每层有明确的职责边界。

```text
第一层：RuntimeService（门面）— 持有全局状态
  │
  ├── sessions: DashMap<String, Arc<SessionState>>   // 会话存储
  ├── loop_: RwLock<Arc<AgentLoop>>                  // Agent Loop（可热替换）
  ├── surface: RwLock<RuntimeSurfaceState>            // 能力表面快照
  ├── policy: Arc<dyn PolicyEngine>                   // 策略引擎
  ├── approval: Arc<dyn ApprovalBroker>               // 审批代理
  ├── config: Mutex<Config>                           // 运行时配置
  └── observability: Arc<RuntimeObservability>        // 可观测性
```

```text
第二层：build_agent_loop() — 用 Builder 模式组装
  │
  ├── AgentLoop::from_capabilities_with_prompt_inputs(
  │     factory,           // LLM Provider 工厂
  │     capabilities,      // 工具注册表
  │     prompt_declarations, skill_catalog, prompt_builder  // Prompt 相关
  │   )
  │
  ├── .with_policy_profile(active_profile)            // 策略配置
  ├── .with_hook_handlers(hook_handlers)              // 生命周期钩子
  ├── .with_max_tool_concurrency(...)                 // 并发度
  ├── .with_auto_compact_enabled(...)                 // 自动压缩
  ├── .with_compact_threshold_percent(...)             // 压缩阈值
  ├── .with_tool_result_max_bytes(...)                 // 工具结果截断
  ├── .with_compact_keep_recent_turns(...)             // 保留轮数
  ├── .with_policy_engine(policy)                      // 策略引擎
  └── .with_approval_broker(approval)                  // 审批代理
```

```text
第三层：AgentLoop 内部初始化 — 每个字段创建独立组件
  │
  ├── PromptRuntime::new(PromptComposer::with_defaults(), ...)
  ├── ContextRuntime::new(tool_result_max_bytes)
  ├── CompactionRuntime::with_truncate_bytes(...)
  ├── HookRuntime::default()
  └── RequestAssembler
```

关键区别在于 **热替换**。Claude Code 的 QueryEngine 创建后就是固定的，想换工具列表？重新创建整个引擎。Astrcode 的 AgentLoop 存放在 `RwLock<Arc<AgentLoop>>` 里，运行时可以原子替换：

```rust
// loop_surface/service.rs — 运行时热替换 AgentLoop
pub async fn replace_surface(&self, ...) -> ServiceResult<()> {
    let _guard = self.runtime.rebuild_lock.lock().await;  // 加锁防止并发替换
    let next_loop = build_agent_loop(&next_surface, ...); // 构建新的 AgentLoop
    *self.runtime.loop_.write().await = next_loop;         // 原子替换
    *self.runtime.surface.write().await = next_surface;    // 同步更新 surface 快照
}
```

这意味着 MCP 服务器新连接、插件热加载、配置变更——所有这些都不需要重启服务，只需要 `replace_surface()` 构建一个新的 AgentLoop 并替换。正在运行的 turn 仍然持有旧的 `Arc<AgentLoop>`（引用计数保证安全），下一个 turn 自动使用新配置。

用一个完整的图来对比两者的组装和运行流程：

```text
┌─ Claude Code ──────────────────────────────────────────────────────┐
│                                                                     │
│  ask() / submitMessage()                                           │
│    │                                                                │
│    ├── new QueryEngine({ 25+ params })   ← 全量构造，一次性完成     │
│    │                                                                │
│    └── queryLoop()                       ← 1400 行循环，所有逻辑内联│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─ Astrcode ──────────────────────────────────────────────────────────┐
│                                                                     │
│  RuntimeService::from_runtime_services()                            │
│    │                                                                │
│    ├── RuntimeSurfaceState { capabilities, skills, hooks, ... }    │
│    │       │                                                        │
│    │       └── build_agent_loop(surface, config, deps)              │
│    │               │                                                │
│    │               ├── AgentLoop::from_capabilities(...)            │
│    │               │       │                                        │
│    │               │       └── 内部初始化 8 个组件                  │
│    │               │                                                │
│    │               └── .with_policy_engine() / .with_approval()    │
│    │                       │                                        │
│    │                       └── Arc<AgentLoop> 存入 RwLock           │
│    │                                                                │
│    └── submit_prompt() → run_turn(agent_loop, state, ...)           │
│            │                                                        │
│            ├── context.build_bundle()   ← ContextRuntime            │
│            ├── prompt.build_plan()      ← PromptRuntime             │
│            ├── request_assembler.build() ← RequestAssembler         │
│            ├── llm_cycle::generate()    ← 独立模块                  │
│            └── tool_cycle::execute()    ← 独立模块                  │
│                                                                     │
│  热替换路径: replace_surface() → build_agent_loop() → 原子替换     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 同样的五步，不同的实现深度

我们用同样的五步框架来对比两个实现：

#### 步骤 1：agent 得到输入

**Claude Code** 的做法是在 `queryLoop()` 内联四级压缩管线。

**Astrcode** 把输入准备拆成三个独立阶段：

```rust
// turn_runner.rs — 输入准备阶段

// 1. ContextRuntime 构建上下文包（含消息裁剪、工具结果截断）
let bundle = agent_loop.context.build_bundle(state, ContextBundleInput { ... })?;

// 2. PromptRuntime 组装系统提示词，生成 plan
let build_output = agent_loop.prompt.build_plan(state, &bundle.conversation, ...).await?;

// 3. RequestAssembler 最终装配，将 plan + context + 工具定义组装为 LLM 请求
let PreparedRequest { request, prompt_snapshot, .. } =
    agent_loop.request_assembler.build_step_request(StepRequestConfig { ... }, &token_tracker)?;
```

每个阶段是独立的 struct，有自己的测试。Claude Code 的四级压缩是内联代码，Astrcode 的三级准备是独立模块。

#### 步骤 2：agent 分析输入并思考选择工具

**Claude Code** 的 API 调用、流式解析、模型降级都在 `queryLoop()` 内部。

**Astrcode** 把 LLM 交互封装在 `llm_cycle` 模块中，且在调用前多了两层策略检查：

```rust
// turn_runner.rs — 调用 LLM 前的策略检查

// 1. 策略引擎决定是否需要压缩
let context_strategy = agent_loop.policy
    .decide_context_strategy(&decision_input, &policy_ctx).await?;
if matches!(context_strategy, ContextStrategy::Compact) {
    // 执行压缩，然后 continue 回到循环开头
}

// 2. 策略引擎检查/重写请求（如敏感内容过滤）
let request = agent_loop.policy
    .check_model_request(request, &policy_ctx).await?;

// 3. 实际调用 LLM
let output = llm_cycle::generate_response(&provider, request, ...).await?;
```

注意：Claude Code 没有"策略引擎检查请求"这一步。Astrcode 的 `PolicyEngine` 是一个独立的 trait，可以插入不同的策略实现（全允许、全拒绝、条件判断），不需要改动循环代码。

#### 步骤 3：agent 执行动作

这是两个实现最相似的一步——都做了**只读工具并发、写入工具串行**的分区调度。

**Claude Code**（`toolOrchestration.ts`）：
```typescript
function partitionToolCalls(toolUseMessages, toolUseContext): Batch[] {
  // 连续的只读工具合并到同一个批次 → 并发执行
  // 有副作用的操作单独成批 → 串行执行
}
```

**Astrcode**（`tool_cycle.rs`）：
```rust
// 同样的分区逻辑
if descriptor.concurrency_safe {
    safe_calls.push(pending);   // → 并发执行
} else {
    unsafe_calls.push(pending); // → 串行执行
}
```

但 Astrcode 多了三层决策：

```rust
// tool_cycle.rs — 三层决策：策略 → 审批 → 执行
match agent_loop.policy.check_capability_call(proposed_call, &policy_ctx).await? {
    PolicyVerdict::Allow(allowed_call) => {
        // 直接进入执行队列
    },
    PolicyVerdict::Deny { reason } => {
        // 直接返回错误结果给 LLM
    },
    PolicyVerdict::Ask(pending) => {
        // 阻塞等待用户审批
        let resolution = agent_loop.approval.request(request, cancel).await?;
        if resolution.approved { /* 进入执行队列 */ }
        else { /* 返回拒绝结果 */ }
    },
}
```

Claude Code 的权限检查是 `canUseTool()` 函数散落在循环体内。Astrcode 把策略判断（PolicyEngine）和用户交互（ApprovalBroker）解耦成两个独立 trait——换策略不需要改循环代码，mock PolicyEngine 就能单独测工具执行。

并发执行方面，Astrcode 使用 `FuturesUnordered` + `buffer_unordered(concurrency_limit)`：

```rust
// tool_cycle.rs — 安全工具并发执行
stream::iter(safe_calls)
    .map(move |pending| { /* 执行单个工具 */ })
    .buffer_unordered(concurrency_limit) // 受限并发
```

#### 步骤 4：agent 获取反馈并更新策略

两个实现都有**响应式压缩**和 **max_tokens 截断恢复**，但实现方式不同。

**max_tokens 截断恢复**：

```rust
// turn_runner.rs — max_tokens 截断时注入 nudge 消息
if output.finish_reason.is_max_tokens() {
    if output_continuation_count < MAX_OUTPUT_CONTINUATION_ATTEMPTS {
        output_continuation_count += 1;
        conversation.messages.push(LlmMessage::User {
            content: "Continue from where you left off. Do not repeat or summarize.",
            origin: UserMessageOrigin::AutoContinueNudge,
        });
        continue; // 不终止 turn，继续下一轮 step
    }
}
```

Claude Code 也做同样的事，但用 `isMeta: true` 标记的 meta 消息。

**响应式压缩**：

```rust
// turn_runner.rs — prompt too long 时自动压缩重试
Err(error) => {
    let is_too_long = is_prompt_too_long(&error);
    if is_too_long && agent_loop.auto_compact_enabled()
        && reactive_compact_attempts < MAX_REACTIVE_COMPACT_ATTEMPTS
    {
        reactive_compact_attempts += 1;
        match maybe_compact_conversation(agent_loop, ...).await {
            Ok(Some(compacted_view)) => {
                conversation = ConversationView::new(compacted_view.messages);
                continue 'step; // 压缩成功，重试
            },
            Ok(None) => {
                return report_error(...); // 无可压缩内容
            },
            Err(compact_error) => { ... }
        }
    }
}
```

两个系统的响应式压缩逻辑几乎一致——最多重试 3 次，压缩成功就 `continue` 回循环开头。区别在于 Astrcode 的压缩是由 `CompactionRuntime` 独立承载的，包含 pre/post hook 支持，允许插件在压缩前后做干预（比如自定义摘要）。

#### 步骤 5：重复以上步骤，直到任务完成

**Claude Code** 用 `State` 对象管理可变状态，每次 `continue` 整体替换。

**Astrcode** 的 turn_runner 用 Rust 的 `'step: loop` 和局部变量：

```rust
// turn_runner.rs — 核心循环
let mut conversation = ConversationView::new(state.messages.clone());
let mut step_index = 0usize;
let mut output_continuation_count = 0u8;
let mut reactive_compact_attempts = 0usize;

'step: loop {
    // 1. 构建上下文包
    // 2. 组装 prompt
    // 3. 装配请求
    // 4. 调用 LLM
    let output = llm_cycle::generate_response(...).await;
    // 5. 如果没 tool_calls → 结束
    if tool_calls.is_empty() { return complete_turn(...); }
    // 6. 有 tool_calls → 执行工具 → continue
    tool_cycle::execute_tool_calls(...).await;
    step_index += 1;
}
```

循环本身的职责只有"调度"——LLM 调用细节在 `llm_cycle`，工具执行细节在 `tool_cycle`，上下文构建在 `ContextRuntime`。

终止条件也类似：
- `TurnOutcome::Completed` — LLM 无工具调用，自然结束
- `TurnOutcome::Cancelled` — 取消信号触发
- `TurnOutcome::Error { message }` — 不可恢复错误

### 对比总结

| 维度 | Claude Code `queryLoop()` | Astrcode `AgentLoop` |
|------|--------------------------|---------------------|
| **代码组织** | 1400 行巨型函数 | 8 个独立组件 + 3 个子模块 |
| **输入准备** | 内联四级压缩 | ContextRuntime → PromptRuntime → RequestAssembler 三级流水线 |
| **策略控制** | `canUseTool()` 散落在循环中 | 独立 PolicyEngine trait，可插拔 |
| **审批流程** | 与权限检查耦合 | 独立 ApprovalBroker trait，与策略解耦 |
| **工具调度** | `partitionToolCalls()` 内联 | 独立 `tool_cycle` 模块，同样分区并发 |
| **错误恢复** | 7 个 continue 站点，隐式阶段 | 结构化 match，显式 `'step` 循环标签 |
| **压缩系统** | 内联 autocompact + reactive compact | 独立 CompactionRuntime，支持 hook 钩子 |
| **可测试性** | 极难单测 1400 行循环 | 每个组件可独立 mock 和测试 |
| **并发安全** | Node.js 单线程，无并发问题 | Rust 原生 async，`CancelToken` 协作式取消 |
