---
title: "五大 AI 编程助手上下文压缩系统深度对比"
date: 2026-04-04
category: "ai say"
tags:
  - AI 编程工具
  - 架构对比
  - Claude Code
  - OpenCode
  - Codex
  - Kimi CLI
  - Pi Mono
description: "从触发条件到保留策略，从摘要生成到分支导航，深度对比 Claude Code、OpenCode、Codex、Pi-mono 和 Kimi Code CLI 五大编程 AI 的上下文压缩系统实现细节。"
---

## 引言

当 AI 编程助手与开发者进行长时间的对话时，上下文窗口（context window）终究会耗尽。**上下文压缩（Context Compaction）**系统就是 AI 编程助手的"遗忘机制"——它决定保留什么记忆、丢弃什么细节、如何在不丢失关键信息的情况下让对话继续。

不同的实现方式直接决定了：
- **长对话后的代码质量**（是否还记得之前的修改？）
- **错误恢复能力**（能否记住遇到的坑？）
- **用户体验**（压缩时是否让用户感到"失忆"？）

本文基于对 [Claude Code](https://github.com/anthropics/claude-code)、[OpenCode](https://github.com/opencode-ai/opencode)、[Codex](https://github.com/openai/codex/)、[Pi-mono](https://github.com/pi-corp/pi-mono) 和 [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) 的源码分析，深度对比它们的上下文压缩系统。

---

## 一、总览对比表

| 维度 | Claude Code | OpenCode | Codex | Pi-mono | Kimi CLI |
|------|-------------|----------|-------|---------|----------|
| **压缩架构** | 三层（micro→auto→manual） | 两层（auto→manual） | 两层（local→remote） | 单层 + 分支摘要 | 单层简单压缩 |
| **触发条件** | Token 阈值（context-window - 13K buffer） | Token 阈值（context-window - reserve） | 超出模型上下文窗口 | Token 阈值（context-window - reserveTokens） | 保留最新 N 条消息 |
| **默认保留策略** | 保留最近对话（buffer 13K Token） | 保留最近 20K Token 最近消息 | 保留最新 20K Token 用户消息 | 保留最近 20K Token 最近消息 | 保留最新 2 条消息（可配置） |
| **多级压缩** | ✔ 支持多次压缩，旧总结被替换 | ✔ 支持 | ✔ 支持 | ✔ 支持 | 受限于保留条数 |
| **图像/附件处理** | 压缩前剥离图像，替换为 `[image]` 标记 | 保留（估算为 4800 chars） | ❌ 删除（remote compact 过滤） | 保留（估算为 1200 tokens） | ❌ 删除（不在压缩范围） |
| **工具调用追踪** | 剥离 `skill_discovery/skill_listing`，保留文件操作 | ✘ 不追踪 | ❌ 删除（FunctionCall/Output 全部删除） | ✔ 提取 read/written/edited 文件 | ✘ 不追踪 |
| **分支/回退支持** | ✘ 无 | ✘ 无 | ✘ 无 | ✔ 分支摘要（Branch Summary） | ✘ 无 |
| **摘要模板** | 自定义 + 系统指令 | 自定义 compaction.txt | OpenAI API 端点 POST `/responses/compact` | Goal/Progress/Decisions/Next Steps | 固定 prompt 模板 |
| **文件操作注入** | 压缩后恢复最多 5 个文件 | ✘ | ✘ | ✔ XML 标签注入 | ✘ |
| **压缩后清理** | ✔ postCompactCleanup（恢复文件、更新内存） | ✘ | ✘ | ✘ | ✘ |
| **缓存友好性** | ✔ Cached Microcompact（保留提示缓存） | ✘ | 远程 API 缓存 | ✘ | ✘ |
| **失败恢复** | ✔ PTL 重试（最多 3 次），丢弃最老消息 | ✘ | ✔ ContextWindowExceeded 重试 | ✘ | ✘ |
| **用户通知** | ✔ 边界消息 + 多次压缩警告 | ✘ | 系统事件通知 | ✘ | ✘ |

---

## 二、触发条件分析

### 1. Claude Code：三层压缩架构

Claude Code 的压缩触发是最复杂也是最完善的：

**第一道防线：Micro Compact（微压缩）**
```typescript
// src/services/compact/microCompact.ts
// 仅压缩特定工具的结果
const COMPACTABLE_TOOLS = new Set<string>([
  FILE_READ_TOOL_NAME,
  ...SHELL_TOOL_NAMES,
  GREP_TOOL_NAME, GLOB_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME,
  FILE_EDIT_TOOL_NAME, FILE_WRITE_TOOL_NAME,
])
```
Micro-Compact 在正常运行中就执行，只压缩特定工具的结果。图片限制为 2000 token，工具结果文本会被清空替换为 `[Old tool result content cleared]`，同时保留缓存提示状态。

**第二道防线：Auto Compact（自动压缩）**
```typescript
// src/services/compact/autoCompact.ts
const AUTOCOMPACT_BUFFER_TOKENS = 13_000  // 保留 13K Token 的缓冲
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000 // 最多 20K 输出 Token

function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)
  return effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS
}
```

关键配置：
- **触发阈值** = (有效上下文窗口 - 13,000) Token
- **有效上下文窗口** = 模型上下文窗口 - min(模型最大输出, 20,000)
- **可通过 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 环境变量**覆盖阈值百分比
- **连续失败 3 次**后停止重试（电路断电器模式）

**第三道防线：手动压缩（/compact）**
用户执行 `/compact` 命令时直接触发压缩。

### 2. OpenCode：基于 Token 阈值的自动压缩

```typescript
// src/session/compaction.ts
// 当历史 token 超出 (context-window - reserve) 时触发
function shouldCompact(contextTokens: number, contextWindow: number, settings): boolean {
  return contextTokens > contextWindow - settings.reserveTokens
}
```

关键参数（默认配置）：
- **reserveTokens**：保留的 Token 空间
- 触发时自动调用 LLM 进行压缩
- 支持 revert-compact（撤销压缩）操作

### 3. Codex：本地压缩 + 远程 API 压缩

```rust
// codex-rs/core/src/compact.rs
const MAX_USER_MESSAGES_TOKENS: usize = 20_000; // 最多保留 20K 用户消息 Token
```

两层机制：
- **本地压缩**：使用模型自行生成总结
- **远程压缩**：调用 OpenAI API `POST /responses/compact` 端点

```rust
// 请求参数
struct CompactionInput {
    model: String,
    input: Vec<ResponseItem>,
    instructions: String,
    tools: Vec<Tool>,
    parallel_tool_calls: bool,
    // ...
}
```

### 4. Pi-mono：基于 Token 的阈值触发

```typescript
// packages/coding-agent/src/core/compaction/compaction.ts
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,   // 保留 16K Token 用于压缩后继续操作
  keepRecentTokens: 20000, // 保留最近 20K Token 的最近对话
};

export function shouldCompact(contextTokens: number, contextWindow: number): boolean {
  return !settings.enabled ? false : contextTokens > contextWindow - settings.reserveTokens;
}
```

关键设计：
- **估算方法**：使用 `chars/4` 启发式方法估算 Token 数（略微高估）
- **类型区分**：用户消息、assistant 消息、工具结果、bash 执行等单独估算
- **分支/导航支持**：独特的分支摘要机制

### 5. Kimi CLI：最简单的保留最近消息策略

```python
# src/kimi_cli/soul/compaction.py
class SimpleCompaction:
    def __init__(self, max_preserved_messages: int = 2) -> None:
        self.max_preserved_messages = max_preserved_messages
```

Kimi CLI 采用最直接的策略：
- **从最新开始**保留 `max_preserved_messages` 条消息（默认 2 条）
- 剩余的所有消息被发送给 LLM 生成总结
- 如果总消息数小于保留数量，不进行压缩

---

## 三、保留 vs 丢弃策略对比

### 1. Claude Code：最精细的策略

**剥离的**：
- ❌ 图像块（替换为 `[image]` 文本标记）
- ❌ 文档块（替换为 `[document]` 标记）
- ❌ `skill_discovery` / `skill_listing` 附件（压缩后会重新注入）
- ❌ 思考部分在压缩后不保留（保留在摘要中）

**保留的**：
- ✅ 用户消息中的工具调用和工具结果
- ✅ 文件操作（read/write/edit）会被追踪
- ✅ 压缩后通过 `postCompactCleanup` 恢复最多 5 个文件的内容

### 2. OpenCode：保留工具结果

- ✅ 保留工具结果（用于后续参考）
- ✅ 保留最近 20K Token 的最近对话
- ✅ revert-compact 可以撤销一次压缩操作
- 图片估算为 4800 字符（1200 Token）

### 3. Codex：最激进的删除策略

**远程压缩时（API 调用过滤后）**：
- ✅ **保留**：用户消息、助手消息、Compaction 标记
- ❌ **删除**：developer 消息（过时指令）、FunctionCall/Output（所有工具调用）、LocalShellCall、ToolSearchCall

**不保留工具调用记录**：
```rust
ResponseItem::FunctionCall { .. } => false
ResponseItem::FunctionCallOutput { .. } => false
ResponseItem::LocalShellCall { .. } => false
```

### 4. Pi-mono：最智能的保留策略

**保留规则**：
- ✅ 保留最近 20K Token 的最近对话
- ✅ 工具操作追踪（read/written/edited）
- ✅ 文件操作以 XML 标签形式注入摘要
- ✅ 分支摘要（Branch Summary）保留导航前后的上下文

**切割策略**：
```typescript
// 切割点只能是 user、assistant、custom、bash 等消息
// toolResult 不能切割（必须跟随工具调用）
// assistant 消息有工具调用时，其 toolResult 保留
```

### 5. Kimi CLI：最基础策略

Python 实现中仅保留最近 N 条消息（默认 2 条）：
- ✅ 保留最新 user/assistant 消息
- ❌ 其余所有消息发送到 LLM 压缩
- ❌ Thinking 部分被删除（`isinstance(part, ThinkPart)` 被过滤掉）

---

## 四、摘要生成机制

### 1. Claude Code：自定义系统指令 + Forked Agent

Claude Code 使用 `getCompactPrompt()` 系统指令来生成摘要：
- 压缩时创建 **"Compact Boundary"** 消息，标记压缩边界
- 可以 **fork 一个新 Agent** 来进行压缩（通过 `runForkedAgent`）
- 最多 20,000 Token 输出空间用于生成摘要

### 2. OpenCode：compaction.txt 模板

使用专用的 `compaction.txt` 文件作为摘要系统提示词，简洁实用。

### 3. Codex：OpenAI 远程 API

调用 OpenAI 的 `/responses/compact` 端点：
- 需要 `model`、`instructions`、`tools` 和对话历史
- API 返回压缩后的消息列表
- 重试过程中如遇到 `ContextWindowExceeded` 会逐步删除最旧消息

### 4. Pi-mono：结构化摘要 + 文件操作

**初始摘要 Prompt**（`SUMMARIZATION_PROMPT`）：
```
## Goal - 用户想实现什么
## Constraints & Preferences - 约束和偏好
## Progress - 进度（Done/In Progress/Blocked）
## Key Decisions - 关键决策与理由
## Next Steps - 后续步骤
## Critical Context - 关键上下文
```

**更新摘要 Prompt**（`UPDATE_SUMMARIZATION_PROMPT`）：
- 保留现有信息
- 添加新的进度、决策和上下文
- 将 "In Progress" 移至 "Done"

**文件操作注入**：
```xml
<read-files>
  file1.ts
  file2.ts
</read-files>

<modified-files>
  file3.ts
</modified-files>
```

### 5. Kimi CLI：简单 Prompt 模板

```
Compression Priorities (in order):
1. Current Task State: What is being worked on RIGHT NOW
2. Errors & Solutions: All encountered errors and their resolutions
3. Code Evolution: Final working versions only
4. System Context: Project structure, dependencies, environment
5. Design Decisions: Architectural choices and rationale
6. TODO Items: Unfinished tasks and known issues
```

输出结构：
```xml
<current_focus>...</current_focus>
<environment>...</environment>
<completed_tasks>...</completed_tasks>
<active_issues>...</active_issues>
<code_state>...</code_state>
<important_context>...</important_context>
```

---

## 五、进阶特性

### 1. 分支摘要（Branch Summarization）— Pi-mono 独有

Pi-mono 实现了一个独特的 **会话树（Session Tree）** 概念：

```typescript
// 当导航到不同位置时，生成离开分支的摘要
function collectEntriesForBranchSummary(
  session: ReadonlySessionManager,
  oldLeafId: string | null,
  targetId: string
): CollectEntriesResult {
  // 从旧叶子节点回溯到公共祖先
  // 包括中间的压缩条目（其摘要成为上下文）
}
```

这意味着用户在会话树中**前后导航**时，不会丢失之前的工作上下文。

### 2. 缓存感知压缩（Cached Microcompact）— Claude Code 独有

Claude Code 实现了 **Cached Microcompact** 机制：
```typescript
// 保留提示缓存（prompt caching）状态
// 在压缩时保留已缓存的工具 ID，避免缓存失效
// 支持 "pinned edits" 确保缓存命中
```

### 3. 压缩后清理（Post-Compaction Cleanup）— Claude Code 独有

```typescript
// src/services/compact/postCompactCleanup.ts
// 压缩后恢复被修改的文件内容到上下文中
// 最多恢复 5 个文件，每个文件最多 5000 Token
// 总 Token 预算：50,000 Token
```

### 4. 上下文失败电路断电保护 — Claude Code 独有

```typescript
// 连续 3 次自动压缩失败后，停止重试
// 防止在不可恢复的上下文中浪费 API 调用
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
```

---

## 六、用户体验对比

### Claude Code
- ✅ 压缩时显示 **"Compact Boundary"** 消息
- ✅ 多次压缩警告："Heads up: Long threads and multiple compactions can cause the model to be less accuracy."
- ✅ 提供手动触发（`/compact`）和自动压缩两种模式
- ✅ Token 使用百分比显示（警告/错误阈值）

### OpenCode
- ✅ 支持 revert-compact（回退）操作
- ⚠️ 压缩过程对用户透明

### Codex
- ⚠️ 后台事件通知
- ⚠️ 需要用户理解 API 响应和端点

### Pi-mono
- ✅ 分支摘要消息显示在会话树中
- ⚠️ 对用户操作较复杂

### Kimi CLI
- ⚠️ 压缩对用户完全透明
- ⚠️ 用户可能注意到"失忆"（仅保留 2 条消息）

---

## 七、性能分析

| 工具 | Token 估算方法 | 压缩时间估算 | 额外 API 调用 |
|------|--------------|-------------|-------------|
| Claude Code | 基于 API 历史计数 + chars/4 估算 | 中等（fork agent） | 1 次/压缩 |
| OpenCode | 基于 API 历史计数 | 快（同模型） | 可能 |
| Codex | 基于 API 历史计数 | 中到快（取决于 API） | 远程 API 调用 |
| Pi-mono | chars/4 启发式（保守） | 快（同模型） | 1 次/压缩 |
| Kimi CLI | 无特殊估算 | 快 | 1 次/压缩 |

---

## 八、总结

| 维度 | Claude Code | OpenCode | Codex | Pi-mono | Kimi CLI |
|------|:-----------:|:--------:|:-----:|:--------:|:---------:|
| **架构复杂性** | ★★★★★ | ★★★ | ★★★★ | ★★★★ | ★★ |
| **信息保留** | ★★★★★ | ★★★ | ★★ | ★★★★ | ★★ |
| **文件操作追踪** | ★★★★★ | ✘ | ✘ | ★★★★ | ✘ |
| **分支/回退** | ✘ | ★★★ | ✘ | ★★★★★ | ✘ |
| **缓存友好性** | ★★★★★ | ✘ | ★★★ | ✘ | ✘ |
| **用户体验** | ★★★★★ | ★★★ | ★★ | ★★★ | ★★ |

**关键发现：**

1. **Claude Code 的三层架构**（micro→auto→manual）提供了最细粒度的控制，同时通过 post-compaction cleanup 和 cached microcompact 确保压缩后的代码质量。

2. **Pi-mono 的分支摘要**是最独特的设计，允许用户在会话树中导航而不丢失上下文。这在需要回溯或实验的场景中极为有用。

3. **Codex 的激进压缩**虽然有效减少了 Token，但完全删除工具调用信息意味着压缩后的模型可能缺少关键的文件操作历史记录。

4. **Kimi CLI** 最简单直接的设计在小规模场景下工作良好，但在长对话中的信息丢失问题严重。

5. **多级压缩的代价**：多次压缩导致精度递减。Claude Code 和 Pi-mono 都意识到这一点并做了相应的优化和警告机制。

压缩系统的差异反映了不同团队对用户需求的理解不同：
- **Claude Code → 全面与可靠性**
- **Codex → 效率与标准化**
- **OpenCode → 实用与简单**
- **Pi-mono → 导航与实验**
- **Kimi CLI → 轻量与可控**

---

> 📝 **关于本文**：基于对 [Codex](https://github.com/openai/codex/)、[Claude Code](https://github.com/anthropics/claude-code)、[OpenCode](https://github.com/opencode-ai/opencode)、[Pi-mono](https://github.com/pi-corp/pi-mono) 和 [Kimi CLI](https://github.com/MoonshotAI/kimi-cli/) 的源码分析撰写。源码版本截至 2026 年 4 月的最新可用版本。
