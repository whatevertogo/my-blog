---
title: "Claude code 的 QueryEngine"
date: 2026-04-02T 0:500:17Z
category: "claude code"
tags: ["agent"]
---

# {{ $frontmatter.title }}

说是QueryEngine(搜索引擎),其实我更想叫他agent loop，也就是所有智能体的核心

## QueryEngine在什么时候使用？

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