---
title: "Claude Code 的 Prompt Cache 优化：字节级一致性的艺术"
date: 2026-04-03
tags:
  - AI
  - 性能优化
  - Claude Code
  - Prompt Cache
description: "深入分析 Claude Code 如何通过 CacheSafeParams、Fork 消息构建和占位符策略，实现 Anthropic API Prompt Cache 的最大化命中。"
---

## 引言

想象一下这样的场景：你有一个 100 页的文档，每次只需要更新最后一页。如果每次都要重新打印整份文档，那将浪费大量时间和金钱。但如果你能只替换最后一页，前面的 99 页直接复用——这就是 **Prompt Cache** 的核心思想。

Anthropic 的 API 提供了 Prompt Cache 功能：当连续两次请求的前缀内容完全一致时，后面的请求可以直接复用前面请求的缓存，大幅降低延迟和成本。

Claude Code 将这一特性发挥到了极致。本文将从源码层面，剖析它是如何实现字节级缓存一致性的。

## 一、Prompt Cache 的工作原理

Anthropic API 的缓存 Key 由以下部分组成：

```
Cache Key = System Prompt + User Context + System Context + Tools + Messages Prefix + Thinking Config
```

只要这些组成部分**字节级一致**，API 就能命中缓存。听起来简单？在 Claude Code 这样复杂的多 Agent 系统中，要做到这一点需要精心的架构设计。

## 二、CacheSafeParams：显式封装缓存关键参数

Claude Code 最核心的设计是 `CacheSafeParams` 类型。它将所有影响缓存 Key 的参数**显式封装**在一起：

```typescript
// 影响 Prompt Cache 的所有参数，必须显式封装
export type CacheSafeParams = {
  systemPrompt: SystemPrompt           // 系统提示词
  userContext: { [k: string]: string } // 用户上下文（前置到消息）
  systemContext: { [k: string]: string } // 系统上下文（附加到系统提示词）
  toolUseContext: ToolUseContext       // 工具上下文（包含工具列表、模型等）
  forkContextMessages: Message[]       // 父对话历史消息
}
```

### 为什么需要显式封装？

在传统的编程模式中，这些参数往往散落在各个地方：系统提示词从一个函数获取，工具列表从全局状态读取，消息历史从某个管理器查询。这种隐式依赖在单 Agent 场景下没问题，但在多 Agent 派生时就成了灾难——你很难保证子 Agent 的参数与父 Agent 完全一致。

`CacheSafeParams` 的设计哲学是：**将影响缓存的参数从隐式变为显式契约**。当你要创建一个 Fork 子代理时，你必须传入完整的 `CacheSafeParams`，而不是让子代理自己去"猜"该用什么参数。

### 全局槽位：避免参数传递的样板代码

```typescript
// 全局槽位：每次主循环结束后保存 CacheSafeParams
let lastCacheSafeParams: CacheSafeParams | null = null

// 保存：主循环在 handleStopHooks 后写入
export function saveCacheSafeParams(params: CacheSafeParams | null): void {
  lastCacheSafeParams = params
}

// 读取：Fork 子代理可以直接获取，无需层层传递
export function getLastCacheSafeParams(): CacheSafeParams | null {
  return lastCacheSafeParams
}
```

这个设计非常巧妙：主循环在每次 turn 结束后，将当前的 `CacheSafeParams` 保存到一个全局槽位中。后续的 Fork 操作（如 promptSuggestion、postTurnSummary、/btw 命令）可以直接从这个槽位获取，而不需要每个调用者都手动传递参数。

## 三、Fork 消息构建：字节级一致性的实现

Fork 子代理的消息构建是整个缓存优化中最复杂的部分。它需要做到：**所有 Fork 子代理的 API 请求前缀必须字节级一致**。

### 策略一：完整继承父 Agent 的 Assistant Message

```typescript
// Fork 消息构建的核心策略
// 1. 保留完整的父 Agent assistant message（所有 tool_use 块、thinking 块、text 内容）
// 2. 所有 tool_result 使用统一的占位文本
// 3. Fork 指令作为新的 User Message 追加
```

这意味着 Fork 子代理的对话历史看起来是这样的：

```
[User] 帮我重构这个模块
[Assistant] 好的，我来分析一下... <tool_use id="read_1">FileRead</tool_use>
[Tool Result] Fork started — processing in background  ← 统一占位符
[Assistant] <tool_use id="grep_1">Grep</tool_use>
[Tool Result] Fork started — processing in background  ← 统一占位符
[Assistant] 我找到了需要修改的地方...
[User] Fork: 请继续完成剩余工作
```

### 策略二：统一占位符

所有 Fork 子代理的 `tool_result` 块使用完全相同的占位文本：

```typescript
// 必须完全一致，否则缓存失效
const FORK_PLACEHOLDER_RESULT = 'Fork started — processing in background'
```

这个字符串的选择也经过深思熟虑：
- **足够短**：减少 token 消耗
- **语义清晰**：Agent 看到后知道这是一个正在后台处理的任务
- **固定不变**：不随任何变量变化，保证字节级一致

### 策略三：防止递归 Fork

```typescript
// 检测对话历史中是否包含 Fork 标记，防止子代理再次 Fork
function isInForkChild(messages: MessageType[]): boolean {
  return messages.some(m => {
    if (m.type !== 'user') return false
    const content = m.message.content
    if (!Array.isArray(content)) return false
    return content.some(
      block => block.type === 'text' && 
               block.text.includes(`<${FORK_BOILERPLATE_TAG}>`)
    )
  })
}
```

Fork 子代理仍然拥有 Agent Tool（为了保证工具列表与父代理一致，从而命中缓存），但这意味着它理论上也可以再次 Fork。递归 Fork 会导致缓存前缀不一致，因此在调用时检测并拒绝。

## 四、Thinking Config 的缓存陷阱

一个容易被忽视的细节是 `maxOutputTokens` 对缓存的影响：

```typescript
/**
 * 可选的输出 token 上限。
 * 警告：设置此值会同时改变 max_tokens 和 budget_tokens（通过 claude.ts 中的钳位逻辑）。
 * 如果 Fork 使用 cacheSafeParams 共享父代理的 prompt cache，
 * 不同的 budget_tokens 会使缓存失效——thinking config 是缓存 Key 的一部分。
 * 仅在不需要缓存共享时才设置此值。
 */
maxOutputTokens?: number
```

这个注释揭示了一个微妙的陷阱：`maxOutputTokens` 不仅影响输出长度，还会通过钳位逻辑改变 `budget_tokens`（thinking 的预算）。而 thinking config 是缓存 Key 的一部分，所以即使其他所有参数都一致，只要 `budget_tokens` 不同，缓存就会失效。

## 五、上下文分析：知道该缓存什么

Claude Code 还实现了一个上下文分析工具，用于诊断哪些内容占用了最多的 token：

```typescript
type TokenStats = {
  toolRequests: Map<string, number>     // 每种工具调用的 token 数
  toolResults: Map<string, number>      // 每种工具结果的 token 数
  humanMessages: number                 // 用户消息的 token 数
  assistantMessages: number             // 助手消息的 token 数
  localCommandOutputs: number           // 本地命令输出的 token 数
  attachments: Map<string, number>      // 附件的 token 数
  duplicateFileReads: Map<string, {     // 重复文件读取
    count: number
    tokens: number
  }>
  total: number
}
```

特别值得注意的是 `duplicateFileReads`：它会统计同一个文件被重复读取的次数和浪费的 token 数。这为优化提供了数据支撑——如果发现某个文件被反复读取，可以考虑将读取结果缓存或注入到系统提示词中。

## 六、设计启示

### 1. 显式契约优于隐式状态

`CacheSafeParams` 将缓存关键参数从隐式的全局状态变成了显式的类型契约。这使得缓存一致性问题从"难以调试的隐式陷阱"变成了"编译器可以检查的显式约束"。

### 2. 全局槽位的合理使用

虽然全局变量通常被视为反模式，但在这里它解决了一个实际问题：避免在多个调用者之间传递相同的参数。关键在于这个槽位是**只写一次、只读使用**的，不会产生竞态条件。

### 3. 占位符的语义设计

统一的占位符 `"Fork started — processing in background"` 既满足了缓存一致性要求，又为 Agent 提供了清晰的语义信息。好的占位符应该同时满足技术约束和用户体验。

### 4. 防御性编程

防止递归 Fork 的检测、`maxOutputTokens` 的缓存警告——这些防御性设计确保了缓存优化不会因为边界情况而失效。

## 结语

Claude Code 的 Prompt Cache 优化展现了一种极致的工程追求：**在复杂的分布式系统中，通过显式契约和字节级一致性，将缓存命中率最大化。**

对于使用 Anthropic API 的开发者来说，这套架构提供了一个清晰的范式：将缓存关键参数显式封装、使用统一占位符、防止递归派生、注意 thinking config 的影响。每一个细节都可能成为缓存命中与失效的分水岭。

---

> **声明**：本文基于对 Claude Code 公开 npm 包（v2.1.88）的 source map 还原源码进行分析，仅供技术研究使用。源码版权归 [Anthropic](https://www.anthropic.com) 所有。
