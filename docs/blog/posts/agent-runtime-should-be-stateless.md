---
title: "二、Agent 运行时应当是无状态的"
date: 2026-05-11
category: "Astrcodey"
tags:
  - AI 编程工具
  - 架构设计
description: "无状态是为了状态管理的分离，把复杂度从运行时内部搬到事件日志里，让每一层各管各的事。"
---

## 引言

在 [上一篇](./ai-coding-compact-comparison) 里我介绍了 agentloop 的基本形态，并展示了 Claude Code 和 Codex 是如何用一层又一层的状态机来管理 Agent 生命周期的。我当时提了一句：**Astrcodey 的 agentloop 不管理状态，所有状态藏在 eventlog 里，通过 projection 推导出来。**

这篇文章就把这句话展开讲清楚：为什么我认为 Agent 运行时应当是无状态的，以及 Astrcodey 的真实代码是怎么做到的。

## 先说结论

Agent 运行时无状态，不是说 Agent 没有状态——Agent 当然有状态，它在第几步、调了哪些工具、出了什么错，这些都是状态。无状态的意思是：**运行时本身不持有、不维护、不修改任何状态。**

看 Astrcodey 的 `Session` 结构体，这是 server 侧唯一代表"一个活跃会话"的对象：

```rust
// crates/astrcode-server/src/session/mod.rs

/// 活跃会话句柄。
///
/// 这里不保存读模型；读模型属于 storage projection。
pub struct Session {
    /// 会话唯一标识。
    pub id: SessionId,
}
```

一个 ID 字段，没有别的。所有状态——消息历史、当前阶段、挂起的工具调用、后台任务——全部不在 `Session` 里，而在 storage 层的 projection 中。运行时只做三件事：

```
1. append(event)      → 写事件到 JSONL 日志
2. reduce(event)      → 同步更新内存 projection
3. read_model()       → 读 projection，决定下一步
```

没有第四条路。

## 原因一：LLM 本身就是无状态的

这是最根本的理由。LLM 的每次 API 调用都是一次独立的函数求值——同样的输入，同样的输出，没有副作用，没有隐藏的内部变量。所谓"对话"，不过是每次把完整的 messages 数组重新塞进去。

如果运行时是有状态的，就出现了一个尴尬的局面：**你在一层无状态的引擎上面，搭了一层有状态的业务逻辑。** 每次调用 LLM 之前，你必须小心翼翼地把运行时的内部状态翻译成 LLM 能理解的 messages；LLM 返回之后，你又要把它的回复反写到运行时状态里。这个翻译层是 bug 的温床——一旦两边不同步，Agent 就会基于过时的或矛盾的信息做出决策。

Astrcodey 的做法是让 projection 直接产出 provider 可见消息。`SessionReadModel` 提供了 `provider_messages()` 方法：

```rust
// crates/astrcode-core/src/storage.rs

impl SessionReadModel {
    /// 返回 provider 可见消息。
    /// 包含防御性归一化：将连续的 assistant+tool_calls 消息合并为一条，
    /// 以满足 OpenAI API 对 tool_calls 消息的协议要求。
    pub fn provider_messages(&self) -> Vec<LlmMessage> {
        let mut messages = Vec::with_capacity(
            self.context_messages.len().saturating_add(self.messages.len()),
        );
        messages.extend(self.context_messages.clone());
        messages.extend(self.messages.clone());
        messages = messages.into_iter()
            .map(LlmMessage::provider_visible)
            .filter(LlmMessage::has_provider_visible_content)
            .collect();
        normalize_tool_call_messages(&mut messages);
        messages
    }
}
```

运行时不需要维护任何和 LLM 上下文平行的状态副本。**eventlog 就是上下文的历史，projection 就是上下文的当下。** 运行时和 LLM 看到的是同一份数据，没有同步的问题。

## 原因二：状态机是组合爆炸

看看 Claude Code 的 `State` 类型：

```typescript
type State = {
  messages: Message[]
  autoCompactTracking: ...
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: ...
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined
}
```

每一个字段都是一个状态维度。`hasAttemptedReactiveCompact × stopHookActive × transition` 的组合有多少种？没人能说清。但你必须为每一种组合写出正确的处理逻辑，因为少覆盖一种就是一个潜在 bug。

无状态运行时把这个问题的性质变了：**你不再需要穷举所有状态组合，你只需要定义 reduce 函数——给定一个事件，更新读模型。** Astrcodey 的 projection 就是一个纯函数：

```rust
// crates/astrcode-storage/src/projection.rs

/// 将单个持久事件归约到读模型。
pub(crate) fn reduce(event: &Event, model: &mut SessionReadModel) {
    model.latest_seq = event.seq.or(model.latest_seq);
    model.updated_at = event.timestamp.to_rfc3339();

    match &event.payload {
        EventPayload::SessionStarted { working_dir, model_id, parent_session_id } => {
            model.working_dir = working_dir.clone();
            model.model_id = model_id.clone();
            model.parent_session_id = parent_session_id.clone();
            model.phase = Phase::Idle;
        }
        EventPayload::UserMessage { text, .. } => {
            model.phase = Phase::Thinking;
            model.messages.push(LlmMessage::user(text));
        }
        EventPayload::ToolCallRequested { call_id, tool_name, arguments } => {
            model.pending_tool_calls.insert(call_id.clone());
            // 合并到上一条 assistant 消息
            // ...
            model.phase = Phase::CallingTool;
        }
        EventPayload::ToolCallCompleted { call_id, .. } => {
            model.pending_tool_calls.remove(call_id);
            model.phase = if model.pending_tool_calls.is_empty() {
                Phase::Thinking
            } else {
                Phase::CallingTool
            };
        }
        // ...
    }
}
```

没有状态转移图，没有组合爆炸。每来一个事件，更新读模型的对应字段。**Phase 是推导出来的，不是枚举再转移的。** 新增事件类型只需要加一个 match 分支，不用考虑和其他状态的交互。

## 原因三：可恢复性是天然的，不是后期加的

有状态运行时最大的痛点之一是错误恢复。Agent 执行到第 30 步，网络断了，LLM 超时了，工具调用崩了——你得写序列化逻辑把状态持久化，再写反序列化逻辑恢复回来。这个恢复路径几乎不可能被充分测试。

Astrcodey 的 `EventLog` 是追加式 JSONL 文件，每次 `append` 后立即 `flush + sync_all`：

```rust
// crates/astrcode-storage/src/event_log.rs

pub async fn append(&self, mut event: Event) -> Result<Event, StorageError> {
    let seq = *self.next_seq.lock()?;
    event.seq = Some(seq);
    let mut writer = self.writer.lock()?;
    let line = serde_json::to_string(&event)?;
    writeln!(writer, "{}", line)?;
    Self::flush_and_sync_writer(&mut writer, &self.path)?;
    *next_seq += 1;
    Ok(event)
}
```

事件写入后永不修改。**因为状态不在运行时里，所以运行时崩溃了不丢任何东西。** 重启后 `restore_projection` 先尝试从最近的 snapshot 恢复，失败则回退到全量重放：

```rust
// crates/astrcode-storage/src/session_repo.rs

async fn restore_projection(&self, session_id, log, snapshot_mgr) {
    if let Some(snapshot) = snapshot_mgr.latest_snapshot().await? {
        match restore_from_snapshot(log, snapshot).await {
            Ok(model) => return Ok(model),
            Err(error) => {
                // 快照损坏？没关系，回退到全量重放
                tracing::warn!("Falling back to full event replay: {error}");
            }
        }
    }
    let events = log.replay_all().await?;
    Ok(projection::replay(session_id, &events))
}
```

snapshot 是恢复加速器，不是事实源。`restore_from_snapshot` 从快照点开始只重放增量事件：

```rust
async fn restore_from_snapshot(log, snapshot) -> Result<SessionReadModel> {
    let mut model = snapshot.model;
    // 只重放快照之后的事件
    for event in log.replay_after(snapshot.latest_seq).await? {
        projection::reduce(&event, &mut model);
    }
    Ok(model)
}
```

不需要额外的检查点机制，不需要特殊的恢复代码。**事件日志本身就是检查点，每一行就是一个检查点。** 快照损坏也无所谓——全量重放保证正确性，快照只影响恢复速度。

## 原因四：可测试性的质变

测试有状态的 Agent 是痛苦的——构造特定内部状态、注入到运行时、验证行为，状态越复杂 setup 越脆弱。

Astrcodey 的测试完全是另一回事。`EventPayload::is_durable()` 把事件分成两类：需要持久化的（durable）和只用于实时 UI 的（live）：

```rust
// crates/astrcode-core/src/event.rs

impl EventPayload {
    pub fn is_durable(&self) -> bool {
        !matches!(
            self,
            Self::ToolCallStarted { .. }
                | Self::AssistantTextDelta { .. }
                | Self::ThinkingDelta { .. }
                | Self::ToolCallArgumentsDelta { .. }
                | Self::ToolOutputDelta { .. }
                | Self::CompactionStarted
                | Self::ToolCallBackgrounded { .. }
                | Self::BackgroundTaskOutput { .. }
                | Self::BackgroundTaskCompleted { .. }
        )
    }
}
```

流式增量（`TextDelta`、`ToolOutputDelta`）不需要持久化，因为它们可以从 `AssistantMessageCompleted`、`ToolCallCompleted` 等 durable 事件重建。

所以测试只需要构造 durable 事件序列，然后验证 projection 结果。项目里已经有大量这样的测试，比如验证并行工具调用后消息合并：

```rust
// crates/astrcode-storage/src/session_repo.rs (tests)

#[tokio::test]
async fn parallel_tool_call_requested_events_produce_single_assistant_message() {
    // 构造事件序列：用户消息 → 多个 ToolCallRequested → 多个 ToolCallCompleted
    repo.append_event(Event::new(..., EventPayload::UserMessage { text: "read files" })).await;
    repo.append_event(Event::new(..., EventPayload::ToolCallRequested { call_id: "call_1", ... })).await;
    repo.append_event(Event::new(..., EventPayload::ToolCallRequested { call_id: "call_2", ... })).await;
    repo.append_event(Event::new(..., EventPayload::ToolCallCompleted { call_id: "call_1", ... })).await;
    repo.append_event(Event::new(..., EventPayload::ToolCallCompleted { call_id: "call_2", ... })).await;

    let model = repo.session_read_model(&session_id).await.unwrap();

    // projection 自动把并行 tool calls 合并到同一条 assistant 消息
    let tool_call_count = model.messages[1].content.iter()
        .filter(|c| matches!(c, LlmContent::ToolCall { .. }))
        .count();
    assert_eq!(tool_call_count, 2, "parallel tool calls must be merged");
}
```

不需要 mock 运行时的内部状态，不需要 setup/teardown，不需要担心测试之间的状态泄漏。**事件序列就是测试用例，projection 就是断言目标。**

## 原因五：关注点真正分离

有状态运行时里，控制流、状态管理、扩展逻辑搅在一起。无状态运行时强制把它们分开，Astrcodey 的代码结构直接反映了这种分离：

```
crates/astrcode-server/src/session/    → 控制流：创建、恢复、追加事件、查询
crates/astrcode-storage/src/event_log.rs → 写：追加式 JSONL，永不修改
crates/astrcode-storage/src/projection.rs → 读：纯函数 reduce
crates/astrcode-storage/src/snapshot.rs   → 优化：恢复加速器
crates/astrcode-core/src/event.rs         → 协议：事件类型定义
```

每一个 crate 有明确的职责边界：

| 关注点 | 归属 | 变更方式 |
|---|---|---|
| 控制流 | `session/mod.rs` | 改协调逻辑 |
| 状态写入 | `event_log.rs` | 追加事件，不改已有数据 |
| 状态读取 | `projection.rs` | 加 match 分支 |
| 恢复优化 | `snapshot.rs` | 改快照策略，不影响正确性 |
| 事件定义 | `event.rs` | 加 EventPayload 变体 |

**每一层只依赖上一层的结果，不依赖上一层的实现。** `SessionManager` 不知道 `EventLog` 是 JSONL 还是数据库，不知道 projection 怎么算，它只知道调用 `store.append_event()` 和 `store.session_read_model()`。

## 代价

无状态不是免费的。说清楚代价才能公平比较：

**1. projection 的性能开销。** 每轮循环都要从头扫描事件日志推导状态，日志越长越慢。Astrcodey 的解法是 `SnapshotManager`：定期对 projection 做快照，恢复时只重放快照之后的增量事件。快照保留最近 3 个，损坏时自动回退到全量重放。

**2. eventlog 的设计复杂度前置。** 你必须在项目早期就想清楚事件类型的设计。Astrcodey 的 `EventPayload` 有二十多个变体，包括会话生命周期、消息流、工具调用、上下文压缩、子 Agent 派生等。每个变体的字段、是否 durable、projection 如何处理，都需要预先设计。这是一次性的架构成本，但做对了之后，后期的开发速度会比有状态方案快很多。

**3. 调试思维转换。** 习惯了断点调试可变状态的人，需要适应"看事件日志而不是看变量"的调试方式。但这其实是一种更好的调试——你可以回放任意时刻的状态，而不是只能看到断点那一瞬间的值。

## 总结

Agent 运行时无状态的核心思想很简单：**不持有状态，只记录事件，按需推导状态。**

这不是什么新发明——事件溯源（Event Sourcing）在分布式系统和数据库领域已经被验证了几十年。我只是把它用在了 Agent 运行时这个场景里。LLM 天生无状态，Agent 的复杂度已经够高了，运行时再搞一堆可变状态纯属自找麻烦。把状态推到 eventlog 里，用纯函数 projection 推导，agentloop 只管控制流——这样的架构，简单、可测试、可恢复、可扩展。

一句话：**让运行时做运行时的事，让日志做状态的事。**
