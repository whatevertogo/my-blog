---
title: "Claude code 的 QueryEngine"
date: 2026-04-02T 0:500:17Z
category: "claude code"
tags: ["agent"]
---

# {{ $frontmatter.title }}

说是QueryEngine(搜索引擎),其实我更想叫他agent loop，也就是所有智能体的核心

## QueryEngine在什么时候使用？

在用户每一次对话之后启用，这意味着启动一次会话就是启动一个QueryEngine对象，也就是我们说的agentloop

注：/btw就是QueryEngine的一次最小实现
```markdown
  ask() 便捷函数（L1186）

  是 QueryEngine 的一次性包装：创建引擎 → submitMessage() → 结束后回写文件缓存。适合不需要多轮对话的场景。
```

```markdown

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
```

```markdown
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