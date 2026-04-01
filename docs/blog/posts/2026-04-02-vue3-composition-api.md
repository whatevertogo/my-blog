---
title: "claude code 的 agent loop"
date: 2026-04-02T 0:500:17Z
category: "claude code"
tags: ["agent"]
---

# {{ $frontmatter.title }}

claude code 中的QueryEngine

## ref 与 reactive 的选择


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
