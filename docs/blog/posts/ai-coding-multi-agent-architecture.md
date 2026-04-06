---
title: "五大编程 AI 多 Agent 系统与 AgentTool 架构深度对比"
date: 2026-04-06
category: "ai say and i say"
tags:
  - AI 编程工具
  - 多Agent架构
  - AgentTool设计
  - Claude Code
  - OpenCode
  - Codex
  - Kimi CLI
  - Pi Mono
description: "从 Agent 注册表到子 Agent 生命周期管理，从工具池组装到权限继承，深度对比 Claude Code、OpenCode、Codex、Kimi Code CLI 和 Pi-mono 的多 Agent 系统与 AgentTool 实现架构。"
---

## 引言

多 Agent 协作是 AI 编程助手向复杂任务进化的必由之路。一个 Agent 能做的事情有限——当需要并行探索代码、执行重构、同时处理多个文件变更时，**多 Agent 系统**就是核心架构。

本文基于对 [Claude Code](https://github.com/anthropics/claude-code)、[OpenCode](https://github.com/sst/opencode)、[Codex](https://github.com/openai/codex)、[Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) 和 [Pi-mono](https://github.com/pi-corp/pi-mono) 源码的深度分析，从以下维度拆解它们的多 Agent 和 AgentTool 实现：

1. **Agent 定义与注册**：Agent 如何被定义、注册、发现
2. **Agent 生命周期**：创建、执行、监控、回收
3. **Agent 间通信**：父子通信、跨 Agent 消息、状态同步
4. **AgentTool 系统**：工具如何分配给 Agent、权限继承、工具池组装
5. **架构设计哲学**：每个系统的核心设计理念

---

## 一、总览对比表

| 维度 | Claude Code | OpenCode | Codex | Kimi Code CLI | Pi-mono |
|------|-------------|----------|-------|---------------|---------|
| **语言** | TypeScript (Bun) | TypeScript | Rust | Python | TypeScript |
| **Agent 类型** | 内置 Agent + 用户定义 Agent (YAML/MD) | 内置 Agent + 配置 Agent | Thread(Thread) + 内置 Agent | Agent YAML + SubAgent | 扩展生成 Agent（无预定义类型） |
| **Agent 注册机制** | 内置 + `loadAgentsDir()` 动态加载 | `Config.get()` 合并用户配置 | `AgentRegistry` 注册表 | `LaborMarket` 注册表 | `registerTool()` + 事件修改系统提示 |
| **多 Agent 并发** | ✔ 并行子 Agent + Swarm(团队) | ✔ Parallel tool 并发 | ✔ Thread 并发 + fork | ✘ 前台串行 + 后台异步 | ✔ Session Fork + 扩展工具注册 |
| **Agent 隔离** | Worktree / Remote | 无 | Thread 隔离 + Rollout fork | Context 隔离 | Session Fork 独立会话文件 |
| **背景运行** | ✔ 异步 Agent + TMUX | ✘ | ✔ 持久线程 | ✔ 后台线程 | ✘（通过工具并发实现） |
| **工具池组装** | `assembleToolPool()` 动态过滤 | `Tool.define()` 工厂 + 权限 | `ToolRegistry` trait 分发 | `KimiToolset` 动态导入 + 策略 | 工具直接注册 |
| **工具权限** | 权限矩阵 + 模式(plan/edit) | 权限规则集(allow/deny/ask) | ExecPolicy + Sandbox | ToolPolicy(allowlist/inherit) | 事件拦截 + `tool_call` hook |
| **Agent 间通信** | TaskOutput + SendMessage | Agent 状态轮询 | Mailbox + 事件通知 | Wire 消息总线 | sendMessage() + sendUserMessage() |

---

## 二、多 Agent 系统架构

### 2.1 Claude Code：Agent 即工具的生态系统

Claude Code 的多 Agent 架构是最复杂的，Agent 本质上是一种**特殊的工具**（`AgentTool`），可以像任何工具一样被调用。

#### Agent 定义

```typescript
// src/tools/AgentTool/AgentTool.tsx
const inputSchema = z.object({
  description: z.string().describe('A short (3-5 word) description of the task'),
  prompt: z.string().describe('The task for the agent to perform'),
  subagent_type: z.string().optional().describe('The type of specialized agent to use'),
  model: z.enum(['sonnet', 'opus', 'haiku']).optional(),
  run_in_background: z.boolean().optional(),
  // Multi-agent (Agent Swarms) 扩展
  name: z.string().optional(),           // 可寻址命名
  team_name: z.string().optional(),      // 团队名
  mode: z.enum(['default', 'plan', ...]).optional(),
  isolation: z.enum(['worktree', 'remote']).optional(),
  cwd: z.string().optional(),
});
```

#### Agent 加载与注册

```
内置 Agent (built-in/)
    ├── generalPurposeAgent.ts    // 通用探索 Agent
    ├── plannerAgent.ts           // 规划 Agent
    ├── ...
用户定义 Agent
    ├── .claude/agents/*.yaml     // YAML 定义
    ├── .claude/agents/*.md       // Markdown 定义
    └── AGENTS.md                 // 合并注入
```

Agent 通过 `loadAgentsDir()` 动态扫描 `.claude/agents/` 目录中的 YAML/MD 文件，与内置 Agent 合并后注册。

#### Agent 生命周期

```
spawn_agent()
    ├── 创建 Agent ID (createAgentId)
    ├── 组装工具池 (assembleToolPool(filtered by agent type))
    ├── 构建系统提示 (getPrompt(agentDef, tools, agents))
    ├── 权限过滤 (filterDeniedAgents, getDenyRuleForAgent)
    ├── 创建工作树 (createAgentWorktree) [可选]
    ├── 注册异步任务 (registerAsyncAgent / registerAgentForeground)
    ├── 运行 Agent (runAgent())
    │   ├── LLM 调用链
    │   ├── 工具执行
    │   └── 结果汇总
    └── 结果回收 (finalizeAgentTool)
        ├── 清理工作树 (removeAgentWorktree)
        ├── 摘要化 (startAgentSummarization)
        └── 进度通知 (enqueueAgentNotification)
```

#### Agent Swarms（团队多 Agent）

Claude Code 的 Agent Swarms 通过 `spawnTeammate()` 实现，支持：
- **TMUX 面板分割**：多个 Agent 在同一终端中分屏显示
- **SendMessage 工具**：Agent 之间可以互相发送消息
- **TeamCreateTool / TeamDeleteTool**：团队的创建和销毁
- **远程 Agent**：支持远程 CCR 环境执行

#### 关键设计

- **Agent 即工具**：从调用方看来，Agent 就是一个 `Tool`，返回结果也是工具结果格式
- **工具池过滤**：每个 Agent 有独立的工具池，通过权限系统过滤
- **权限隔离**：子 Agent 可以配置为 plan 模式，限制编辑能力
- **异步/同步双模式**：`run_in_background: true` 时异步执行，否则同步等待

---

### 2.2 OpenCode：轻量 Agent + 并行工具

OpenCode 的多 Agent 设计更加简洁，核心概念是 **Agent 即权限配置文件**。

#### Agent 定义

```typescript
// src/agent/agent.ts
export const Info = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  permission: PermissionNext.Ruleset,
  model: z.object({ modelID: z.string(), providerID: z.string() }).optional(),
  prompt: z.string().optional(),
  steps: z.number().int().positive().optional(),
});
```

#### 内置 Agent

```typescript
// build Agent - 默认执行 Agent
build: {
  name: "build",
  description: "The default agent. Executes tools based on configured permissions.",
  mode: "primary",
  native: true,
  permission: { "*": "allow", doom_loop: "ask", question: "allow" }
}

// plan Agent - 规划模式
plan: {
  name: "plan",
  description: "Plan mode. Disallows all edit tools.",
  mode: "primary",
  permission: { edit: { "*": "deny" }, plan_exit: "allow" }
}

// general Agent - 通用子 Agent
general: {
  name: "general",
  description: "General-purpose agent for researching complex questions...",
  mode: "subagent",
  permission: { ... }  // 继承但有限制
}
```

#### Agent 调度

```
用户请求 spawnAgent
    ↓
Agent.Info 配置查找
    ↓
获取工具列表 (从 tool.ts 的 TOOL_MAP)
    ↓
过滤工具 (PermissionNext.filter)
    ↓
创建查询 (query/generate)
    ↓
执行并返回结果
```

#### 并行执行

OpenCode 使用 `@ai-sdk/multiply` 的 `experimental_parallel` 实现多工具并发：

```typescript
import { experimental_parallel } from "@ai-sdk/multiply";
await query({ input: messages, tools: allTools, model });
```

最多支持 25 个工具并发执行（`experimental_maxToolsetCalls`），这是 OpenCode 实现"多 Agent 效果"的方式——不是真正的独立 Agent 进程，而是在同一 session 内并行调用多个工具。

---

### 2.3 Codex：Thread 级别的多 Agent 系统

Codex 的多 Agent 架构建立在 **Thread（线程）** 之上，每个 Thread 是一个独立的 Agent 实例。

#### 核心数据结构

```rust
// codex-rs/core/src/agent/registry.rs
pub(crate) struct AgentRegistry {
    active_agents: Mutex<ActiveAgents>,
    total_count: AtomicUsize,
}

struct ActiveAgents {
    agent_tree: HashMap<String, AgentMetadata>,     // Agent 路径 -> 元数据
    used_agent_nicknames: HashSet<String>,           // 已用昵称（避免冲突）
    nickname_reset_count: usize,                     // 昵称重置计数
}

pub(crate) struct AgentMetadata {
    pub(crate) agent_id: Option<ThreadId>,
    pub(crate) agent_path: Option<AgentPath>,
    pub(crate) agent_nickname: Option<String>,
    pub(crate) agent_role: Option<String>,
    pub(crate) last_task_message: Option<String>,
}
```

#### AgentControl — 多 Agent 的控制平面

```rust
// codex-rs/core/src/agent/control.rs
pub(crate) struct AgentControl {
    manager: Weak<ThreadManagerState>,    // 弱引用避免循环
    state: Arc<AgentRegistry>,            // 共享注册表
}

impl AgentControl {
    // 创建新 Agent 线程
    pub(crate) async fn spawn_agent(
        &self,
        config: Config,
        initial_operation: Op,
        session_source: Option<SessionSource>,
    ) -> CodexResult<ThreadId>;
    
    // 带元数据的创建
    pub(crate) async fn spawn_agent_with_metadata(...) -> CodexResult<LiveAgent>;
    
    // 从 Rollout 恢复 Agent
    pub(crate) async fn resume_agent_from_rollout(...) -> CodexResult<ThreadId>;
    
    // 列出活跃 Agent
    pub(crate) async fn list_agents(&self) -> Vec<ListedAgent>;
    
    // Agent 间通信
    pub(crate) async fn send_message(...) -> CodexResult<()>;
}
```

#### Agent 树形结构

Codex 的 Agent 采用**树形拓扑**：

```
Root Thread
    ├── Sub-Agent A (depth=1)
    │   ├── Sub-Agent A-1 (depth=2)
    │   └── Sub-Agent A-2 (depth=2)
    └── Sub-Agent B (depth=1)
        └── Sub-Agent B-1 (depth=2)
```

`AgentPath` 用于标识 Agent 在树中的位置（如 `root/a/b`），`depth` 追踪嵌套深度。

#### Spawn 限制

```rust
pub(crate) fn exceeds_thread_spawn_depth_limit(depth: i32, max_depth: i32) -> bool {
    depth > max_depth
}
```

Codex 通过 `max_depth` 控制 Agent 嵌套深度，防止无限递归。`total_count` 控制总数。

#### Fork 模式

Codex 支持**Fork 模式**——从父 Agent 的 Rollout 历史中 fork 出新 Agent：

```rust
enum SpawnAgentForkMode {
    FullHistory,          // 完整历史
    LastNTurns(usize),    // 最近 N 轮
}
```

Fork 时会：
1. Flush/Rollout 父 Agent 的对话历史到 JSONL
2. 根据 fork mode 截取历史
3. 过滤掉不需要的响应类型（工具调用、推理等），保留系统/开发者/用户消息
4. 创建新线程

#### 内置 Agent

```toml
# codex-rs/core/src/agent/builtins/explorer.toml
name = "explorer"
description = "用于探索代码库和分析问题的子 Agent"
role = "explorer"
```

```toml
# codex-rs/core/src/agent/builtins/awaiter.toml
name = "awaiter"
description = "等待某个条件满足后继续执行的 Agent"
```

#### Mailbox — Agent 间消息系统

```rust
// codex-rs/core/src/agent/mailbox.rs
pub(crate) struct Mailbox {
    // 每个 Agent 有一个 Mailbox 用于接收消息
}

pub(crate) struct MailboxReceiver {
    // 异步接收消息
}
```

Agent 间通过 `Mailbox` 发送消息，支持异步等待。这是 Codex 多 Agent 协调的核心机制。

---

### 2.4 Kimi Code CLI：Foreground/Background 双模式 SubAgent

Kimi Code CLI 的多 Agent 系统设计独特，核心是 **Foreground（前台）/ Background（后台）** 两种运行模式。

#### Agent 类型定义

```python
# src/kimi_cli/subagents/models.py
@dataclass(frozen=True, slots=True, kw_only=True)
class AgentTypeDefinition:
    name: str                       # "default", "coder", "explore", "plan"
    description: str
    agent_file: Path                # YAML 文件路径
    when_to_use: str = ""
    default_model: str | None = None
    tool_policy: ToolPolicy = field(default_factory=lambda: ToolPolicy(mode="inherit"))
    supports_background: bool = True

@dataclass(frozen=True, slots=True, kw_only=True)
class ToolPolicy:
    mode: ToolPolicyMode            # "inherit" | "allowlist"
    tools: tuple[str, ...] = ()
```

#### Agent YAML 定义

```yaml
# src/kimi_cli/agents/default/plan.yaml
name: plan
description: 规划模式，不允许编辑工具
system_prompt: |
  你是一个规划助手...
tools:
  mode: allowlist
  tools: ["ReadFile", "Grep", "Glob", "ListDir", "Shell"]
```

#### LaborMarket — Agent 注册表

```python
# src/kimi_cli/subagents/registry.py
class LaborMarket:
    """内建 SubAgent 类型注册表"""
    def __init__(self):
        self._builtin_types: dict[str, AgentTypeDefinition] = {}
    
    def add_builtin_type(self, type_def: AgentTypeDefinition):
        self._builtin_types[type_def.name] = type_def
    
    def require_builtin_type(self, name: str) -> AgentTypeDefinition:
        type_def = self.get_builtin_type(name)
        if type_def is None:
            raise KeyError(f"Builtin subagent type not found: {name}")
        return type_def
```

#### SubAgent 生命周期（Soul 模型）

```
prepare_soul()
    ├── builder.build_builtin_instance()     # 从 YAML 构建 Agent 实例
    ├── context.restore()                    # 恢复对话上下文
    ├── context.write_system_prompt()        # 写入系统提示
    ├── collect_git_context()                # [仅 explore] 注入 Git 上下文
    └── KimiSoul(agent, context)             # 创建 Soul

ForegroundSubagentRunner.run()
    ├── _prepare_instance()                  # 准备实例记录
    ├── prepare_soul()                       # 构建 Soul
    └── run_soul()                           # 同步执行，等待结果
         └── 结果 → 返回给调用方

BackgroundAgentRunner.run()
    ├── prepare_soul()                       # 构建 Soul
    ├── Wire 文件创建                        # 创建通信 Wire
    └── 后台循环
         ├── run_soul()                      # 执行 Agent
         ├── Wire 写入结果                    # 结果写入 Wire 文件
         ├── Hook 系统事件                    # 通知父 Agent
         └── 等待父 Agent 消费结果
```

#### Wire 通信机制

Kimi CLI 使用 **Wire 文件**（Unix Domain Socket 或命名管道）进行 Agent 间通信：

```python
# wire/types.py
@dataclass
class ApprovalRequest:   # 审批请求
class ApprovalResponse:  # 审批响应
class ToolCallRequest:   # 工具调用请求
class SubagentEvent:     # SubAgent 事件（状态变更、进度等）
```

父 Agent 通过 `WatchWire` 监控子 Agent 的状态，子 Agent 通过写入 Wire 文件报告进度。

#### 摘要延续机制（Summary Continuation）

```python
SUMMARY_MIN_LENGTH = 200
SUMMARY_CONTINUATION_ATTEMPTS = 1
SUMMARY_CONTINUATION_PROMPT = """
Your previous response was too brief. Please provide a more comprehensive summary...
"""

async def run_with_summary_continuation(soul, prompt, ...):
    failure = await run_soul_checked(soul, prompt, ...)
    if failure is not None:
        return None, failure
    
    final_response = soul.context.history[-1].extract_text()
    # 如果摘要太短，自动追加 continuation prompt
    while remaining > 0 and len(final_response) < SUMMARY_MIN_LENGTH:
        failure = await run_soul_checked(soul, SUMMARY_CONTINUATION_PROMPT, ...)
        final_response = soul.context.history[-1].extract_text()
    return final_response, None
```

这是一个非常实用的设计——确保子 Agent 返回足够详尽的结果，避免因模型偷懒而丢失信息。

#### 审批源切换

```python
# approval_runtime/__init__.py
def set_current_approval_source(source: ApprovalSource):
    """切换审批源为子 Agent，确保审批走子 Agent 的通道"""
    
def reset_current_approval_source():
    """恢复父 Agent 的审批源"""
```

当子 Agent 需要用户审批时（如危险 Shell 命令），会通过 `set_current_approval_source` 切换审批通道，确保 Prompt 出现在正确的 UI 上下文中。

---

### 2.5 Pi-mono：事件驱动的扩展系统，自由扩展 SubAgent

与前四个代码库不同，**Pi-mono 没有硬编码的多 Agent 注册表和 Agent 类型定义**，而是通过一套**完整的 TypeScript 扩展系统（Extension System）**实现了 Agent 能力的最大自由度扩展——包括自定义 subagent、工具、会话分支、命令等一切。

#### 扩展系统核心架构

Pi-mono 的扩展系统由三个层次组成：

```
ExtensionFactory (pi: ExtensionAPI) → Extension → ExtensionRunner → 事件驱动执行
```

```typescript
// packages/coding-agent/src/core/extensions/types.ts

// 扩展工厂函数 — 用户代码的入口
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;

// ExtensionAPI — 扩展可以访问的完整能力
export interface ExtensionAPI {
    // === 事件订阅 ===
    on(event: "session_start", handler: ...): void;
    on(event: "agent_start", handler: ...): void;
    on(event: "agent_end", handler: ...): void;
    on(event: "tool_call", handler: ...): void;
    on(event: "tool_result", handler: ...): void;
    on(event: "before_agent_start", handler: ...): void;
    on(event: "session_before_compact", handler: ...): void;
    on(event: "session_before_fork", handler: ...): void;
    // ... 共 25+ 种事件

    // === 工具注册 ===
    registerTool(tool: ToolDefinition): void;

    // === 会话控制 ===
    sendMessage(message: CustomMessage, options?): void;
    sendUserMessage(content: string): void;
    appendEntry<T>(customType: string, data?: T): void;

    // === 扩展上下文操作 ===
    // 这些 ctx.* 方法可在命令处理中使用
    ctx.newSession(options?): Promise<{cancelled: boolean}>;
    ctx.fork(entryId: string): Promise<{cancelled: boolean}>;
    ctx.navigateTree(targetId: string, options?): Promise<{cancelled: boolean}>;
    ctx.switchSession(sessionPath: string): Promise<{cancelled: boolean}>;

    // === 模型管理 ===
    registerProvider(name: string, config: ProviderConfig): void;
    unregisterProvider(name: string): void;
    setModel(model: Model<any>): Promise<boolean>;

    // === 状态持久化 ===
    setSessionName(name: string): void;
    setLabel(entryId: string, label: string | undefined): void;
    setThinkingLevel(level: ThinkingLevel): void;
}
```

#### Session Fork — Pi-mono 的"SubAgent"机制

Pi-mono 通过 **Session Fork** 实现类似 SubAgent 的能力：

```typescript
interface ExtensionCommandContext extends ExtensionContext {
    /** 从特定 entry fork，创建一个新会话文件 */
    fork(entryId: string): Promise<{ cancelled: boolean }>;

    /** 开始新会话，可选择指定父会话 */
    newSession(options?: {
        parentSession?: string;
        setup?: (sessionManager: SessionManager) => Promise<void>;
    }): Promise<{ cancelled: boolean }>;

    /** 在会话树中导航（可携带摘要和自定义指令）*/
    navigateTree(targetId: string, options?: {
        summarize?: boolean;
        customInstructions?: string;
        replaceInstructions?: boolean;
        label?: string;
    }): Promise<{ cancelled: boolean }>;
}
```

Fork 事件可以被扩展拦截和定制：

```typescript
interface SessionBeforeForkEvent {
    type: "session_before_fork";
    entryId: string;
}

interface SessionBeforeForkResult {
    cancel?: boolean;                  // 可取消 fork
    skipConversationRestore?: boolean;  // 可跳过对话历史恢复
}
```

#### 事件驱动的全生命周期拦截

Pi-mono 的扩展系统覆盖了 Agent 的完整生命周期：

```typescript
// 事件时间线（从用户输入到 Agent 完成）
InputEvent                    // 用户输入
  → BeforeAgentStartEvent     // Agent 循环执行前（可修改 prompt、system prompt）
    → AgentStartEvent         // Agent 开始
      → ContextEvent          // LLM 调用前（可修改消息列表）
        → TurnStartEvent      // 每一轮开始
          → ToolCallEvent     // 工具调用前（可阻断/修改参数）
          → ToolResultEvent   // 工具返回后（可修改结果）
          → ToolExecution*Events // 工具执行事件流
      → MessageStartEvent     // 消息开始
      → MessageUpdateEvent    // 流式更新（token-by-token）
      → MessageEndEvent       // 消息结束
    → AgentEndEvent           // Agent 完成
  → ...下一轮或结束
```

每个事件都有对应的 Result 类型，允许扩展**拦截、修改甚至阻止**系统行为：

```typescript
// 在 Agent 开始前修改系统提示
on("before_agent_start", async (event, ctx) => {
    event.systemPrompt = customSystemPrompt;  // 替换系统提示
    return { systemPrompt: customPrompt };
});

// 拦截工具调用，可阻断或修改参数
on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command.includes("rm -rf")) {
        return { block: true, reason: "危险操作被扩展拦截" };
    }
    // 修改工具参数
    if (event.toolName === "edit") {
        event.input.oldText = normalizeText(event.input.oldText);
    }
});

// 修改工具结果
on("tool_result", async (event, ctx) => {
    return {
        content: [{ type: "text", text: sanitize(event.content) }],
        isError: false,
    };
});
```

#### 动态工具注册

扩展可以注册 LLM 可调用的自定义工具：

```typescript
export interface ToolDefinition<
    TParams extends TSchema = TSchema,
    TDetails = unknown,
    TState = any
> {
    name: string;                           // LLM 调用的工具名
    label: string;                          // UI 显示标签
    description: string;                    // LLM 理解工具的描述
    promptSnippet?: string;                 // 系统提示中的简短说明
    promptGuidelines?: string[];            // 追加到系统提示 Guidelines
    parameters: TParams;                    // TypeBox 参数.schema
    prepareArguments?: (args: unknown) => Static<TParams>;
    execute(
        toolCallId: string,
        params: Static<TParams>,
        signal: AbortSignal | undefined,
        onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
        ctx: ExtensionContext,
    ): Promise<AgentToolResult<TDetails>>;
    renderCall?: (...) => Component;        // 自定义工具调用 UI
    renderResult?: (...) => Component;       // 自定义工具结果 UI
}

// 使用示例
api.registerTool({
    name: "deploy_service",
    label: "部署服务",
    description: "将代码部署到指定的云服务环境",
    parameters: Type.Object({
        service: Type.String(),
        environment: Type.Enum({ dev: "dev", staging: "staging", prod: "prod" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
        // 执行部署逻辑...
        return {
            content: [{ type: "text", text: "部署成功" }],
            details: { serviceId: "123" },
        };
    },
});
```

#### 扩展加载机制

```typescript
// packages/coding-agent/src/core/extensions/loader.ts

// 虚拟模块系统（供扩展引用）
const VIRTUAL_MODULES: Record<string, unknown> = {
    "@mariozechner/pi-agent-core": piAgentCore,
    "@mariozechner/pi-ai": piAi,
    "@mariozechner/pi-tui": piTui,
    "@mariozechner/pi-coding-agent": piCodingAgent,  // 完整的 Agent 接口
    "@sinclair/typebox": typebox,                     // Schema 定义
};

// 使用 jiti 运行时加载扩展（支持 TypeScript 直接执行）
const jiti = createJiti(import.meta.url, {
    alias: getAliases(),
    virtualModules: VIRTUAL_MODULES,  // 编译后的 Bun 二进制使用
});
```

扩展通过配置发现并加载：

```
~/.pi-coding-agent/extensions/    # 用户全局扩展
.project/.pi/extensions/          # 项目级扩展
.builtin/extensions/              # 内置扩展
```

#### "SubAgent"在 Pi-mono 中是什么

Pi-mono 的"SubAgent"本质上是通过扩展 + 事件 + Session Fork 实现的**自由组合能力**：

| 能力 | 实现方式 |
|------|----------|
| 创建子 Agent | `ctx.newSession({ parentSession })` 或 `ctx.fork(entryId)` |
| 子 Agent 通信 | `api.sendMessage()` + `api.sendUserMessage()` |
| 子 Agent 隔离 | 独立 Session 文件 + 事件隔离 |
| 子 Agent 上下文 | `fork` 自带对话历史继承 |
| 自定义 Agent 类型 | 注册专属工具 + 修改 `before_agent_start` 系统提示 |
| Agent 生命周期钩子 | `agent_start` / `agent_end` / `turn_start` / `turn_end` 事件 |
| Agent 能力扩展 | `registerTool()` + `registerProvider()` + 事件拦截 |

这使得 Pi-mono 的扩展自由度在所有五个系统中**最为灵活**——不局限于预定义的 Agent 类型，任何 TypeScript 代码都可以通过 `registerTool()` 添加新工具、通过事件监听拦截 Agent 行为、通过 Fork/newSession 创建会话分支。

#### 会话树（Session Tree）

Pi-mono 的 Session 组织成树状结构，扩展可以：

```typescript
interface TreePreparation {
    targetId: string;
    oldLeafId: string | null;
    commonAncestorId: string | null;
    entriesToSummarize: SessionEntry[];
    userWantsSummary: boolean;
    customInstructions?: string;       // 自定义摘要指令
    replaceInstructions?: boolean;     // 替换而非追加
    label?: string;                    // 分支标签
}

// 扩展可以拦截树导航并自定义摘要
on("session_before_tree", async (event, ctx) => {
    event.preparation.customInstructions = "重点关注架构变更";
    return {
        summary: {
            summary: generateSummary(event.preparation.entriesToSummarize),
            details: { ...customMetadata }
        }
    };
});
```

#### 小结

| 维度 | Pi-mono 的方式 | 其他系统的方式 |
|------|--------------|---------------|
| Agent 定义 | 通过系统提示修改 + 工具注册动态定义 | 预定义的类型（YAML/配置文件） |
| 工具扩展 | `registerTool()` 即时注册 | 代码编译 + 重启 |
| 会话分支 | `fork()` + Session Tree 原生支持 | 专用 Thread/Swarm 机制 |
| 生命周期控制 | 25+ 事件，可拦截/修改/阻断 | 有限的钩子点 |
| Agent 间通信 | `sendMessage()` + `sendUserMessage()` | 专用通道（Mailbox/Wire） |
| 模型切换 | `registerProvider()` + `setModel()` | Agent YAML 中静态配置 |

这是一个**面向扩展（extension-oriented）**的设计哲学——Pi-mono 认为 Agent 的能力不应该被固化为几种预定义的类型，而应该允许用户通过代码自由组合和扩展。

---

## 三、AgentTool 系统架构对比

### 3.1 Tool 注册表架构

| 工具 | 注册表类型 | 注册方式 | 查找方式 |
|------|-----------|---------|---------|
| Claude Code | 函数 + 数组 | `buildTool()` 工厂 | 工具名直接查找 |
| OpenCode | Namespace + 对象 | `Tool.define()` 注册 | `id` 键查找 |
| Codex | `ToolRegistry` HashMap | 构造函数注入 | `handlers` HashMap |
| Kimi CLI | `KimiToolset` 字典 | `add(tool)` 注册 | `_tool_dict[name]` 查找 |
| Pi-mono | 直接数组注册 | 注册时传入数组 | 数组过滤 |

### 3.2 工具池组装（关键差异）

#### Claude Code — 动态过滤

```typescript
// src/tools.ts - assembleToolPool()
function assembleToolPool(options: {
    agentDefs?: AgentDefinitionsResult,
    currentAgent?: string,
    permissionContext: ToolPermissionContext,
    mcpClients?: MCPServerConnection[],
}): Tools {
    let tools = getAllBaseTools();
    
    // 1. 按功能开关过滤
    if (!feature('PROACTIVE')) tools = tools.filter(...);
    
    // 2. 按 Agent 类型过滤
    if (currentAgent) {
        tools = filterToolsForAgent({
            tools,
            isBuiltIn: agentDef.isBuildIn,
            isAsync: agentDef.isAsync,
            capabilities: agentDef.capabilities,
            permissionOverrides: agentDef.permissionOverrides,
        });
    }
    
    // 3. 按权限规则过滤
    tools = applyPermissionRules(tools, permissionContext);
    
    // 4. 添加 MCP 工具
    if (mcpClients) tools = [...tools, ...mcpTools];
    
    return tools;
}
```

关键设计：
- **功能开关驱动**：`feature()` 函数根据编译/运行时配置决定哪些工具可用
- **Agent 级过滤**：不同 Agent 看到不同的工具集
- **MCP 热插拔**：MCP 工具可以在运行时动态加入

#### OpenCode — 权限过滤

```typescript
// src/tool/index.ts
export async function get(input: string | string[]) {
    const names = Array.isArray(input) ? input : [input];
    const tools = await Promise.all(names.map(async (name) => {
        const def = definitions.get(name);
        return { ...def, ...(await def.init({ agent: agentInfo })) };
    }));
    
    // 权限过滤
    const allowed = PermissionNext.filter(tools, agentInfo.permission);
    return allowed;
}
```

#### Codex — Trait 分发

```rust
// codex-rs/tools/src/tool_registry_plan.rs
pub struct ToolRegistry {
    handlers: HashMap<String, Arc<dyn ToolHandler>>,
}

pub trait ToolHandler {
    async fn handle(&self, params: ToolCallParams) -> ToolResult;
    fn is_mutating(&self) -> bool;
    fn kind(&self) -> ToolKind;
}
```

Codex 使用 Rust trait 系统，每个工具实现 `ToolHandler` trait。注册到 `ToolRegistry` 的 HashMap 中，通过名字查找并调用 `handle()`。

#### Kimi CLI — 动态导入

```python
# src/kimi_cli/soul/toolset.py
tool_path = "kimi_cli.tools.file:ReadFile"
module_name, class_name = tool_path.rsplit(":", 1)
module = importlib.import_module(module_name)
tool_cls = getattr(module, class_name)
tool_instance = tool_cls(runtime)
toolset.add(tool_instance)
```

Kimi CLI 使用 Python 的动态导入特性，通过 `"module:Class"` 格式的字符串延迟加载工具。

### 3.3 工具权限系统

#### Claude Code — 权限矩阵

```typescript
type ToolPermissionContext = {
    mode: PermissionMode;               // "default" | "plan" | "bypass"
    alwaysAllowRules: ToolPermissionRulesBySource;  // 总是允许
    alwaysDenyRules: ToolPermissionRulesBySource;   // 总是拒绝
    alwaysAskRules: ToolPermissionRulesBySource;    // 总是询问
    strippedDangerousRules?: ToolPermissionRulesBySource;
}
```

权限检查流程：
```
工具调用请求
    ↓
检查 alwaysDenyRules → 立即拒绝
    ↓
检查 alwaysAllowRules → 立即通过
    ↓
检查 alwaysAskRules → 弹出权限提示
    ↓
默认行为（根据 mode 决定）
```

#### OpenCode — 规则集

```typescript
// src/permission/next.ts
type Ruleset = {
    [toolName: string]: "allow" | "deny" | "ask" | { [pattern: string]: "allow" | "deny" | "ask" }
}

// 示例
{
    edit: {
        "*": "deny",                      // 默认拒绝所有编辑
        ".opencode/plans/*.md": "allow",   // 允许编辑计划文件
    },
    read: {
        "*.env": "ask",                    // 读取 .env 需要确认
    },
}
```

#### Kimi CLI — ToolPolicy

```python
@dataclass(frozen=True)
class ToolPolicy:
    mode: Literal["inherit", "allowlist"]
    tools: tuple[str, ...] = ()

# 使用示例
tool_policy = ToolPolicy(mode="allowlist", tools=["ReadFile", "Grep", "Shell"])
```

- `inherit`：继承父 Agent 的工具集
- `allowlist`：仅允许指定的工具列表

### 3.4 AgentTool 具体实现

#### Claude Code AgentTool 执行流程

```
1. 用户/Agent 调用 Agent 工具
    ↓
2. classifyHandoffIfNeeded()
    ├── 是否需要切换 Agent？
    └── 确定 Agent 类型 (内置 vs 用户定义)
    ↓
3. runAsyncAgentLifecycle()
    ├── registerAsyncAgent()      → 注册异步任务
    ├── classifyHandoffIfNeeded() → 确定 Agent 类型
    ├── getAgentModel()           → 选择模型（支持 override）
    └── buildEffectiveSystemPrompt()
    ↓
4. runAgent()
    ├── assembleToolPool()        → 构建该 Agent 专属工具池
    ├── queryEngine.execute()     → 执行 LLM 查询
    └── 更新进度 (updateAgentProgress)
    ↓
5. finalizeAgentTool()
    ├── 清理资源
    ├── 摘要化（如果输出过长）
    └── 返回结果
```

#### Codex Agent Tool 执行流程

```
1. agent_tool.rs 收到 spawn 请求
    ↓
2. AgentControl.spawn_agent()
    ├── reserve_spawn_slot()      → 检查配额限制
    ├── prepare_thread_spawn()    → 准备线程元数据
    │   ├── 创建 AgentPath
    │   ├── 分配昵称
    │   └── 应用 Role 配置
    ├── spawn_new_thread_with_source()
    │   ├── 创建新 CodexThread
    │   ├── 继承 Shell 快照
    │   └── 继承 Exec 策略
    └── send_input(thread_id, initial_operation)
    ↓
3. 线程运行
    ├── ToolOrchestrator 分发工具调用
    ├── 工具结果 → 写入事件流
    └── 完成时发送事件
    ↓
4. 父 Agent 通过 Mailbox 接收结果
```

---

## 四、关键架构发现

### 1. Agent 即工具 vs Agent 即线程

- **Claude Code**：Agent 是一种特殊工具（`AgentTool extends Tool`），调用方不需要关心 Agent 的内部实现，只需要传入 `subagent_type` 和 `prompt`。这种设计非常优雅，Agent 可以像任何工具一样被并行调用、权限检查、结果回收。

- **Codex**：Agent 是独立的 Thread，有更重的隔离（独立的会话状态、Rollout 历史、Shell 快照）。这提供了更强的隔离性但代价是更复杂的生命周期管理。

### 2. 运行时动态 vs 编译时配置

- **Claude Code**：通过 `feature()` 函数 + 条件导入实现运行时工具开关，支持 A/B 测试和渐进式发布。
- **Codex**：通过 Rust 条件编译（`#[cfg(feature = "...")]`）在编译时决定工具可用性，性能更好但不够灵活。
- **Kimi CLI**：通过动态导入（`importlib`）实现工具热加载。

### 3. 通信机制的多样性

- **Claude Code**：通过 `TaskOutput` + `SendMessage` + 输出文件实现异步通信。
- **Codex**：通过 `Mailbox`（通道/消息队列）实现 Agent 间同步/异步通信。
- **Kimi CLI**：通过 `Wire` 文件（Unix Domain Socket / 命名管道）实现通信。
- **OpenCode**：通过共享 Session 状态 + 工具结果直接返回。

### 4. 隔离与灵活性的权衡

| 隔离级别 | 代表 | 优点 | 缺点 |
|---------|------|------|------|
| 完全隔离（独立 Thread） | Codex | 状态安全、互不干扰 | 开销大、通信复杂 |
| Worktree 隔离 | Claude Code | 文件系统安全 | 仅限 git 项目 |
| 工具池隔离 | Kimi CLI | 轻量、简单 | 共享会话状态 |
| 仅权限隔离 | OpenCode | 最轻量 | 无真正隔离 |

### 5. 摘要延续机制（跨工具设计模式）

Kim CLI 的 `run_with_summary_continuation` 和 Claude Code 的 `startAgentSummarization` 都实现了一种通用的设计模式：**当子 Agent 输出过短时，自动追加 continuation prompt 要求扩展**。这是一个处理 LLM "偷懒" 问题的通用方案。

---

## 五、总结

| 系统 | 多 Agent 能力 | 架构复杂度 | 隔离性 | 适合场景 |
|------|-------------|-----------|--------|---------|
| **Claude Code** | ★★★★★ 最全 | 极高 | 高(Worktree/Remote) | 复杂多任务、团队协作 |
| **Codex** | ★★★★☆ | 高 | 最高(Thread级) | 工程级多任务处理 |
| **Kimi CLI** | ★★★☆☆ | 中 | 中(工具池/Context) | 探索+编码双模式 |
| **OpenCode** | ★★☆☆☆ | 低 | 低(权限级) | 轻量级并行工具调用 |
| **Pi-mono** | ★★★★☆ | 中高 | 中(Session Fork) | TypeScript 扩展生态、自定义 Agent 类型 |

**核心设计哲学**：

- **Claude Code** 追求全面——Agent 即工具、Swarms 团队、异步执行、摘要化、隔离工作树
- **Codex** 追求工程严谨——Thread 级隔离、Fork 模式、Mailbox 通信、深度/配额限制
- **Kimi CLI** 追求实用——Foreground/Background 双模式、Wire 通信、摘要延续
- **OpenCode** 追求极简——Agent 即配置、权限隔离、工具并发代替多 Agent
- **Pi-mono** 追求无限扩展——TypeScript Extension 系统、25+ 事件拦截、注册即生效的自由工具扩展

多 Agent 系统的设计没有标准答案，只有对**复杂度、隔离性、灵活性**的不同权衡。

---

> 📝 **关于本文**：基于对 [Codex](https://github.com/openai/codex)、[Claude Code](https://github.com/anthropics/claude-code)、[OpenCode](https://github.com/sst/opencode)、[Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) 和 [Pi-mono](https://github.com/pi-corp/pi-mono) 的源码分析撰写。源码版本截至 2026 年 4 月。
