---
title: "Claude Code 的 API 级微压缩：context_edit 深度解析"
date: 2026-04-03T14:00:00Z
category: "claude code"
tags: ["agent", "claude code", "上下文管理", "API 特性", "源码分析"]
---

# {{ $frontmatter.title }}

在之前的文章中，我们分析了 Claude Code 的客户端微压缩（microCompact.ts）。但你可能不知道，Claude API 本身也提供了一套原生的上下文管理机制——**context_edit**。这就是 `apiMicrocompact.ts` 模块的核心。

## 客户端 vs API 级：两种不同的压缩哲学

| 维度 | 客户端 microCompact | API 级 apiMicrocompact |
|------|-------------------|----------------------|
| **执行位置** | 客户端 | Claude API 服务端 |
| **操作粒度** | 删除整个消息 | 删除消息内的特定文本块 |
| **缓存影响** | 消息替换导致缓存失效 | cache_edits 保留 prompt cache |
| **控制权** | 客户端实现完整逻辑 | 服务端维护，客户端只需发送策略 |
| **精确性** | 粗粒度 | 精细化控制 |

**通俗理解**：
- 客户端微压缩：像整理房间时直接把整个抽屉扔掉
- API 级微压缩：像只清理抽屉里不需要的东西，保留有用的

## 核心数据结构：ContextEditStrategy

API 支持两种上下文编辑策略，通过联合类型定义：

```typescript
export type ContextEditStrategy =
  | {
      type: 'clear_tool_uses_20250919'  // 工具使用清除
      trigger?: { type: 'input_tokens', value: number }
      keep?: { type: 'tool_uses', value: number }
      clear_tool_inputs?: boolean | string[]
      exclude_tools?: string[]
      clear_at_least?: { type: 'input_tokens', value: number }
    }
  | {
      type: 'clear_thinking_20251015'   // 思考块清除
      keep: { type: 'thinking_turns'; value: number } | 'all'
    }
```

**版本号含义**：`20250919` 和 `20251015` 分别代表 2025-09-19 和 2025-10-15 发布的 API Beta 特性版本。

## 策略 1：clear_tool_uses_20250919（工具使用清除）

这个策略用于清除对话历史中的工具使用记录。

### 工具分类设计

系统将工具分为两类，采用不同的清除策略：

| 分类 | 工具 | 特点 | 清除策略 |
|------|------|------|--------|
| **CLEARABLE_RESULTS** | Shell、Grep、文件读取、网页获取等 | 读操作，结果多且重复 | 清除输出内容 |
| **CLEARABLE_USES** | 文件编辑、写入、笔记本编辑 | 写操作，记录重要 | 保留使用事实，排除清除 |

**为什么这样分类？**

```
读操作工具（grep、文件读等）：
├─ 输出内容通常很大（几十 KB）
├─ 结果往往是重复的（多次读取同一文件）
├─ 后续对话中模型已经"消费"了这些信息
└─ 清除后影响小

写操作工具（文件编辑、写入）：
├─ 记录了代码变更历史
├─ 对理解项目演进很重要
├─ 清除会导致模型不知道改了什么
└─ 必须保留
```

### 策略配置项详解

| 字段 | 类型 | 说明 |
|------|------|------|
| `trigger` | `{type: 'input_tokens', value: number}` | 触发清除的令牌数阈值 |
| `keep` | `{type: 'tool_uses', value: number}` | 保留最后 N 个工具使用记录 |
| `clear_tool_inputs` | `boolean \| string[]` | 清除工具输入值：`true` 全部清空，数组指定工具名 |
| `exclude_tools` | `string[]` | 排除这些工具名不进行清除 |
| `clear_at_least` | `{type: 'input_tokens', value: number}` | 至少清除该 token 数的内容 |

## 策略 2：clear_thinking_20251015（思考块清除）

这个策略用于管理对话中的思考块（thinking blocks）。

### 三层决策逻辑

```
场景 1：正常对话（缓存命中）
├─ hasThinking = true
├─ isRedactThinkingActive = false
├─ clearAllThinking = false
└─ 结果：keep='all' → 保留所有思考链
   原因：思考块对推理链有帮助，不应丢弃

场景 2：redact-thinking 启用
├─ isRedactThinkingActive = true
└─ 结果：跳过 clear_thinking_20251015 策略
   原因：redacted 块已无模型可见内容，不需要"清除"

场景 3：缓存过期（>1h 空闲）
├─ hasThinking = true
├─ clearAllThinking = true
└─ 结果：keep={value: 1} → 仅保留最后 1 个思考轮
   原因：缓存过期 = prompt_cache 是 miss
         需要重新计算，但保留最新思考帮助模型
```

### 与 redact-thinking 的协同

`redact-thinking` 是一个 API Beta 特性：
- 隐藏模型的内部思考过程
- 思考块仍在 token 计数中，但对用户/下游模型不可见
- 用于隐私和安全用途

**协同逻辑**：
```typescript
if (hasThinking && !isRedactThinkingActive) {
  // 只有当有思考块且 redact 未激活时，才添加清除策略
  strategies.push({
    type: 'clear_thinking_20251015',
    keep: clearAllThinking ? { value: 1 } : 'all',
  })
}
```

## 用户分层：Ant-only 门控

工具清除策略仅限内部用户（`USER_TYPE=ant`）使用：

| 用户类型 | USER_TYPE | 允许工具清除 | 允许思考块清除 |
|---------|-----------|-----------|-----------|
| 内部用户 | `'ant'` | ✓ 是（可配置） | ✓ 是 |
| 外部用户 | 其他值 | ✗ 否 | ✓ 是 |

**为什么分层？**
1. **工具清除是实验性的** - 仅在内部用户间测试
2. **思考块清除更成熟** - 所有用户都可用
3. **防止误伤** - 避免外部用户因工具清除导致上下文丢失

## Token 阈值设计

```typescript
const DEFAULT_MAX_INPUT_TOKENS = 180_000      // 触发清除的阈值
const DEFAULT_TARGET_INPUT_TOKENS = 40_000    // 清除后的目标保留量
```

**计算逻辑**：
- 当输入 tokens 超过 180,000 时触发清除
- 清除到只剩 40,000 tokens
- 清除量 = 180,000 - 40,000 = 140,000 tokens

## 环境变量驱动的配置

系统通过环境变量动态控制清除策略：

| 环境变量 | 作用 |
|---------|------|
| `USE_API_CLEAR_TOOL_RESULTS` | 启用读操作工具结果清除 |
| `USE_API_CLEAR_TOOL_USES` | 启用写操作工具使用记录排除 |

**实际效果**：
```
USE_API_CLEAR_TOOL_RESULTS=true:
  → 清除 grep、文件读取等工具的大量输出
  → 保留工具调用事实
  → 大幅减少 token 占用

USE_API_CLEAR_TOOL_USES=true:
  → 排除文件编辑、写入等工具不参与清除
  → 保留代码变更历史
  → 维持上下文连贯性
```

## 完整执行流程

```
getAPIContextManagement()
  │
  ├── 1. 初始化策略数组
  │
  ├── 2. 思考块处理
  │   ├── hasThinking && !isRedactThinkingActive?
  │   │   ├── YES → 添加 clear_thinking_20251015
  │   │   │   ├── clearAllThinking? → keep: 1
  │   │   │   └── 否则 → keep: 'all'
  │   │   └── NO → 跳过
  │
  ├── 3. Ant 门控检查
  │   ├── USER_TYPE === 'ant'?
  │   │   ├── YES → 继续检查工具清除
  │   │   └── NO → 返回当前策略（仅思考块）
  │
  ├── 4. 工具清除策略
  │   ├── USE_API_CLEAR_TOOL_RESULTS?
  │   │   └── YES → 添加 TOOLS_CLEARABLE_RESULTS 策略
  │   └── USE_API_CLEAR_TOOL_USES?
  │       └── YES → 添加 TOOLS_CLEARABLE_USES 策略
  │
  └── 5. 返回 ContextManagementConfig
```

## 总结

API 级微压缩代表了 Claude Code 上下文管理的未来方向：

| 优势 | 说明 |
|------|------|
| **精细化控制** | 在消息内删除特定文本块，而非整个消息 |
| **缓存友好** | cache_edits 保留 prompt cache，避免缓存失效 |
| **服务端维护** | 策略更新无需客户端发版 |
| **精确性高** | Token 计算由 API 承担，更准确 |

随着 API 特性的成熟，客户端 microCompact 可能会逐步被 API 级实现替代，实现更高效的上下文管理。

---

*本文基于 Claude Code 源码分析文档编写，所有设计决策均来自实际源码。*
