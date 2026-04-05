---
title: "五大编程 AI 工具的 Context Compaction 设计深度对比"
date: 2026-04-05
category: "ai say i do"
tags:
  - AI 编程工具
  - 上下文压缩
  - Context Compaction
  - Claude Code
  - Codex
  - OpenCode
  - Kimi CLI
  - Pi-mono
description: "从五层架构到三层渐进，从电路熔断到增量摘要，深度对比 Claude Code、Codex、OpenCode、Pi-mono 和 Kimi Code CLI 的上下文压缩系统设计哲学与工程实现。"
---

## 引言

当一个 AI 编程助手的对话越来越长，上下文窗口（Context Window）总会触及上限。此时，**如何优雅地压缩历史对话，同时保留关键信息**，成为一个决定工具"能否长时间工作"的核心能力。

Context Compaction（上下文压缩）不是简单的截断——它需要回答几个关键问题：什么时候压缩？压缩什么？保留什么？压缩后如何恢复上下文？如果压缩失败了怎么办？

本文基于对 [Claude Code](https://github.com/anthropics/claude-code)、[Codex](https://github.com/openai/codex)、[OpenCode](https://github.com/sst/opencode)、[Pi-mono](https://github.com/pi-corp/pi-mono) 和 [Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) 的源码分析，给出客观的 compaction 架构对比与技术细节。

## 一、总览对比表

| 能力 | Claude Code | Codex | OpenCode | Pi-mono | Kimi Code CLI |
|------|-------------|-------|----------|---------|---------------|
| **压缩层数** | 5 层 | 2 路径 | 2 层 | 1 层+增量 | 1 层 |
| **触发方式** | Token 阈值+时间+响应式 | Token 阈值+手动 | Token 溢出检测 | Token 阈值+手动+Overflow | 固定 50K 缓冲 |
| **压缩方式** | AI 摘要+微压缩 | 远程/本地 AI 摘要 | AI 摘要+剪枝 | 增量摘要合并 | AI 摘要 |
| **电路熔断** | ✔ (3 次失败停止) | ✘ | ✔ (3 次失败) | ✘ (仅重试 1 次) | ✘ (重试 3 次) |
| **缓存感知** | ✔ (Prompt Cache TTL) | ✔ (Prefix Caching) | ✔ (Cache Token 统计) | ✘ | ✘ |
| **压缩后恢复** | ✔ (文件+Skill+MCP+Plan) | ✔ (Ghost Snapshot) | ✔ (Synthetic Continue) | ✔ (Branch Summary) | ✘ |
| **增量摘要** | ✔ (Session Memory) | ✘ | ✘ | ✔ (Update Prompt) | ✘ |
| **专用压缩 Agent** | ✘ (forked agent) | ✘ | ✔ (无工具权限) | ✘ | ✘ |
| **可审计性** | ✘ | ✘ | ✔ (prune 标记) | ✔ (JSONL + 扩展) | ✔ (JSONL 检查点) |
| **实现语言** | TypeScript | Rust | TypeScript | TypeScript | Python |

下面逐一拆解各项设计的技术实现差异。

---

## 二、触发机制：何时该压缩？

### Claude Code：时间感知的多层触发

最复杂也最精细的触发体系，包含四层：

```
Layer 1: Micro-Compact（时间触发）
  → 60+ 分钟无助手响应时，清除旧工具结果
  → 理由：60 分钟后 Prompt Cache 必定过期，提前清除减少重写成本

Layer 2: Auto-Compact（Token 阈值触发）
  → context_window - 20k_输出 - 13k_缓冲 = 触发线
  → 200K 窗口 ≈ 167K 触发

Layer 3: Reactive Compact（响应式触发）
  → API 返回 prompt_too_long 时兜底

Layer 4: Session Memory（知识库提取）
  → 持久化跨会话的"常青"知识
```

```typescript
// 电路熔断：连续失败计数
if (consecutiveFailures >= 3) {
  // 停止自动压缩 — BQ 数据显示 1,279 个会话浪费在 50+ 次失败上
  return CircuitBroken
}
```

### Codex：Mid-turn 创新

独创 **Mid-turn Compaction**——在模型处理中间触发压缩，而非回合结束后：

```
[已压缩历史] → [初始上下文注入] → [最后一条用户消息] → 继续处理
```

模型被训练识别压缩摘要作为上下文标记，可以**无缝接续**。

### OpenCode：溢出检测

```typescript
// 每次 LLM 响应后检查
usable_tokens = model.limit.input - reserved_buffer
overflow = used_tokens >= usable_tokens
// 超过 → 创建压缩任务
```

### Pi-mono：双重触发

- **Auto-Threshold**：`contextTokens > contextWindow - 16384`
- **Overflow Recovery**：捕获 LLM 的 "context overflow" 错误，自动重试 1 次

### Kimi Code CLI：简单粗暴的 50K 缓冲

```python
# 最直观的设计
if self._context.token_count + 50_000 >= self._runtime.llm.max_context_size:
    await self.compact_context()
```

50K 保留空间 = 约 40K 英文单词。不复杂估算，够用就行。

### 小结

| 项目 | 触发逻辑 | 优点 | 缺点 |
|------|---------|------|------|
| Claude Code | 四层触发 | 覆盖面广，冗余设计 | 复杂度高 |
| Codex | Mid-turn + 手动 | 用户体验流畅 | 需要模型训练 |
| OpenCode | 溢出检测 | 简单直接 | 只能被动触发 |
| Pi-mono | Token 阈值 + Overflow | 双重保障 | 1 次重试可能不够 |
| Kimi Code CLI | 50K 缓冲 | 简单可靠 | 不够精细 |

---

## 三、压缩策略：怎么压缩？

### Claude Code：五层架构详解

Claude Code 的压缩不是一个操作，而是一套体系：

| 层 | 名称 | 是否调用 API | 核心逻辑 |
|---|------|------------|---------|
| 1 | **Micro-compact** | ❌ | 60+ 分钟无响应 → 清除旧工具结果（保留最近 5 个） |
| 2 | **Standard Compact** | ✅ | AI 生成结构化摘要，替换历史消息 |
| 3 | **Session Memory** | ✅ | 提取跨会话持久化知识 |
| 4 | **Reactive Compact** | ✅ | API 报错后的兜底压缩 |
| 5 | **API-side Compact** | ✅ | 服务端上下文编辑 |

**Micro-compact** 是 Claude Code 独有的创新：
```typescript
// 白名单内的工具结果可以被微压缩
// Shell/Grep/Glob/FileRead/FileEdit/WebFetch/WebSearch/NotebookEdit
// 只保留最近 5 个，其余清除
```

这样做是因为**时间微压缩在缓存过期前发生**——服务器端的 Prompt Cache 在 60 分钟后必然失效，所以提前清除比等到下次缓存未命中再清除更节省重写成本。

### Codex：远程 vs 本地双路径

```rust
fn should_use_remote_compact_task(provider: &ModelProviderInfo) -> bool {
    provider.is_openai()
}
```

- **远程压缩**：OpenAI 模型调用 `compact_conversation_history()` API
- **本地压缩**：非 OpenAI 提供商使用本地 prompt 生成摘要

Codex 还实现了 **Incremental Trimming**——当压缩本身也超出窗口时，从最旧的消息逐个移除，而不是直接丢掉一半：

```rust
loop {
    match attempt_result {
        Err(ContextWindowExceeded) => {
            if turn_input_len > 1 {
                history.remove_first_item();  // 逐个移除
                continue;
            }
            return Err(e);
        }
    }
}
```

### OpenCode：Prune → Process 两层流

```
溢出检测 → PRUNE（标记旧工具输出） → PROCESS（AI 摘要） → Synthetic Continue
```

**Prune 层**是轻量级本地操作：
```typescript
// 从后向前遍历，累积 40K token 的旧工具输出
// 标记为 compacted（时间戳）
// 渲染时显示 "[Old tool result content cleared]"
// 至少需要 20K 的修剪量才执行
```

**Process 层**使用专用无工具 Agent（所有 tool 权限为 deny）执行摘要，防止递归调用和文件修改。

### Pi-mono：增量摘要的独特性

Pi-mono 最独特的设计是 **Update Prompt 模式**：

```
首次压缩: SUMMARIZATION_PROMPT（完整摘要格式）
后续压缩: UPDATE_SUMMARIZATION_PROMPT（旧摘要 + 新内容 → 合并摘要）
```

```prompt
PRESERVE all existing information from the previous summary
ADD new progress, decisions, and context from the new messages
UPDATE the Progress section: move items from "In Progress" to "Done"
```

这意味着压缩历史**不会丢失上下文**——决策、进度、文件操作记录会逐层累积。

**文件操作跟踪**也是亮点：
```xml
<read-files>
path/to/file1.ts
path/to/file2.md
</read-files>
<modified-files>
src/core/modified.ts
</modified-files>
```

### Kimi Code CLI：优先级排序的摘要

压缩 prompt 中定义了 **6 级优先级**：

```
1. Current Task State    — 当前正在做什么
2. Errors & Solutions    — 遇到的错误及解决方案
3. Code Evolution        — 最终可工作版本（去掉中间尝试）
4. System Context        — 项目结构、依赖、环境
5. Design Decisions      — 架构选择及理由
6. TODO Items            — 未完成的任务
```

输出格式要求结构化 XML：
```xml
<current_focus>[当前工作]</current_focus>
<environment>[关键配置]</environment>
<completed_tasks>[任务]: [结果]</completed_tasks>
<active_issues>[问题]: [状态]</active_issues>
<code_state>...</code_state>
<important_context>[补充信息]</important_context>
```

### 小结

| 项目 | 压缩策略 | 核心特色 |
|------|---------|---------|
| Claude Code | 五层体系 | 时间微压缩+API 兜底 |
| Codex | 远程/本地 | Mid-turn 注入 |
| OpenCode | Prune + Process | 两层渐进 |
| Pi-mono | 增量摘要合并 | Update Prompt |
| Kimi Code CLI | 优先级摘要 | 6 级内容排序 |

---

## 更深层的技术细节

刚才的概览只触及了表面。这一节把每个工具在源码中更隐蔽的工程实现拿出来看。

### Claude Code：多层阈值 + 缓存共享 + 9 章摘要

**多层缓冲阈值**是 Claude Code 触发体系里最容易被人忽略的一点。它不是"到线了就压"，而是像汽车油表一样分层报警：

```
上下文窗口上限 (200,000 tokens)
        ↓ 减去预留输出令牌 (20,000)
有效上下文窗口 (≈180K)
        ↓ 减去自动压缩缓冲 (13,000)
自动压缩阈值 (≈71.5%)
        ↓ 继续留余地：手动压缩缓冲 3,000、警告 20,000、错误 20,000
```

13,000 这个数不是拍脑袋的：p99.99 的压缩摘要输出是 17,387 tokens，取 13K 作缓冲，再靠 20K 给输出预留，让压缩请求本身不撞墙。

**缓存共享（Forked Agent）**更值得关注。生成摘要时，Claude Code 不是起一个全新的请求，而是启动一个 Forked Agent，让它**复用主对话线程的 Prompt Cache key**。

```
主对话线程                          Forked Agent 线程
    ↓                                    ↓
[系统提示]                    共享缓存   [系统提示]
[工具定义]  ←─────使用同一份────→ [工具定义]
[消息前缀]  ←─────cache_key────────→ [消息前缀]
```

数据验证：
- 禁用此机制 → 98% cache miss rate
- 启用此机制 → 98% cache hit rate
- 节省 **~38B tokens/day** 的 cache_creation

约束也很严格：Forked Agent **不能设置 `maxOutputTokens`**，否则 `budget_tokens` 计算改变，cache key 不匹配。

**9 章摘要结构**来自 `prompt.ts` 里的 BASE_COMPACT_PROMPT：

1. **Primary Request** — 用户意图（高层理解）
2. **Key Technical Concepts** — 技术框架与模式（概念映射）
3. **Files and Code Sections** — 文件与代码片段（具体细节）
4. **Errors and fixes** — 错误及修复（问题追踪）
5. **Problem Solving** — 解决过程（方法论）
6. **All user messages** — 全部用户消息（反馈源，按时间）
7. **Pending Tasks** — 待办任务（未来方向）
8. **Current Work** — 当前工作状态（即时状态）
9. **Optional Next Step** — 下一步建议（行动指引）

要求模型先输出 `<analysis>` 再输出 `<summary>`，相当于**先打草稿后誊写**，最终上下文中只保留 summary 块。

**按 API 轮次分组**而非用户轮次，是一个关键洞察：Agentic 场景下一个用户指令可能触发几十步工具调用，如果按用户轮次分，整个对话就是一个不可分割单元，无法部分压缩；按 API 轮次分，则可以在保留早期对话的同时压缩最近的对话。

### Codex：Mid-turn 的模型训练需求

前面提到 Codex 的 Mid-turn 压缩很创新，但实现它有一个隐性条件：**模型必须被训练过识别压缩摘要作为上下文标记**。

这意味着 Mid-turn 不是任何一个客户端代码拿来就能用的功能——它要求服务端模型理解"这段是摘要，不是用户消息"。

### OpenCode：专用无工具 Agent 的权限设计

```typescript
compaction: {
  name: "compaction",
  permission: { "*": "deny" }
}
```

这个看似简单的一行配置，背后解决了一个大问题：如果压缩 Agent 也能调用工具，它可能在压缩过程中修改文件、执行命令，产生不可追踪的副作用。用 deny 全部工具，**干净的审计线索**自然形成。

### Kimi Code CLI：6 级优先级的取舍

Kimi 的压缩 prompt 中定义了 6 级优先级，从"当前正在做什么"到"未完成的任务"，每一级在压缩时都有明确的取舍。这其实是一种**人工设计的保真度优先级**——当模型自己判断不了什么是重要的时候，规则说了算。

---

## 四、压缩恢复：摘要之后怎么办？

压缩不只是生成摘要就结束了——压缩后**如何让 Agent 恢复工作状态**，才是决定用户体验的关键。

### Claude Code：最全面的后压缩恢复

Claude Code 设计了完整的 **Post-Compact Attachment Recovery** 流程：

| 恢复项 | 说明 | Token 预算 |
|-------|------|-----------|
| 最近 5 个文件 | 保留最近操作的文件内容 | 5,000/file |
| Tools 声明 | 重新注入完整工具集 | — |
| MCP 配置 | Agent 重新知道可用 MCP 服务器 | — |
| Agent 列表 | 可用子代理列表变化 | — |
| 已调用 Skill | 完整内容保留（~18-20KB） | 25,000 总预算 |
| 计划模式 | 活跃时重新注入 | — |
| Session Start Hooks | 自定义初始化逻辑 | — |

**Pre/Post Compact Hooks** 允许第三方扩展在压缩前后注入自定义逻辑。

### Codex：Ghost Snapshot 保证 /undo 可用

关键创新——在压缩前**提取所有 Ghost Snapshot 并追加到压缩后历史的末尾**：

```rust
let ghost_snapshots: Vec<ResponseItem> = history
    .raw_items()
    .iter()
    .filter(|item| matches!(item, ResponseItem::GhostSnapshot { .. }))
    .cloned()
    .collect();

if !ghost_snapshots.is_empty() {
    new_history.extend(ghost_snapshots);
}
```

这意味着用户即使在压缩后执行 `/undo`，**Git 快照状态依然可用**，文件修改可以回退。

### OpenCode：Synthetic Continue 消息

压缩完成后自动生成一条合成用户消息：
```
"Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
```

防止 Agent 在压缩后停滞或悬空。

### Pi-mono：Branch Summary 导航

Pi-mono 的树状会话结构支持 `/tree` 导航：
- 切换到任意分支节点
- 自动生成分支摘要
- 从共同祖先重建上下文
- **Extension hook：`session_before_compact`** 允许插件自定义压缩逻辑

### Kimi Code CLI：JSONL 检查点

```jsonl
{"role":"user","content":[...]}
{"role":"assistant","content":[...]}
{"role":"_checkpoint","id":0}
{"role":"_usage","token_count":1534}
{"role":"_checkpoint","id":1}
```

每条消息一行 JSON，checkpoint 标记状态快照。支持 `revert_to(checkpoint_id)` 回滚到任意历史点。

---

## 五、关键架构创新

### 1. 电路熔断（Circuit Breaker）

**Claude Code** 和 **OpenCode** 都实现了电路熔断：

```typescript
// Claude Code
if (consecutiveFailures >= 3) return CircuitBroken

// OpenCode
if (compactionFails >= 3) break mainLoop
```

**动机**：BQ 数据显示大量会话在 50+ 次压缩失败上浪费了数百万 token。熔断后转由手动 `/compact` 接管。

### 2. Foreach 缓存共享（Cache-Sharing Fork）

Claude Code 的 **Forked Summarizer Agent** 复用父会话的 Prompt Cache key：
- 节省 **~38B tokens/day**
- 要求：字节级精确的系统提示词+工具+模型匹配
- 风险：如果 placeholder 长度不匹配，100% 缓存未命中

### 3. OpenCode 的专用无工具 Agent

```typescript
compaction: {
  name: "compaction",
  permission: { "*": "deny" }  // ALL tools disabled
}
```

所有工具权限 deny，确保压缩过程中不会有任何副作用——不会修改文件、不会执行命令。干净的审计线索。

### 4. Pi-mono 的 Extension Hooks

```typescript
session_before_compact: (preparation, entries) => {
  // 插件可以：
  // - 提供自定义摘要
  // - 取消压缩
  // - 访问完整分支数据
}

session_compact: (compactionEntry) => {
  // 压缩完成后的清理/通知
}
```

### 5. Kimi Code CLI 的 JSONL 透明度

每一行一个 JSON 对象，可以直接用 `tail`、`grep` 查看会话内容。调试友好——这是工程实践中不可忽视的细节。

---

## 六、架构设计对比

### 注册与调度

**Claude Code** 使用统一的 `Compact` 接口 + 条件加载策略，多种压缩策略可以根据特性开关动态组合。

**Codex** 使用 Rust 的 `Task` trait + `ContextManager`，远程/本地压缩通过 `model_client` 抽象层分发。

**OpenCode** 通过 `SessionCompaction.create()` → `SessionCompaction.process()` 的任务模式，Session 主循环检测并处理。

**Kimi Code CLI** 在 `KimiSoul._agent_loop()` 中直接检查 Token 计数并调用 `compact_context()`。

### 权限与安全

压缩本身就是一个**危险操作**——它丢弃历史消息。如何防止信息丢失？

| 项目 | 安全机制 |
|------|---------|
| Claude Code | 电路熔断 + 多层兜底 + Post-compact 恢复 |
| Codex | Ghost Snapshot + Incremental trimming + 前置校验 |
| OpenCode | 无工具 Agent + prune 标记 + 合成继续消息 |
| Pi-mono | 1 次重试 + 分支导航 + 扩展钩子 |
| Kimi Code CLI | 50K 缓冲 + 3 次重试 + JSONL 检查点回滚 |

---

## 七、值得借鉴的实践

### 向 Claude Code 学习

1. **时间微压缩（Time-based Micro-compaction）**：在缓存过期前主动清理，避免重写成本
2. **多层冗余设计**：4-5 种压缩策略互相兜底，单一策略失败不影响整体
3. **Post-compact 全套恢复**：文件+Skill+MCP+Plan+Hooks，压缩后 Agent 能立即接续工作

### 向 Codex 学习

1. **Mid-turn 压缩**：在模型处理中间压缩，用户体验更流畅
2. **Ghost Snapshot**：保证压缩后 `/undo` 仍然可用
3. **Prefix Caching**：从前端逐个修剪而不是一次性丢掉一半

### 向 OpenCode 学习

1. **Prune + Process 两层流**：轻量级本地剪枝 + AI 摘要，性价比最优
2. **无工具专用 Agent**：压缩 Agent 没有任何工具权限，干净安全
3. **Prune 标记审计**：`part.state.time.compacted = Date.now()` 可追溯

### 向 Pi-mono 学习

1. **增量摘要合并**：Update Prompt 模式保证压缩历史不丢失信息
2. **文件操作跟踪**：自动记录读写文件到摘要中
3. **树状会话导航**：`/tree + Branch Summary` 探索不同对话路径

### 向 Kimi Code CLI 学习

1. **50K 保留缓冲**：简单直接，不需要复杂估算
2. **优先级摘要**：6 级内容排序确保重要信息优先保留
3. **JSONL 检查点**：透明存储格式，`tail` 即可查看，支持精确回滚

---

## 八、总结

从压缩架构的深度对比来看：

**工业级最全面**：Claude Code — 5 层架构、电路熔断、时间微压缩、缓存共享、全套恢复机制，几乎覆盖了所有边缘情况。代价是复杂度极高。

**最具创新性**：Codex — Mid-turn 压缩、Ghost Snapshot、Incremental trimming，设计精巧且用户体验好。

**最务实**：OpenCode — Prune + Process 两层流、无工具专用 Agent、合成继续消息，用最小的复杂度解决了核心问题。

**最注重上下文连续**：Pi-mono — 增量摘要合并让压缩历史不会丢失信息，文件操作跟踪和树状导航提供了独特的会话探索能力。

**最简洁有效**：Kimi Code CLI — 50K 保留缓冲 + 优先级排序 + JSONL 检查点，没有花哨设计但工程上可靠。

Context Compaction 的设计反映了一个根本性的工程取舍：**信息保真 vs Token 效率**。保真度高意味着压缩率有限，效率高意味着信息丢失。没有完美的方案，只有在不同维度上的权衡。

如果你正在设计自己的 AI Agent 框架，建议：
- 从 **Kimi 的 50K 缓冲**起步（简单可靠）
- 加入 **OpenCode 的 Prune 层**（本地快速释放空间）
- 用 **Codex 的 Ghost Snapshot**（保证可回退）
- 在会话很长时考虑 **Pi-mono 的增量摘要**（不丢失历史决策）
- 如果有缓存成本压力，学习 **Claude Code 的时间微压缩**（TTL 感知清理）

---

| 特性 | Codex | Kimi CLI | OpenCode | pi-mono | Claude Code |
|------|-------|----------|----------|---------|-------------|
| **Prompt 模板格式** | Markdown 简短指令 | Markdown 结构化 + XML 标签 | 纯文本模板 | 代码内字符串常量 | 代码内字符串常量 |
| **NO_TOOLS 约束** | 无显式（靠工具集为空） | 无显式（EmptyToolset） | 无显式 | System prompt "Do NOT continue" | **全大写前缀+后缀** 双重强制 |
| **Analysis 自检** | ❌ | ❌ | ❌ | ❌ | ✅ `<analysis>` 块 |
| **内容优先级** | 简单列表（4项） | ✅ **6级优先级** | 关注点列表（6项） | ✅ **7段结构模板** | ✅ **9段结构模板** |
| **增量重压缩** | ✅ summary_prefix | ❌ | ❌ | ✅ `UPDATE_SUMMARIZATION_PROMPT` | ✅ partial compact |
| **文件追踪** | ❌ | ❌ | ❌（模板中提及） | ✅ **累积文件操作追踪** | ✅ 通过工具调用 |
| **Split Turn** | ❌ | ❌ | ❌ | ✅ 并行双摘要合并 | ✅ partial direction: up_to / from |
| **Token 估算** | 内置 `approx_token_count` | 不估算 | 内置 | chars/4 启发式 | roughTokenCountEstimation |
| **裁剪/Pruning** | 从最旧消息逐条裁剪 | 不裁剪 | ✅ tool call 输出裁剪 | 在 cut point 整段裁剪 | microcompact（工具结果裁剪） |
| **熔断机制** | 重试+裁剪 | ❌ | ❌ | ❌ | ✅ 3次连续失败熔断 |
| **插件扩展** | ❌ | ❌ | ✅ `experimental.session.compacting` | ✅ prepareCompaction 分离 | ✅ Pre/Post Compact hooks |
| **用户消息原文保留** | ✅ 不超过 20K token 的保留 | 最后 max_preserved 条 | ❌ | 不保留原始消息 | ✅ compact boundary message |

> 📝 **关于本文**：基于对 [Claude Code](https://github.com/anthropics/claude-code)、[Codex](https://github.com/openai/codex)、[OpenCode](https://github.com/sst/opencode)、[Pi-mono](https://github.com/pi-corp/pi-mono) 和 [Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) 的源码分析撰写。源码版本截至 2026 年 4 月。
