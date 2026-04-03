---
title: "Claude Code 的时间基础微压缩：智能清理的艺术"
date: 2026-04-03T14:30:00Z
category: "claude code"
tags: ["agent", "claude code", "上下文管理", "缓存优化", "源码分析"]
---

# {{ $frontmatter.title }}

如果你曾经离开 Claude Code 运行了一段时间后回来继续工作，可能会发现它依然流畅如初。这背后，有一个鲜为人知的机制在默默工作——**时间基础微压缩**（Time-Based Microcompact）。

## 什么是时间基础微压缩？

简单来说，它通过检测对话中的时间间隔来决定是否清理旧的工具结果。

**实际场景**：

```
时间线：
├─ T=0:   你让 Claude 读取了 10 个文件，执行了 20 个命令
├─ T=30m: 你继续对话，一切正常
├─ T=60m: 你去开了个会...
├─ T=120m: 你回来继续工作
│         → 时间基础微压缩触发
│         → 清理旧的工具结果（保留最近 5 个）
│         → 释放 token 空间
└─ T=125m: 你继续和 Claude 对话，流畅如初
```

## 核心配置设计

```typescript
export type TimeBasedMCConfig = {
  enabled: boolean              // 主开关
  gapThresholdMinutes: number   // 时间间隔阈值（分钟）
  keepRecent: number            // 保留最近的 N 个工具结果
}

// 默认配置
const TIME_BASED_MC_CONFIG_DEFAULTS: TimeBasedMCConfig = {
  enabled: false,           // 默认关闭，通过 GrowthBook 控制
  gapThresholdMinutes: 60,  // 60 分钟阈值
  keepRecent: 5,            // 保留最近 5 个
}
```

## 为什么 gapThresholdMinutes 设为 60？

这是整个模块最精妙的设计决策。

### 服务器 Prompt Cache TTL = 1 小时

```
时间线分析：
├─ T=0:   用户发送消息，创建缓存
├─ T=30m: 用户继续对话，缓存命中 ✓
├─ T=60m: 缓存 TTL 到期
├─ T=61m: 用户发送新消息
│         → 缓存已过期，需要重新计算
│         → 此时清理旧工具结果不会造成额外损失
│         → 因为缓存已经是 miss 了
```

### 为什么不是更短或更长？

```
如果 < 60 分钟（例如 30 分钟）：
├─ 缓存仍然有效（TTL 未到期）
├─ 清理工具结果 → 改变消息内容
├─ 导致缓存 miss（本来可以 hit）
└─ 结果：强制额外的缓存缺失 ❌

如果 > 60 分钟（例如 120 分钟）：
├─ 缓存在 60 分钟时已过期
├─ 但清理要等到 120 分钟才触发
├─ 60-120 分钟之间的请求：
│  ├─ 缓存 miss（已过期）
│  ├─ 但工具结果仍然完整发送
│  └─ 浪费 token（本可以清理）
└─ 结果：错过优化机会 ❌

60 分钟 = 完美对齐点 ✓
  → 永远不会强制额外的缓存缺失
  → 也不会错过任何优化机会
```

## GrowthBook 远程配置

```typescript
export function getTimeBasedMCConfig(): TimeBasedMCConfig {
  return getFeatureValue_CACHED_MAY_BE_STALE<TimeBasedMCConfig>(
    'tengu_slate_heron',
    TIME_BASED_MC_CONFIG_DEFAULTS,
  )
}
```

**特性 Key**：`tengu_slate_heron`

**A/B 测试机制**：

```
GrowthBook 配置：
├─ 对照组：enabled=false（默认）
├─ 实验组 1：enabled=true, gapThresholdMinutes=60
├─ 实验组 2：enabled=true, gapThresholdMinutes=30
└─ 实验组 3：enabled=true, keepRecent=10

指标追踪：
├─ 缓存命中率变化
├─ Token 使用量变化
├─ API 响应时间
└─ 用户满意度
```

## 为什么仅限主线程？

时间基础微压缩**仅在主线程运行**，子代理不参与。

**原因**：

```
子代理的生命周期约束：
├─ 子代理（agent:*）通常运行时间短（几分钟）
├─ gap-based eviction 不适用于短生命周期进程
├─ 子代理有自己的上下文管理
└─ 不需要时间基础清理

主线程的特点：
├─ 长时间运行（用户会话可能持续数小时）
├─ 缓存 TTL 过期是常见问题
├─ 工具结果累积导致 token 浪费
└─ 时间基础清理有实际收益
```

**实现方式**：

```typescript
function isMainThreadSource(querySource: QuerySource | undefined): boolean {
  return !querySource || querySource.startsWith('repl_main_thread')
}

// 时间基础 MC 触发前检查
if (!config.enabled || !querySource || !isMainThreadSource(querySource)) {
  return null  // 非主线程或未启用，跳过
}
```

## 警告抑制机制

`compactWarningState.ts` 负责管理"压缩不足"警告的抑制状态。

### 问题场景

```
场景：消息列表包含大量工具结果
├─ 触发微压缩逻辑
├─ 成功删除 50 个旧工具结果 ✓
├─ 当前状态：上下文已优化，不应显示警告
│
└─ 但如果代码：
    if (messagesHaveManyTools()) {
      showWarning()  // ❌ 显示警告
    }
   这是错的！我们刚刚压缩过，不需要警告
```

### 解决方案

```
时间轴：

Request N:
  ├─ 开始处理
  ├─ clearCompactWarningSuppression()  ← 重置状态
  ├─ 评估是否需要压缩
  ├─ 如果成功压缩 → suppressCompactWarning()  ← 设置标志
  └─ 返回结果
  
Response N:
  ├─ 收取结果
  ├─ 检查警告状态
  ├─ if (isSuppressed) { 不显示警告 }
  └─ 请求完成

Request N+1:
  ├─ 新周期，新的消息列表
  ├─ clearCompactWarningSuppression()  ← 重置，允许新警告
  ├─ 评估...
  └─ ...
```

### 核心函数

| 函数 | 调用时机 | 作用 |
|------|---------|------|
| `clearCompactWarningSuppression()` | 微压缩处理开始时 | 重置抑制状态，允许新警告 |
| `suppressCompactWarning()` | 成功压缩后 | 设置抑制标志，避免假阳性警告 |

## 完整工作流程

```
用户发送消息（距离上次对话已过 60 分钟）
  │
  ├── 1. 检查配置
  │   ├── enabled? → YES
  │   ├── 主线程? → YES
  │   └── gapThresholdMinutes 已过? → YES
  │
  ├── 2. 评估可清理的工具结果
  │   ├── 收集所有可压缩工具结果
  │   ├── 按时间排序
  │   └── 保留最近 5 个，标记其余为清理
  │
  ├── 3. 执行清理
  │   ├── clearCompactWarningSuppression()
  │   ├── 创建 cache_edits 指令
  │   └── suppressCompactWarning()
  │
  └── 4. 返回结果
      ├── 消息内容已优化
      └── 警告被抑制（不显示"工具结果空间不足"）
```

## 与客户端微压缩的关系

时间基础微压缩是客户端微压缩（microCompact.ts）的一个补充策略：

```
microCompact.ts 压缩决策：
  │
  ├── 评估缓存微压缩（Cached MC）
  │   └── 基于工具调用次数和触发阈值
  │
  ├── 评估时间基础微压缩（Time-Based MC）
  │   └── 基于时间间隔和缓存 TTL
  │
  └── 选择最优策略执行
```

**双轨压缩**：
- **缓存 MC**（热缓存）：基于工具调用频率，适合密集工作场景
- **时间 MC**（冷缓存）：基于时间间隔，适合间歇工作场景

## 总结

时间基础微压缩是一个精巧的设计：

| 设计点 | 说明 |
|--------|------|
| **60 分钟阈值** | 完美对齐服务器 Prompt Cache TTL |
| **主线程限制** | 避免子代理的短生命周期干扰 |
| **GrowthBook 集成** | 支持 A/B 测试和动态调优 |
| **警告抑制** | 避免压缩成功后的假阳性警告 |
| **双轨策略** | 热缓存 + 冷缓存，覆盖所有场景 |

它确保了无论用户是连续工作还是间歇工作，Claude Code 都能保持最佳的上下文状态。

---

*本文基于 Claude Code 源码分析文档编写，所有设计决策均来自实际源码。*
