---
title: "Astrcode EventLog 底层实现：为什么我选择事件流，而不是只存聊天记录"
date: 2026-04-26
category: "ai say"
tags:
  - Astrcode
  - Event Sourcing
  - AI 编程工具
  - 架构对比
  - Claude Code
  - Codex
  - Kimi CLI
  - OpenCode
  - Pi Mono
description: "从 Astrcode 的 JSONL EventLog、50ms 批量写入、checkpoint 快照、投影恢复和 turn 锁讲起，对比 Claude Code、Codex、Kimi CLI、Pi Mono、OpenCode 的会话持久化设计。"
---

# Astrcode EventLog 底层实现：为什么我选择事件流，而不是只存聊天记录

AI Coding CLI 看起来都在做一件事：把一次会话存下来，下次可以 resume。

但底层差异很大。有的工具存的是聊天 transcript，有的存的是模型 rollout，有的存的是 SQLite 里的 message/part，有的把会话做成 parent-child 树。Astrcode 的 EventLog 走的是另一条路：它不是把“当前聊天记录”当成唯一事实，而是把“发生过什么”作为事实，然后用投影把事实折叠成模型上下文、UI 状态、子任务树、输入队列、协作状态等读模型。

这篇文章讲三件事：

1. Astrcode 的 EventLog 到底怎么落盘、恢复和 checkpoint。
2. 这个设计的优点、缺点，以及我在实现里怎么缓解这些缺点。
3. 它和 Claude Code、Codex、Kimi CLI、Pi Mono、OpenCode 的会话存储有什么本质区别。

## 先说结论

如果只做一个单 Agent 聊天 CLI，最简单、最划算的方案通常是 transcript JSONL：一行一个 message，resume 时读回来。

如果系统目标是多 Agent、可审计、可恢复、可从同一事实流派生多个状态视图，那么只存 messages 会越来越吃力。Astrcode 选择 EventLog 的核心原因是：我不想让“模型上下文”成为系统唯一的真相。模型上下文只是一个投影，真正的事实是事件。

这个选择带来的代价也很明确：实现复杂度更高，schema 演进更难，冷启动可能需要 replay，写入路径也比 append message 更重。所以 Astrcode 没有停在一个朴素 JSONL 事件流，而是加了 50ms 批量写入、checkpoint 快照、tail replay、原子首事件创建、turn lock、投影快照等缓解机制。

## Astrcode 的 EventLog 长什么样

Astrcode 的会话事件最终落在 per-session JSONL 文件里。每一行不是裸事件，而是一个带存储序号的记录：

```json
{
  "storage_seq": 42,
  "event": {
    "turn_id": "...",
    "agent": { "type": "root" },
    "type": "ToolResult",
    "data": {}
  }
}
```

`storage_seq` 由底层 `EventLog` 分配，不由业务层传入。这个序号很重要，它让恢复、checkpoint、tail replay 都有了稳定边界。checkpoint 记录“我已经投影到哪个 storage_seq”，恢复时只需要加载 checkpoint，再重放之后的 tail events。

事件本身是 typed domain event，而不是普通聊天消息。它覆盖的范围包括：

- 会话生命周期：`SessionStart`
- 用户与助手：`UserMessage`、`AssistantFinal`
- 工具调用：`ToolCall`、`ToolResult`、`ToolResultReferenceApplied`
- 压缩与模式：`CompactApplied`、`ModeChanged`
- 多 Agent 与协作：子任务、collaboration fact、输入队列
- 运行指标与错误：metrics、error、thinking/delta 类事件

这意味着 Astrcode 存下来的不是“最后要发给模型的数组”，而是足够还原系统行为的事实序列。

## 写入路径：不是每个事件都直接 fsync

早期看 EventLog 很容易误解成“每条事件 append 后都 fsync”。底层 `EventLog.append_batch()` 的确会在写完一个 batch 后 `flush` 并 `sync_all`，但现在生产路径前面还有一层 per-session `BatchAppender`。

实际链路大致是：

```text
SessionWriter
  -> EventStore
  -> FileSystemSessionRepository
  -> per-session BatchAppender
  -> EventLog.append_batch(events)
  -> writer.flush()
  -> file.sync_all()
```

`BatchAppender` 会把同一 session 的 append 请求放进队列，并用一个 50ms 的 drain window 合并高频事件。也就是说，高频 delta、tool 流式输出、连续状态变化不会天然变成每行一次磁盘同步，而是尽量合并成一次 batch fsync。

这是一个很现实的折中：

- 不完全牺牲持久性：batch 写完后仍然 sync。
- 不让高频事件把 IO 打爆：50ms 窗口把多次 append 合并。
- 保持顺序简单：同一 session 内仍然由一个 appender 串行分配 `storage_seq`。

## 首事件创建：避免空 session 文件

很多 CLI 都会遇到一个小问题：用户打开工具但没真正产生有价值的会话，磁盘上却留下了一堆空 session。

Astrcode 对首事件做了特殊处理：创建会话文件时先写 `.tmp`，写入第一条事件、flush、sync 后，再原子 rename 到正式 JSONL 文件。启动时还会清理残留的临时文件。

这个设计解决两个问题：

1. 避免只有文件名、没有内容的 session。
2. 避免进程在首事件写到一半时留下看似可恢复、实际不完整的正式文件。

Claude Code、Codex、Pi Mono 也都有类似“不急着物化空会话”的处理，只是实现方式不同。这个细节很小，但对长期使用体验影响很大。

## 恢复路径：checkpoint + tail events

纯 Event Sourcing 的恢复方式很简单：从第一行开始 replay 到最后一行。

这个方案正确，但会随着会话变长越来越慢。Astrcode 的缓解方式是 checkpoint。

checkpoint 里保存的不是单一 message list，而是恢复会话需要的关键投影状态：

- `AgentState`：模型上下文相关状态，比如 messages、phase、mode、turn count。
- `ProjectionRegistrySnapshot`：多投影注册表状态，比如 child nodes、active tasks、input queue 投影索引、turn projections。
- `checkpoint_storage_seq`：快照覆盖到的最后一个事件序号。

恢复时流程是：

1. 如果没有 checkpoint，就读完整 EventLog。
2. 如果有 checkpoint，先加载 snapshot/marker。
3. 再读取 `storage_seq > checkpoint_storage_seq` 的 tail events。
4. 用 checkpoint 状态加 tail replay 得到最新状态。

checkpoint 持久化时还会做一件关键的事：重写 EventLog，只保留 checkpoint 之后的 tail events。实现上会先暂停并 drain 当前 `BatchAppender`，关闭旧 log handle，写 snapshot 和 marker，再把 tail events 写到临时 log，rename 原 log 为 backup，最后把 rewritten log 提升为正式 log。

这让 checkpoint 不只是“加速恢复”，也顺手控制了日志膨胀。

## 投影：同一事实流派生多个状态

Astrcode 的 `AgentStateProjector` 是典型的 fold：给它事件，它更新当前 Agent state。

它不会把所有事件都塞进模型上下文。例如：

- `AssistantDelta`、`ToolCallDelta`、`ThinkingDelta` 这类高频中间态不会污染最终上下文。
- `AssistantFinal` 才会落成助手消息。
- `ToolCall` 和 `ToolResult` 会形成工具调用与结果。
- `CompactApplied` 会根据 `messages_removed` 或 preserved turns，把旧上下文折叠成 summary。
- 子任务事件不会混入父会话上下文，独立子 session 才会投影到自己的状态。

这个投影层是 Astrcode EventLog 的价值核心：事件可以很细，模型上下文可以很干净。UI 想要流式状态，审计想要完整过程，模型想要最终上下文，它们不需要抢同一个数据结构。

## 并发：turn lock 控制同一会话的活跃执行

EventLog 还需要解决一个现实问题：同一个 session 不能被两个 turn 同时乱写。

Astrcode 用 OS 文件锁实现了 per-session turn lock，并写一个 `active-turn.json` 作为可读的 busy metadata。获取锁失败时，调用方不仅知道“忙”，还可以读到当前活跃 turn 的信息。

锁释放时会清理 metadata。读取 metadata 有短暂重试，用来处理锁释放和文件删除之间的竞态。

这不是 Event Sourcing 理论里最显眼的部分，但对 CLI 工具非常关键。没有这层，resume、并发输入、后台任务、子 Agent 都容易把同一条事件流写成不可解释的交错状态。

## 优点一：一个事实源，多种读模型

Transcript 的事实源通常是 messages。messages 对模型很友好，但对系统不够友好。

例如一次工具调用，在 transcript 里可能只是 assistant message 里的 tool call，加上后面的 tool result。可是在系统里，它还关联：

- 工具调用开始时间和结束时间
- 流式 delta
- 大结果是否被外置引用
- 是否属于子 Agent
- 是否影响 active task
- 是否应该出现在 UI timeline
- 是否应该进入模型上下文
- 是否被 compaction 清理

如果只存 messages，这些信息要么被塞进 message 的扩展字段，要么散落在多个 sidecar 文件里。Astrcode 用 EventLog 把这些都变成一条条事实，再由不同投影消费。

这就是 EventLog 最大的优点：它不急着把世界压成聊天记录。

## 优点二：可审计、可解释、可恢复

当系统出问题时，我想知道的不只是“最后上下文是什么”，而是：

- 哪个 turn 改了模式？
- 哪个 tool result 被引用外置了？
- compaction 到底删了哪些消息？
- 子 Agent 的输出什么时候进入父会话？
- 用户输入是在 turn 前排队，还是 turn 中插入？

typed event stream 可以回答这些问题。它让系统拥有审计轨迹，而不是只有最终状态。

这对 Agent 系统尤其重要，因为 bug 经常不在单个 message，而在多个动作之间的时序关系。

## 优点三：compaction 不再是一次不可逆覆盖

很多工具的 compaction 本质上是改写上下文：旧消息删掉，summary 加进去。这样做简单，但事后很难解释“为什么上下文变成这样”。

Astrcode 把 compaction 作为事件处理。`CompactApplied` 会记录摘要和移除范围，投影时再把旧消息折叠成 summary message。checkpoint 会保存折叠后的投影状态，但 EventLog 的设计仍然保留“compaction 曾经发生”这个事实。

再加上 checkpoint 后 tail log 重写，Astrcode 在可恢复性和日志体积之间做了折中：运行时不需要永远 replay 全量历史，但系统语义上仍然是事件驱动的。

## 缺点一：复杂度比 transcript 高很多

EventLog 的第一个缺点就是复杂。

你不再只是 append 一条 message，而是要考虑：

- 事件 schema 怎么演进
- 投影是否幂等、是否顺序敏感
- checkpoint 和 tail events 是否一致
- 哪些事件进入模型上下文，哪些只给 UI 或审计
- 子 Agent 和父 Agent 的边界在哪里
- delta 事件是否会造成日志膨胀

这套东西写对之后很舒服，没写对时也更难调。

我的缓解方式是把复杂度分层：

- 底层 `EventLog` 只管 JSONL、`storage_seq`、flush/sync、tail scan。
- `BatchAppender` 只管同一 session 的异步批写、暂停、drain。
- `FileSystemSessionRepository` 只管 EventStore 接口和 checkpoint 协调。
- `AgentStateProjector` 只管从事件折叠出模型上下文。
- `ProjectionRegistrySnapshot` 只管多投影恢复。

复杂度没有消失，但它被限制在明确边界里。

## 缺点二：写放大和 IO 压力

事件比 message 更细，天然更容易写多。尤其是流式 delta、工具输出、thinking、metrics，如果每个都同步落盘，IO 会很难看。

Astrcode 的缓解有三层：

第一层是 50ms batch。多个 append 合并成一次 `append_batch()`，底层再统一 flush/sync。

第二层是投影选择。不是所有细粒度事件都会进入模型上下文。delta 可以服务 UI，但最终上下文只吸收 final/result 类事件。

第三层是 checkpoint 后重写日志。老事件已经被快照覆盖后，正式 EventLog 只保留 tail events，避免长会话无限线性膨胀。

这不是免费午餐。batch window 会让“事件提交到真正 fsync”之间有几十毫秒窗口；checkpoint rewrite 也引入了更复杂的文件替换流程。但相比每条事件同步一次，这是更可用的工程折中。

## 缺点三：查询能力不如数据库

JSONL 非常适合 append 和顺序 replay，不适合复杂查询。

比如要查“过去 100 个 session 中失败最多的工具”“所有触发某个权限拒绝的 turn”“某个子 Agent 的耗时分布”，直接扫 JSONL 可以做，但不优雅，也不一定快。

Astrcode 当前的答案是投影：需要什么读模型，就从 EventLog 派生什么读模型。这个方向和 CQRS 一致，但也意味着以后如果分析查询变重，就应该补二级索引或数据库投影，而不是强行让 JSONL 承担所有查询。

这也是 OpenCode 选择 SQLite 的优势所在。数据库不是敌人，它只是解决了另一个问题。

## 缺点四：checkpoint 自身也有一致性成本

checkpoint 让恢复变快，但它引入了新的正确性边界：

- snapshot 要和 marker 对齐。
- marker 里的 `checkpoint_storage_seq` 要和 tail log 对齐。
- rewrite log 时不能和正在写入的 appender 竞争。
- rename/backup/cleanup 要处理异常中断。

Astrcode 用 `pause_and_drain()` 在 checkpoint 前暂停写入并清空队列，关闭旧 EventLog handle，再做 snapshot 和 log rewrite。这样可以避免“正在 append 的同时重写文件”的竞态。

仍然有一个现实细节：Windows 上目录 fsync 能力有限，所以 checkpoint 的目录同步是 best-effort。对桌面 CLI 来说这是可接受的风险，但如果要上更高可靠性场景，需要进一步增强 crash consistency 测试和恢复策略。

## 横向对比

下面这个表不是功能强弱排名，而是底层持久化模型的区别。

| 工具 | 持久化形态 | 当前状态怎么来 | 写入策略 | 分支/压缩 | 最强点 | 主要代价 |
| --- | --- | --- | --- | --- | --- | --- |
| Astrcode | JSONL typed events + checkpoint snapshot | checkpoint + tail events 投影 | per-session 50ms batch，batch 后 flush/sync | `CompactApplied` 事件 + checkpoint tail rewrite | 一个事实源派生多个状态，适合多 Agent 和审计 | 实现复杂，schema/projection/checkpoint 都要维护 |
| Claude Code | JSONL transcript，带 `uuid`/`parentUuid` | 从 leaf 沿 parent chain 恢复 | 本地约 100ms flush，remote 更短窗口，metadata tail 优化 | 依赖 parent chain、resume loader、precompact/repair 逻辑 | resume、兼容、metadata、远端场景非常成熟 | transcript loader 复杂度很高，很多修复逻辑耦合在格式里 |
| Codex | JSONL rollout + SQLite 状态索引 | rollout items 重建，结合 compacted replacement history | 异步 mpsc writer，逐行 flush，首次 persist 后物化文件 | `Compacted`、`TurnContext`、rollback/reconstruction | 写入异步化和 session 列表索引做得稳 | 更贴近 response item 语义，不是通用 domain event log |
| Kimi CLI | `context.jsonl` + `wire.jsonl` + `state.json` | context replay + wire/state 辅助 | aiofiles append，checkpoint/revert 时 rotate/rewrite | checkpoint、revert、fork 都很直观 | 文件拆分清晰，可读、可调试 | 双日志可能漂移，没有统一 sequence 和强投影边界 |
| Pi Mono | session JSONL tree，entry 有 `id`/`parentId` | 从当前 leaf 走 parent path | `appendFileSync`，有延迟物化空会话处理 | branch、branch summary、compaction 是一等概念 | 会话树和分支体验非常自然 | 依赖全文件索引和同步 append，durability 不是核心 |
| OpenCode | SQLite 表：session/message/part/todo/permission | SQL 查询 + MessageV2 stream | SQLite WAL，`synchronous=NORMAL`，upsert 后发 bus event | fork 复制 message/part，compaction 更新 part 状态并写 summary | 查询、分页、删除、UI 集成很强 | 不是 append-only 事实流，审计和纯 replay 能力弱一些 |

## 和 Claude Code 的差异

Claude Code 的 transcript 很成熟。它用 `uuid` 和 `parentUuid` 把消息组织成链，resume 时可以从 leaf 追溯到 root。它还有大量工程化细节：metadata lite loading、head/tail 读取、远端 flush、历史兼容、interrupted tool use 修复、precompact 处理等。

Claude Code 的优势是产品级恢复体验。它不是一个幼稚的“读完整 JSONL 然后塞回模型”的实现，而是围绕真实用户场景打磨过的 transcript 系统。

但从架构表达力上看，它仍然以 transcript/message 为中心。很多运行态修复逻辑会进入 loader：孤立 thinking、未完成 tool use、空 assistant、parent chain、metadata tail、老版本 progress entry。这些都能工作，但格式本身承载了很多历史包袱。

Astrcode 的取舍相反：把业务事实前置为事件，把 transcript 变成投影。这样多投影更自然，但前期工程量更大。

## 和 Codex 的差异

Codex 的 rollout 也很接近事件日志。它会保存 session metadata、response item、event message、turn context、compacted replacement history 等，并用异步 writer 通过 channel 写入 JSONL。同时它还有 SQLite state DB 做 session 列表和路径修复。

Codex 的强项是异步写入和产品运行所需的索引状态。它的 reconstruction 也很有意思：会从 rollout 中找到最新 compaction replacement history，再重放之后的 suffix。

差异在于语义边界。Codex rollout 更像“模型响应与 Codex runtime item 的记录”，Astrcode EventLog 更像“会话领域事件”。前者贴近 OpenAI response item 和 turn context，后者贴近 Agent 系统里的动作事实。

如果目标是把模型交互完整保存下来，Codex 的 rollout 很直接。如果目标是让多 Agent、协作、输入队列、模式切换、工具引用、checkpoint 都从同一事实源生长出来，Astrcode 的 event sourcing 更顺手。

## 和 Kimi CLI 的差异

Kimi CLI 的设计非常清晰：`context.jsonl` 存模型上下文，`wire.jsonl` 存 UI/protocol 事件，`state.json` 存 mutable session state。

这个拆法很容易理解，也很容易手工排查。context 里有 `_usage`、`_checkpoint` 这样的特殊 role，wire 里有 metadata header 和 turn records，state 单独原子写。fork 时截断 wire 和 context，也很好理解。

它的弱点来自“双日志”：context 和 wire 是两个事实源，长期看需要靠约定保持一致。没有统一 `storage_seq` 后，跨文件恢复、审计、对齐 turn 边界都会更依赖实现细节。

Astrcode 用一个 typed EventLog 承载事实，再从中投影出 context 和其他状态。这样一致性边界更集中，但调试时不如 Kimi 的三文件模型直观。

## 和 Pi Mono 的差异

Pi Mono 的 session manager 把会话做成一棵树。每个 entry 有 `id`、`parentId`、timestamp，entry 类型包括 message、compaction、branch summary、model change、label 等。构建上下文时，从当前 leaf 沿 parent path 往上走，再处理 compaction 和 branch summary。

这个模型非常适合 branch/fork。它比普通 transcript 更有结构，也比 Claude Code 的 parent chain 更直接表达“会话树”。

但它的事实仍然主要围绕 session entry/message tree，而不是广义 runtime event。它更适合管理分支对话，不一定适合承载多 Agent runtime 的所有状态变化。

Astrcode 也能表达分支和子任务，但它不是把 parent-child message tree 当成唯一骨架，而是把 branch、child、mode、tool、compact 等都作为事件事实，让不同投影各自组织。

## 和 OpenCode 的差异

OpenCode 选择 SQLite。它把 session、message、part、todo、permission 放进表里，message part 类型非常丰富：text、reasoning、file、tool、snapshot、patch、compaction、subtask、retry、step-start/finish 等。读取时可以分页 stream，fork 时复制 message/part，compaction 时可以直接更新 part 状态。

这在 app/server 形态里非常合理。SQLite 的查询、索引、删除、分页、关联数据管理都比 JSONL 强太多。OpenCode 还用 WAL 和 bus event，把持久化和运行时通知连接起来。

代价是它不是纯 append-only event sourcing。状态会被 upsert/update，compaction 会修改 part，fork 会复制数据。对于 UI 和查询来说这是优势；对于审计和“从事实流重放出所有状态”来说，它没有 Astrcode 那么纯。

所以这不是谁更先进的问题，而是目标不同：OpenCode 更像数据库驱动的应用状态，Astrcode 更像事件驱动的 Agent runtime。

## 为什么 Astrcode 仍然值得用 EventLog

如果 Astrcode 只想做一个简单聊天工具，我不会选现在这套设计。

但 Astrcode 的目标不是只保存聊天记录。它要处理：

- 多 Agent 与子任务
- 模式切换和策略执行
- 工具调用、工具结果外置引用
- compact 后的上下文恢复
- 输入队列和 active task
- UI timeline 与模型上下文分离
- 崩溃后恢复和审计

这些需求叠在一起后，message transcript 会逐渐变成一个装满各种扩展字段的大对象。每加一个能力，就要问“这个字段放 message 里、state 里、metadata 里，还是另一个 sidecar 文件里？”

EventLog 的好处是把问题换成：“这是不是一个事实？如果是，就记录成事件。哪个模块需要它，就写投影。”

这个模型更适合长期演进。

## 我已经做的缓解

为了让 EventLog 不停留在架构洁癖上，Astrcode 里已经做了几类工程缓解。

第一，写入层有批处理。50ms batch window 把高频 append 合并，底层仍然在 batch 后 flush/sync。

第二，首事件原子创建。会话文件只有在第一条事件成功写入后才 rename 成正式文件，避免空 session 和半初始化 session。

第三，checkpoint 不只是快照。它保存核心投影状态，并把 EventLog 重写成 tail log，降低恢复成本和日志体积。

第四，checkpoint 前 pause/drain appender。这样 rewrite log 不会和正在进行的 append 竞争。

第五，恢复用 `storage_seq` 作为边界。checkpoint 覆盖到哪个事件、tail 从哪里开始，都有明确序号。

第六，打开 EventLog 时有 tail scan 优化。大文件不需要为了拿最后一个 `storage_seq` 每次全量扫描。

第七，turn lock 控制同一 session 的活跃执行。它把并发写入问题提前挡住，而不是等日志乱了再修。

第八，投影层主动过滤高频中间态。模型上下文只吸收它需要的稳定事件，UI 和审计可以看更细的事件。

## 还可以继续改进的地方

我认为 Astrcode 现在的方向是对的，但还有几个值得继续加强的点。

第一，schema 演进需要更明确的版本策略。typed event 一旦长期落盘，就需要 upcaster 或兼容层，而不是只靠 serde 默认值。

第二，可以给 JSONL 行增加 checksum 或更强的截断恢复策略。现在 JSONL 解析可以处理部分问题，但长期看，明确的 corruption policy 会更稳。

第三，分析型查询应该走二级索引或数据库投影。EventLog 不应该硬扛所有查询。

第四，checkpoint crash consistency 还可以继续压测。尤其是 Windows 上目录 fsync best-effort 的边界，需要用故障注入验证最坏情况。

第五，batch policy 可以根据事件类型调节。比如用户关键事件更快落盘，delta 类事件更积极合并。

## 结语

这几套工具的设计都不是随便写的。

Claude Code 把 transcript resume 做到了很成熟；Codex 的 rollout 和 state DB 很适合它的运行模型；Kimi CLI 的 context/wire/state 拆分非常易懂；Pi Mono 的 parent tree 对分支体验很友好；OpenCode 用 SQLite 换来了强查询和应用状态管理。

Astrcode 的 EventLog 选择的是另一种重心：把 Agent runtime 的事实保存下来，再由投影生成不同状态。它的成本更高，但它解决的是 transcript 和单一状态文件越做越重之后的问题。

我的判断是：对 Astrcode 这种多 Agent、可恢复、可审计、上下文和 UI 状态需要分离的系统，EventLog 是值得的。关键不只是“用了 Event Sourcing”，而是有没有把它落成可运行的工程系统：批量写入、checkpoint、tail replay、turn lock、原子创建、投影快照。没有这些缓解，EventLog 只是漂亮概念；有了这些，它才真的能支撑长期演进。

## 代码依据

本文分析基于以下本地源码路径：

- `D:\GitObjectsOwn\Astrcode\crates\adapter-storage\src\session\event_log.rs`
- `D:\GitObjectsOwn\Astrcode\crates\adapter-storage\src\session\batch_appender.rs`
- `D:\GitObjectsOwn\Astrcode\crates\adapter-storage\src\session\checkpoint.rs`
- `D:\GitObjectsOwn\Astrcode\crates\adapter-storage\src\session\repository.rs`
- `D:\GitObjectsOwn\Astrcode\crates\adapter-storage\src\session\turn_lock.rs`
- `D:\GitObjectsOwn\Astrcode\crates\host-session\src\projection\agent_state.rs`
- `D:\GitObjectsOwn\claude-code-sourcemap\restored-src\src\utils\sessionStorage.ts`
- `D:\GitObjectsOwn\claude-code-sourcemap\restored-src\src\utils\conversationRecovery.ts`
- `D:\GitObjectsOwn\codex\codex-rs\rollout\src\recorder.rs`
- `D:\GitObjectsOwn\codex\codex-rs\rollout\src\state_db.rs`
- `D:\GitObjectsOwn\kimi-cli\src\kimi_cli\session.py`
- `D:\GitObjectsOwn\kimi-cli\src\kimi_cli\soul\context.py`
- `D:\GitObjectsOwn\kimi-cli\src\kimi_cli\wire\file.py`
- `D:\GitObjectsOwn\pi-mono\packages\coding-agent\src\core\session-manager.ts`
- `D:\GitObjectsOwn\opencode\packages\opencode\src\storage\db.ts`
- `D:\GitObjectsOwn\opencode\packages\opencode\src\session\index.ts`
- `D:\GitObjectsOwn\opencode\packages\opencode\src\session\message-v2.ts`
