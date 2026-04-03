---
title: "Claude Code 的工具系统：30+ 工具的插件化架构设计"
date: 2026-04-03
category:"ai say"
tags:
  - AI
  - 架构设计
  - Claude Code
  - 工具系统
  - 插件化
description: "深入分析 Claude Code 如何通过统一的 Tool 接口、条件加载和权限过滤，管理 30+ 个工具的插件化架构。"
---

## 引言

一个强大的 AI 编程助手，本质上是一个**工具使用者**。就像人类程序员需要编辑器、终端、搜索工具一样，AI Agent 也需要工具来与外部世界交互。

Claude Code 内置了 **30 多个工具**：从基础的 Bash、文件读写，到高级的 Agent 派生、MCP 集成、Skill 执行、LSP 分析。管理如此多的工具，需要一个精心设计的插件化架构。

## 一、统一的 Tool 接口

所有工具都遵循统一的 `Tool` 接口，这使得系统可以用一致的方式处理任何工具：

```typescript
// Tool 接口的核心要素
interface Tool {
  name: string              // 工具名称（如 "Bash", "FileRead"）
  description: string       // 工具描述（展示给 Agent 看）
  inputSchema: ZodSchema    // 输入参数的 JSON Schema
  isEnabled: () => boolean  // 工具是否启用
  call: (input, context) => Promise<ToolResult>  // 执行工具
}
```

这种设计的最大好处是**多态性**：系统不需要知道具体是哪个工具，只需要调用统一的接口。这使得添加新工具变得非常简单——实现接口，注册到工具列表即可。

## 二、条件加载：按需引入，减少开销

Claude Code 使用了多种条件加载策略，确保只有需要的工具才会被加载到内存中：

### 策略一：基于用户类型的条件加载

```typescript
// 某些工具只对内部用户（ant）开放
const REPLTool =
  process.env.USER_TYPE === 'ant'
    ? require('./tools/REPLTool/REPLTool.js').REPLTool
    : null

const SuggestBackgroundPRTool =
  process.env.USER_TYPE === 'ant'
    ? require('./tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.js')
        .SuggestBackgroundPRTool
    : null
```

内部版本和外部版本的工具集不同。通过 `USER_TYPE` 环境变量，同一个代码库可以构建出不同功能的产品。

### 策略二：基于特性开关的条件加载

```typescript
// 通过 feature() 函数控制工具的可用性
const SleepTool =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('./tools/SleepTool/SleepTool.js').SleepTool
    : null

const cronTools = feature('AGENT_TRIGGERS')
  ? [
      require('./tools/ScheduleCronTool/CronCreateTool.js').CronCreateTool,
      require('./tools/ScheduleCronTool/CronDeleteTool.js').CronDeleteTool,
      require('./tools/ScheduleCronTool/CronListTool.js').CronListTool,
    ]
  : []
```

`feature()` 函数基于 Bun 的打包特性（`bun:bundle`），在构建时就能确定哪些工具应该被包含。这实现了**编译时的死代码消除**——未启用的工具根本不会出现在最终的打包文件中。

### 策略三：延迟加载打破循环依赖

```typescript
// 延迟加载：打破循环依赖
const getTeamCreateTool = () =>
  require('./tools/TeamCreateTool/TeamCreateTool.js').TeamCreateTool

const getTeamDeleteTool = () =>
  require('./tools/TeamDeleteTool/TeamDeleteTool.js').TeamDeleteTool
```

某些工具之间存在循环依赖。通过延迟加载（在函数内部 `require`），Claude Code 打破了这些循环，确保模块能正确初始化。

## 三、工具池组装：灵活的权限模型

当创建一个 Agent 时，系统需要为其组装一个合适的工具池。这个过程涉及多层过滤：

```typescript
function filterToolsForAgent({
  tools,
  isBuiltIn,      // 是否为内置 Agent
  isAsync,        // 是否为异步 Agent
  permissionMode, // 权限模式
}): Tools {
  return tools.filter(tool => {
    // 1. MCP 工具始终允许（扩展性优先）
    if (tool.name.startsWith('mcp__')) return true
    
    // 2. 计划模式下的 ExitPlanMode 特殊放行
    if (toolMatchesName(tool, EXIT_PLAN_MODE_V2_TOOL_NAME) && 
        permissionMode === 'plan') return true
    
    // 3. 所有 Agent 禁止的工具
    if (ALL_AGENT_DISALLOWED_TOOLS.has(tool.name)) return false
    
    // 4. 自定义 Agent 额外禁止的工具
    if (!isBuiltIn && CUSTOM_AGENT_DISALLOWED_TOOLS.has(tool.name)) return false
    
    // 5. 异步 Agent 的白名单限制
    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(tool.name)) return false
    
    return true
  })
}
```

这种分层过滤的设计哲学是：**默认开放，逐层收敛**。每一层过滤都解决一个特定的安全问题：

| 过滤层 | 解决的问题 |
|-------|-----------|
| MCP 工具放行 | 保证扩展性，第三方工具可用 |
| 全局禁止列表 | 防止 Agent 创建 Agent（避免无限递归） |
| 自定义 Agent 禁止 | 限制自定义 Agent 的权限 |
| 异步白名单 | 限制后台 Agent 的工具范围 |

## 四、工具预设：开箱即用的配置

Claude Code 还提供了工具预设功能，让用户可以快速选择一组工具：

```typescript
export const TOOL_PRESETS = ['default'] as const

export function getToolsForDefaultPreset(): string[] {
  const tools = getAllBaseTools()
  const isEnabled = tools.map(tool => tool.isEnabled())
  return tools.filter((_, i) => isEnabled[i]).map(tool => tool.name)
}
```

预设系统考虑了工具的 `isEnabled()` 状态——即使某个工具在预设列表中，如果它被环境变量或配置禁用，也不会出现在最终的工具列表中。

## 五、MCP 工具：无限扩展的桥梁

MCP（Model Context Protocol）是 Claude Code 工具系统中最具扩展性的部分。MCP 工具的名称以 `mcp__` 为前缀，在工具过滤中被特殊处理：

```typescript
// MCP 工具始终允许
if (tool.name.startsWith('mcp__')) return true
```

这个简单的设计决策意味着：**任何 MCP 服务器都可以为 Claude Code 提供新工具**，而不需要修改核心代码。MCP 工具的动态发现机制使得 Claude Code 的工具集可以无限扩展。

## 六、工具搜索：动态发现可用工具

当工具数量很多时，Agent 可能不知道哪个工具最适合当前任务。Claude Code 实现了 `ToolSearchTool` 来解决这个问题：

```typescript
// 工具搜索工具：让 Agent 可以搜索可用的工具
import { ToolSearchTool } from './tools/ToolSearchTool/ToolSearchTool.js'
```

这个工具允许 Agent 在需要时搜索可用的工具及其描述，帮助它选择最合适的工具。这类似于人类程序员在不确定时使用 `man` 命令或查阅文档。

## 七、设计启示

### 1. 统一接口是多态的基础

所有工具遵循统一的 `Tool` 接口，使得系统可以用一致的方式处理任何工具。这是插件化架构的基石。

### 2. 条件加载实现产品差异化

通过 `USER_TYPE` 和 `feature()` 函数，同一个代码库可以构建出不同功能的产品。内部版本拥有更多工具，外部版本更加精简。

### 3. 分层过滤保证安全性

工具池的分层过滤（MCP 开放 → 全局禁止 → 自定义禁止 → 异步白名单）确保了不同场景下的安全性，同时保持了扩展性。

### 4. 延迟加载解决循环依赖

在函数内部 `require` 而不是模块顶部 `import`，打破了模块间的循环依赖。这是一个简单但有效的技术。

## 结语

Claude Code 的工具系统展现了一个成熟插件化架构的要素：**统一接口、条件加载、分层过滤、动态扩展**。30 多个工具在一个系统中和谐共存，每个工具都有自己的生命周期和权限控制。

对于构建工具密集型 AI 应用的开发者来说，这套架构提供了一个清晰的范式：定义统一接口、实现条件加载、设计分层过滤、支持动态扩展。每一个细节都决定了工具系统的可扩展性和安全性。

---

> **声明**：本文基于对 Claude Code 公开 npm 包（v2.1.88）的 source map 还原源码进行分析，仅供技术研究使用。源码版权归 [Anthropic](https://www.anthropic.com) 所有。
