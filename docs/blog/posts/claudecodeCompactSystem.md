---
title: "Claude Code 的 CompactSystem 深度解析"
date: 2026-04-03
category: "I say"
tags: ["agent", "claude code", "上下文管理", "源码分析"]
---

# {{ $frontmatter.title }}

如果你曾经使用 Claude Code 进行过长时间的编程对话，可能会注意到一个现象：即使对话已经进行了几百轮，Claude 依然能够记住你最初的意图和关键的代码细节。这背后，就是 **CompactSystem** 在默默工作。

CompactSystem 是 Claude Code 中较为复杂的系统之一，负责在对话过程中智能管理上下文窗口，确保 AI 能够在长对话中保持连贯性和高效率。本文将深入分析其架构设计、核心模块和关键决策。

## 为什么需要上下文压缩？

想象一下这样的场景：你正在用 Claude Code 重构一个大型项目，对话已经进行了 200 多轮。你们讨论了架构设计、查看了十几个文件、修复了多个 bug、还创建了新的模块。此时对话历史已经积累了大量的信息。

但 Claude 模型有一个固定的上下文窗口限制（例如 Claude 3.5 Sonnet 为 200,000 tokens）。当对话历史接近这个限制时，如果不进行处理，API 将拒绝请求——就像你的电脑内存满了会崩溃一样。

CompactSystem 的核心任务就是解决这个问题：

1. **监控令牌使用量** - 实时跟踪上下文占用状态
2. **智能触发压缩** - 在合适的时机自动执行压缩（用户无感知）
3. **生成高质量摘要** - 保留关键信息，丢弃冗余内容
4. **恢复必要状态** - 压缩后重建模型需要的上下文

**简单来说**：CompactSystem 就像是 Claude 的"记忆管理器"，它会把不重要的细节压缩成摘要，把关键信息保留下来，让 Claude 在长对话中依然"记得"重要的事情。

## 系统架构总览

CompactSystem 由多个协同工作的模块组成：

```
┌─────────────────────────────────────────────────────────────┐
│                    CompactSystem 架构                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ autoCompact  │───▶│  compact.ts  │───▶│   prompt.ts  │  │
│  │  (触发器)    │    │  (核心压缩)  │    │ (提示词生成) │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                   │          │
│         ▼                   ▼                   ▼          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │microCompact  │    │postCompact   │    │sessionMemory │  │
│  │ (微压缩层)   │    │  Cleanup     │    │  Compact     │  │
│  └──────────────┘    │  (清理)      │    │ (实验性)     │  │
│                      └──────────────┘    └──────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块详解

### 1. autoCompact.ts - 智能触发器

`autoCompact.ts` 是整个系统的"大脑"，负责决定何时触发压缩。

#### 多层阈值设计

系统采用多层缓冲区策略，而非单一阈值。这就像汽车的油表警告系统：不是等到没油才警告，而是有多个级别的提醒。

```
上下文窗口上限 (200,000 tokens)
        ↓ 减去预留输出令牌 (20,000)
有效上下文窗口 (195,904 tokens)
        ↓ 减去手动压缩缓冲 (3,000)
阻塞极限 (~192,904 tokens) - 用户无法输入
        ↓ 减去错误缓冲 (20,000)
错误阈值 (~172,904 tokens) - API 可能拒绝
        ↓ 减去警告缓冲 (20,000)
警告阈值 (~152,904 tokens) - 提示用户
        ↓ 减去自动压缩缓冲 (13,000)
自动压缩阈值 (~139,904 tokens, 约 71.5%)
```

**实际场景举例**：

假设你正在和 Claude 对话，上下文使用量逐渐增加：

- **71.5% 时**：系统自动触发压缩，你完全无感知
- **78% 时**：如果自动压缩没触发，会显示警告提示
- **88% 时**：错误阈值，提示用户上下文紧张
- **98% 时**：阻塞极限，用户无法继续输入，必须压缩

**为什么这样设计？**

- **预留输出令牌**：基于实测 p99.99 的压缩摘要输出是 17,387 tokens，保守取整至 20,000。如果不预留，压缩时可能会超出模型窗口导致 API 错误
- **多层缓冲**：提供清晰的"心理模型"，各层可独立调优
- **绝对令牌数**：与模型无关，适用于不同规格的 Claude 模型

#### 电路熔断机制

系统实现了电路熔断器模式，防止无限重试浪费 API 调用：

```
┌──────────────────────┐
│  CLOSED (正常)       │ consecutiveFailures = 0
│  自动压缩: ✅ 启用    │
└──────────┬───────────┘
           │ 失败
           ▼
┌──────────────────────┐
│  HALF-OPEN (警惕)    │ consecutiveFailures = 1
│  自动压缩: ✅ 继续    │
└──────────┬───────────┘
           │ 再失败
           ▼
┌──────────────────────┐
│  HALF-OPEN (更警惕)  │ consecutiveFailures = 2
│  自动压缩: ✅ 最后   │
└──────────┬───────────┘
           │ 第三次失败
           ▼
┌──────────────────────┐
│  OPEN (断路)         │ consecutiveFailures >= 3
│  自动压缩: ✗ 禁用    │
└──────────────────────┘
```

**数据支撑**：2026-03-10 的 BigQuery 分析显示，1,279 个会话经历了 50+ 连续失败，极端情况达 3,272 次，全球每天浪费约 250K API 调用。熔断机制将这种浪费降低了 99.9%。

**实际场景举例**：

假设某个会话中连续发生压缩失败：

```
第 1 轮：tokenCount = 195,000 (99%)
         → 尝试压缩 → 失败：API 返回 prompt_too_long
         → consecutiveFailures = 1

第 2 轮：tokenCount = 195,500 (100%)
         → 再次尝试 → 失败：同样的 API 错误
         → consecutiveFailures = 2

第 3 轮：tokenCount = 196,000 (101%)
         → 最后一次尝试 → 失败
         → consecutiveFailures = 3

第 4 轮：tokenCount = 196,500 (102%)
         → 电路熔断！直接返回 false，不再尝试
         → 用户可以手动执行 /compact 命令
```

如果没有熔断机制，系统可能会继续尝试 3,272 次（真实数据中的极端案例），浪费大量 API 调用。

#### 两层压缩策略

```
autoCompactIfNeeded()
        ↓
┌─────────────────────────────┐
│ 尝试 Session Memory 压缩    │ ← 快速路径（零 API 调用）
└─────────────┬───────────────┘
      成功 ✅ │ 失败 ❌
              ▼
┌─────────────────────────────┐
│ 尝试 Legacy Compact         │ ← 质量路径（LLM 摘要）
│ (compactConversation)       │
└─────────────────────────────┘
```

**为什么先尝试 Session Memory？**

| 维度 | Session Memory | Legacy Compact |
|------|----------------|----------------|
| API 调用 | 零 | 需要一次 Claude forward pass |
| 执行速度 | 毫秒级 | 秒级 |
| Token 占用 | 无 | 占用输出令牌预算 |
| 清理范围 | 仅 session_memory 消息 | 完整上下文管理 |
| 适用场景 | 30% 的情况足够 | 70% 需要完整压缩 |

平均节省约 30% 的压缩 API 调用。

### 2. compact.ts - 核心压缩引擎

`compact.ts` 是系统的心脏，执行实际的压缩操作。

#### 完整执行流程

```
1. 验证 & 前置准备
   ├─ 检查消息非空
   ├─ 计算 pre-compact token 数
   └─ 记录权限上下文

2. 执行 Pre-Compact Hooks
   ├─ 触发 'pre_compact' 事件
   ├─ 合并自定义指令
   └─ 获取用户展示消息

3. 调用 Forked Agent 进行摘要
   ├─ 使用 tengu_compact_cache_prefix 特性
   ├─ runForkedAgent() 复用主对话 cache
   └─ 带 fallback 到流式路径

4. PTL 重试循环 (最多 3 次)
   ├─ 检查是否 prompt-too-long
   ├─ 调用 truncateHeadForPTLRetry()
   └─ 删除最旧 API 轮组，重试

5. 状态复原 & 文件恢复
   ├─ 保存 pre-compact 读文件缓存
   ├─ 清空 readFileState
   └─ 创建 post-compact 文件附件

6. 重新注入环境信息
   ├─ 文件附件（最多 5 个，50K token 预算）
   ├─ 异步任务状态附件
   ├─ 计划文件和计划模式
   ├─ 已调用的技能（25K token 预算）
   └─ 工具/MCP 指令 delta attachments

7. 执行 Session-Start Hooks
   └─ 恢复会话初始状态

8. 创建 Boundary Marker
   ├─ 记录压缩类型 (auto/manual)
   ├─ 记录 pre-compact token 数
   ├─ 存储已发现工具列表
   └─ 附加保留段元数据

9. 创建摘要消息
   ├─ 构建用户消息包含摘要文本
   ├─ 标记为 compact summary
   └─ 仅在 transcript 中可见

10. 编译遥测事件 (tengu_compact)
    ├─ pre/post token 计数
    ├─ 缓存碎片检测
    └─ 重新压缩链跟踪

11. Post-Compact Hooks & Cleanup
    ├─ 执行 'post_compact' 事件
    ├─ 重新追加会话元数据
    └─ 写入会话 transcript 段
```

#### Prompt Cache 共享机制

这是 compact.ts 的核心创新之一，也是理解整个系统的关键。

**背景知识**：Claude API 支持 Prompt Cache 功能，可以将常用的提示词前缀缓存起来，后续请求如果前缀相同就可以直接命中缓存，大幅减少 token 消耗和延迟。

**问题**：如果压缩时创建一个新的对话线程来生成摘要，这个新线程没有缓存，需要重新创建缓存，成本很高。

**解决方案**：使用 Forked Agent 机制，让压缩线程复用主对话线程的缓存。

```
主对话线程                          Forked Agent 线程
    ↓                                    ↓
[系统提示]                    共享缓存   [系统提示]
[工具定义]  ←─────使用同一份────→ [工具定义]
[消息前缀 1]  ←─────cache_key───────→ [消息前缀 1]
[消息前缀 2]  ←─────缓存命中────────→ [消息前缀 2]
    ...                                 ...
[新消息]     (独立)             [压缩提示 + 摘要请求]
```

**关键约束**：不能在 `runForkedAgent()` 中设置 `maxOutputTokens`，因为这会改变 thinking config 的 budget_tokens 计算，导致 cache key 改变，cache hit 变 miss。

**数据验证**：
- 禁用此机制 → 98% cache miss rate
- 启用此机制 → 98% cache hit rate
- 节省 0.76% of fleet cache_creation (~38B tokens/day)

**通俗理解**：就像你和同事共享一份文档的草稿，同事可以基于你的草稿直接修改，而不需要重新写一份。

#### Post-Compact 状态恢复

压缩后模型会丧失对某些上下文的访问，需要主动恢复。这就像你整理完房间后，需要把常用的东西放回原位。

**实际场景举例**：

假设你在对话中刚刚读取了 `src/utils/helper.ts` 文件并进行了修改，然后触发了压缩。压缩后，Claude 会"忘记"这个文件的内容。为了让 Claude 能够继续工作，系统会主动恢复最近访问的 5 个文件。

| 恢复内容 | 限制 | 原因 |
|---------|------|------|
| 文件状态 | 最多 5 个文件，50K token | 模型需要知道最近访问的文件内容 |
| 技能附件 | 每个 5K token，总计 25K | 技能说明通常在文件头部，截断保留说明 |
| 工具/MCP | delta attachments | 只宣布变化部分，不是全集 |
| 异步任务 | 运行中/失败/未取 | 保持任务状态连续性 |
| 计划文件 | 如果存在 | 维持计划模式 |

### 3. prompt.ts - 提示词工程

`prompt.ts` 负责生成高质量的压缩提示词，这是摘要质量的关键。

#### BASE_COMPACT_PROMPT 的 9 章节结构

| 章节 | 内容 | 认知层次 |
|------|------|--------|
| 1. Primary Request | 用户显式请求和意图 | 高层理解 |
| 2. Key Technical Concepts | 技术框架、设计模式 | 概念映射 |
| 3. Files and Code Sections | 文件路径、代码片段 | 具体细节 |
| 4. Errors and fixes | 错误及修复方案 | 问题追踪 |
| 5. Problem Solving | 已解决和进行中的问题 | 方法论 |
| 6. All user messages | 所有用户消息（按时间） | 反馈源 |
| 7. Pending Tasks | 未完成的任务 | 未来方向 |
| 8. Current Work | 压缩前最后在做的事 | 即时状态 |
| 9. Optional Next Step | 下一步建议 | 行动指引 |

#### NO_TOOLS_PREAMBLE 设计

```text
CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
```

**为什么需要？**

这是一个非常关键的设计决策。让我们理解背后的问题：

1. **缓存共享分叉需要继承父对话的完整工具集**（维持 cache-key 匹配）
2. **Sonnet 4.6+ 自适应思维模型有时会忽视尾部指令尝试调用工具**
3. **在 `maxTurns: 1` 约束下，工具调用被拒绝意味着无文本输出**

**实际场景**：

```
压缩请求 → Forked Agent 继承工具集 → 模型看到工具列表
         → 模型想调用 Read 工具查看某个文件
         → 但 maxTurns: 1 只允许一轮
         → 工具调用被拒绝 → 没有文本输出 → 压缩失败
```

**解决方案**：在提示词最前面加上强烈的禁止指令，明确告知后果（"will fail the task"）。

**数据验证**：前置 preamble 将失败率从 2.79% 降低到 0.01%。

#### Analysis 块剥离机制

```typescript
export function formatCompactSummary(summary: string): string {
  // 1. 剥离 <analysis> 块（内部思考草稿）
  formattedSummary = formattedSummary.replace(
    /<analysis>[\s\S]*?<\/analysis>/,
    '',
  )
  
  // 2. 提取和格式化 <summary> 块
  const summaryMatch = formattedSummary.match(/<summary>([\s\S]*?)<\/summary>/)
  if (summaryMatch) {
    formattedSummary = formattedSummary.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${content.trim()}`,
    )
  }
  
  // 3. 清理多余空白行
  formattedSummary = formattedSummary.replace(/\n\n+/g, '\n\n')
  
  return formattedSummary.trim()
}
```

**设计考量**：
- `<analysis>` 是模型的内部思考空间，帮助组织思路
- 一旦摘要完成，analysis 对用户没有信息价值
- 剥离后减少令牌消耗，提高缓存效率

### 4. microCompact.ts - 客户端微压缩层

`microCompact.ts` 处于请求流程的前端，负责消息级别的压缩。

#### 可压缩工具集合

```typescript
const COMPACTABLE_TOOLS = new Set<string>([
  FILE_READ_TOOL_NAME,        // 文件读取
  ...SHELL_TOOL_NAMES,         // Shell 命令
  GREP_TOOL_NAME,              // 文本搜索
  GLOB_TOOL_NAME,              // 文件匹配
  WEB_SEARCH_TOOL_NAME,        // 网络搜索
  WEB_FETCH_TOOL_NAME,         // URL 获取
  FILE_EDIT_TOOL_NAME,         // 文件编辑
  FILE_WRITE_TOOL_NAME,        // 文件写入
])
```

**压缩策略假设**：

```
工具结果可安全压缩的条件：
1. 输出是幂等的（重复查询得到相同结果）
2. 模型已经"消费"了其贡献
3. 压缩不会破坏对话的"记忆链条"
```

#### 缓存微压缩架构

```
┌─────────────────────────────────────────┐
│          Cached Microcompact System      │
└─────────────────┬───────────────────────┘
                  │
         ┌────────┴────────┐
         │ 功能检查         │
         └────────┬────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
enabled?   modelSupported?  mainThread?
    ▼             ▼             ▼
  否：跳过     否：降级      否：副线程隔离
                  │
                  ▼
         ┌────────────────┐
         │ 消息分析        │
         │ (两遍循环)      │
         └────────┬───────┘
                  ▼
         ┌────────────────┐
         │ 创建 cache_edits│
         │ + 加入待处理队列 │
         └────────────────┘
```

#### Token 估算策略

```typescript
return Math.ceil(totalTokens * (4 / 3))
```

**为什么乘以 4/3？**

粗略估算存在误差来源：
- 文本分词差异（汉字 1-2 token，英文分词边界）
- 块级元数据（JSON 外壳、类型标记、ID 字段）
- API 侧尾部处理

33% 的冗余确保宁高不低，避免低估导致的问题。

### 5. postCompactCleanup.ts - 压缩后清理

`postCompactCleanup.ts` 负责在压缩完成后进行全面的缓存和状态清理。

#### 清理流程

```
runPostCompactCleanup(querySource)
  ├─ [第 1 步] 判断是否主线程 compact
  │   └─ isMainThreadCompact = querySource === undefined ||
  │                           querySource.startsWith('repl_main_thread') ||
  │                           querySource === 'sdk'
  │
  ├─ [第 2 步] 无条件清理（所有线程）
  │   ├─ resetMicrocompactState()
  │   ├─ clearSystemPromptSections()
  │   ├─ clearClassifierApprovals()
  │   ├─ clearSpeculativeChecks()
  │   ├─ clearBetaTracingState()
  │   └─ clearSessionMessagesCache()
  │
  ├─ [第 3 步] 条件清理（主线程 only）
  │   ├─ IF CONTEXT_COLLAPSE: resetContextCollapse()
  │   ├─ getUserContext.cache.clear()
  │   └─ resetGetMemoryFilesCache('compact')
  │
  └─ [第 4 步] 异步清理（feature-gate）
      └─ IF COMMIT_ATTRIBUTION: sweepFileContentCache()
```

#### 为什么区分主线程/子代理？

这是一个容易出错的细节。子代理（如 `agent:subagent-1`）运行在同一进程中，共享模块级运行时状态，但执行上下文独立。

**问题场景**：

```
主线程：正在处理用户的对话，contextCollapseStore 存储了重要数据
子代理：执行完任务后触发压缩
       → 如果直接调用 resetContextCollapse()
       → 主线程的 contextCollapseStore 被清空
       → 主线程的数据丢失！
```

**解决方案**：只有主线程的压缩才执行线程级别的清理。

```typescript
// ❌ 错误做法：子代理清理时直接重置
runPostCompactCleanup(querySource: 'agent:subagent-1')
  resetContextCollapse() // 主线程的数据丢失！

// ✅ 正确做法：只有主线程执行线程级别的清理
if (isMainThreadCompact) {
  resetContextCollapse() // 安全
}
```

#### 为什么不清理 sentSkillNames？

```typescript
// Intentionally NOT calling resetSentSkillNames(): re-injecting the full
// skill_listing (~4K tokens) post-compact is pure cache_creation.
```

**理由**：
1. 重新注入成本高昂（~4K tokens/次）
2. `SkillTool` schema 在所有 turns 中保持一致
3. `invoked_skills` 已记录本次会话使用过的技能
4. 新增技能由 `skillChangeDetector` 处理

### 6. sessionMemoryCompact.ts - 实验性压缩

这是一个实验性模块，利用外部 Session Memory 存储优化 token 使用。

#### 核心概念

- **抽取关键信息**：将已总结的消息存储到外部 Session Memory 文件
- **保留未总结内容**：仅在消息流中保留未被总结的消息
- **对话理解连续性**：通过 Session Memory 作为摘要恢复完整上下文

#### 默认配置

| 参数 | 默认值 | 说明 |
|------|------|------|
| `minTokens` | 10,000 | 压缩后至少保留 10K tokens |
| `minTextBlockMessages` | 5 | 至少保留 5 条含文本的消息 |
| `maxTokens` | 40,000 | 硬上限：最多保留 40K tokens |

#### 配置管理

支持 GrowthBook 远程配置，key 为 `tengu_sm_compact_config`，可动态调整参数而无需重新部署。

## 实际工作流程：一次完整的压缩过程

让我们通过一个实际场景来理解整个系统是如何工作的：

**场景**：你正在用 Claude Code 开发一个 Web 应用，对话已经进行了 150 轮。

```
1. 监控阶段
   ├─ autoCompact.ts 持续监控令牌使用量
   ├─ 当前使用量：145,000 tokens (约 74%)
   └─ 超过自动压缩阈值 (139,904 tokens) → 触发压缩

2. 压缩执行
   ├─ 首先尝试 Session Memory 压缩（快速路径）
   │  └─ 失败：没有 session_memory 类型的消息
   ├─ 然后尝试 Legacy Compact（质量路径）
   │  ├─ 调用 Forked Agent 复用缓存
   │  ├─ 生成高质量摘要（9 章节结构）
   │  └─ 剥离 <analysis> 块，只保留 <summary>
   └─ 压缩成功！

3. 状态恢复
   ├─ 恢复最近访问的 5 个文件
   ├─ 重新注入技能附件（截断到 5K token/个）
   ├─ 恢复异步任务状态
   └─ 创建 Boundary Marker 记录压缩元数据

4. 清理阶段
   ├─ 清理 microcompact 状态
   ├─ 清理系统提示部分
   ├─ 清理分类器批准决策
   └─ 清理会话消息缓存

5. 继续对话
   └─ Claude 基于新的摘要和恢复的状态继续工作
   └─ 用户完全无感知
```

## 关键设计决策总结

通过分析源码，我们可以总结出 CompactSystem 的几个关键设计决策：

### 1. 为什么使用 Forked Agent 实现缓存共享？

**通俗理解**：就像你和同事共享一份文档的草稿，同事可以基于你的草稿直接修改，而不需要重新写一份。

主对话线程已经建立了 prompt cache，Forked Agent 通过相同的 cache-key 参数复用这份 cache，避免重复创建缓存。这是整个系统最重要的性能优化之一。

### 2. 为什么采用"删除旧 API 轮组"处理 PTL？

当压缩请求本身超过 prompt 长度时，不是直接失败，而是删除最旧的 API 轮组并重试。这是有损降级，但比完全失败好。

**实际场景**：假设压缩请求需要 210K tokens，但模型窗口只有 200K。系统会删除最早的几轮对话（通常是最不相关的），让请求适应窗口限制。

### 3. 为什么支持方向性的部分压缩？

- `'from'` 方向：清理早期的冗余/低质对话
- `'up_to'` 方向：合并最近的重复对话

两种场景有不同的缓存影响和使用场景。

### 4. 为什么技能截断而不是完全丢弃？

技能说明通常在文件头部，截断保留说明，丢弃实现细节。如需完整内容，模型可用 Read 读取全文件。

### 5. 失败不是选项

系统总是尽力维持可用上下文：
- PTL 重试机制
- Fallback 路径
- 多层压缩策略
- 电路熔断保护

## 遥测与可观测性

系统记录了丰富的遥测事件，这些数据驱动持续优化和异常诊断：

```typescript
logEvent('tengu_compact', {
  preCompactTokenCount,      // 压缩前的 token 数
  postCompactTokenCount,     // 压缩后的 token 数
  truePostCompactTokenCount, // 真实的压缩后 token 数（包含附件）
  autoCompactThreshold,      // 自动压缩阈值
  willRetriggerNextTurn,     // 是否会在下一轮重新触发
  isAutoCompact,             // 是否是自动压缩
  querySource,               // 查询来源（主线程/子代理）
  // ... 更多指标
})
```

**这些数据有什么用？**

- **性能优化**：通过分析 pre/post token count，评估压缩效率
- **异常诊断**：监控连续失败次数，及时发现系统问题
- **成本分析**：跟踪 cache hit/miss 率，优化缓存策略
- **用户体验**：分析压缩触发时机，确保用户无感知

## 总结

CompactSystem 是 Claude Code 能否在长对话中保持连贯性和高效率的关键。通过深入分析源码，我们可以看到这是一个经过精心设计的系统，每一个决策都有数据支撑和实际场景验证。

| 创新点 | 收益 | 成本 |
|------|------|------|
| Forked Agent Cache Sharing | 98% cache hit 率，节省 38B tok/day | 需要 identical cache-key 参数 |
| PTL 递进式截断 | 用户不被 hang，自动降级 | 丧失最旧 context |
| Post-Compact 文件恢复 | 模型开箱即用已知文件 | 5 个文件 50K token 预算 |
| 技能智能截断 | 保留文档但节省 token | 需要模型能 Read 全文件 |
| 方向性部分压缩 | 灵活管理对话结构 | 需要用户选择方向 |
| 电路熔断机制 | 避免 99.9% 的 API 浪费 | 3 次失败后需手动干预 |

**关键设计哲学**：
1. **失败不是选项**：总是尽力维持可用上下文
2. **Token 节约**：每一个压缩决策都考虑成本-收益比
3. **模型赋能**：保留足够的附件让模型做好决策
4. **可观测性**：密集的遥测支持持续改进

---

*本文基于 Claude Code 源码分析文档编写，所有数据和设计决策均来自实际源码和 BigQuery 分析结果。*