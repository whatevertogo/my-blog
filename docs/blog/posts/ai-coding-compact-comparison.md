---
title: "一、agentloop智能体循环"
date: 2026-05-09
category: "Astrcodey"
tags:
  - AI 编程工具
description: "agentloop是agent的地基，没有agentloop就没有agent"
---

## 引言

AI已经有足够的学识和能力了，但是如何让ai真正地持续工作，完成复杂的任务呢？这就是agent的意义所在。agentloop又是agent的基础，可以说agentloop让agent能够真正的可自我反馈的循环的进行目标导向的工作。

## what is agentloop

Agent loop 通常可译为“智能体循环”，指智能体围绕目标反复执行“观察状态 -> 决策/规划 -> 行动 -> 接收反馈 -> 更新状态 -> 继续/停止”的控制流。

ReAct 是早期经典范式之一，论文 arXiv 版本是 2022 年，ICLR 2023 发表。它提出让 LLM 交替生成推理轨迹和任务相关动作，即 Reason -> Act -> Observe -> Repeat。它不是“直到 LLM 不调用工具不输出内容”为止，而是直到模型给出最终答案、任务完成、达到停止条件，或外部控制器中断。通俗来讲就是边思考边行动

Plan-and-Execute 在 ReAct 风格之上更强调“先规划、再执行”：先由 Planner 生成计划，再由 Executor 执行一个或多个子任务；执行过程中可根据观察结果重规划或修正，直到计划完成或任务终止。通俗来讲就是思考完了规范完了再行动

Reflexion 则补充了跨尝试的反思机制：执行任务 -> 根据失败、得分低或外部反馈生成文字反思 -> 将反思写入记忆(上下文或者记忆) -> 下次尝试带上反思，以提升后续决策。它在 ReAct 和 Plan-and-Execute 之上提出了一种让llm反思来获取更好结构的理论，而是可以与它们组合使用的一种反馈/记忆增强机制。

## why agentloop

1. 单次llm调用只适合聊天，不适合执行多步任务。

Agent loop 可以：
```
不知道 -> 搜索/读文件/查数据库 -> 看到结果 -> 再判断
```

2. 把复杂任务拆成多步

很多任务不能一步完成：
```
理解需求-> 制定计划 -> 执行第一步 -> 看结果 -> 执行下一步
```

3. 允许llm自主迭代，遇到错误自主修复

很多时候llm会输出一些错误的内容
```
运行测试 -> 发现错误-> 修复错误 -> 检查是否修复 -> 再次测试
```

4. 让工具调用结果能反馈给llm
   
```
运行工具 -> 获取工具结果 -> 思考 -> 进行下一步
```

## how to make agentloop

这里我给出伪代码

```rust 
async fn agent_loop(mut ctx: Context, user_input: String) -> Result<String> {
    let mut messages = vec![Message::user(user_input)];

    loop {
        // 1. 调api：调用 LLM 进行推理/决策
        let response = llm::chat(&messages).await?;

        // 2. 判断：是否需要执行动作
        match response {
            // LLM 认为任务完成，返回最终答案
            Response::Text(answer) => return Ok(answer),

            // LLM 决定调用工具
            Response::ToolCalls(calls) => {
                for call in calls {
                    // 3. 行动阶段：执行工具
                    let result = match call.tool.as_str() {
                        "read_file"   => tools::read_file(call.args["path"].as_str())?,
                        "write_file"  => tools::write_file(call.args["path"].as_str(), call.args["content"].as_str())?,
                        "run_command" => tools::run_command(call.args["cmd"].as_str()).await?,
                        "search"      => tools::search(call.args["query"].as_str()).await?,
                        _ => bail!("unknown tool: {}", call.tool),
                    };

                    // 4. 反馈阶段：将工具结果追加到上下文
                    messages.push(Message::tool_result(call.id, result));
                }
                // 5. 继续/重复：回到循环顶部，LLM 基于新上下文继续推理
                continue;
            }
        }
    }
}
```

但是我的项目不同，我在里面基础的设计做了扩展和创新。以下是基于 Astrcodey AgentLoop 真实实现简化而来的伪代码：

```rust
async fn process_prompt(&self, user_text: &str, event_log: &EventLog) -> Result<AgentTurnOutput> {
    // EventLog 是唯一的数据源，messages 是从 event_log projection 出来的上下文视图
    let history: Vec<LlmMessage> = event_log.project();
    let mut context = vec![system_prompt, ...history, LlmMessage::user(user_text)];
    let mut tools = collect_available_tools();

    loop {
        // 1. 上下文准备（含自动压缩）
        //    检查 token 是否接近上限 -> 触发 auto compact
        //    先尝试用 LLM 做摘要压缩，失败则 fallback 到确定性截断
        let (system_msgs, prepared) = self.prepare_provider_context(&mut context, &tools).await?;

        // 2. 扩展钩子：BeforeProviderRequest
        //    扩展可以放行、修改消息、或直接阻断请求
        //    钩子贯穿了agentloop的插件可扩展的整个生命周期
        let send_context = self.apply_before_provider_request_hook(system_msgs, prepared).await?;

        // 3. 调用 LLM，流式消费响应
        let rx = self.llm.generate(send_context, tools).await?;
        let outcome = consume_llm_stream(rx).await?;
        //    流式事件：ContentDelta -> 实时转发给客户端
        //             ToolCallStart/Delta -> 积累工具调用
        //             Done -> 返回 StreamOutcome

        match outcome {
            // 4a. LLM 回复了文本（无工具调用）
            //    文本也写回 event_log，下一轮 process_prompt 的 projection 会包含它
            StreamOutcome::Complete { text, finish_reason } => {
                event_log.append(Event::AssistantMessage(text));
                return Ok(AgentTurnOutput { text, finish_reason, .. });
            }
            // 4b. LLM 决定调用工具
            //    工具调用和结果都写回 event_log，然后继续循环
            StreamOutcome::ToolCalls { tool_calls, .. } => {
                let prepared = self.tools.prepare_tool_calls(&tool_calls).await?;
                // 执行工具，结果追加到 event_log
                let results = self.tools.execute_and_commit(prepared, &mut context).await?;
                event_log.append(Event::ToolCalls(results));
                continue; // 回到 loop 顶部，LLM 基于新上下文继续推理
            }
        }
    }
}
```

## agentloop 状态管理

1. LLM 本身无状态，也就是说llm每次被调用都是失忆的，所有上下文必须显式传入。没有状态管理，Agent 就无法：

- 记住之前做了什么
- 知道任务进行到哪一步
- 在出错后从断点恢复

2. 长任务的可靠性
Agent 执行复杂任务往往需要多轮工具调用（几十步甚至几百步）。中途一旦：

网络超时
LLM 报错
工具调用失败

没有状态 → 从头重来，代价极大。
3. 并发与多 Agent 协作
多个子 Agent 并行工作时，共享状态需要协调：

谁在做哪个子任务？
哪些结果已完成？
如何合并结果？

### 常见的状态管理策略

| 维度 | 内容 | 难点 |
|---|---|---|
| 对话历史 | messages 数组的增长与裁剪 | Context window 限制 |
| 任务状态 | 当前步骤、完成情况、待办项 | 持久化与恢复 |
| 工具结果 | 每次 `tool_use` 的输出缓存 | 避免重复调用 |
| 错误状态 | 失败次数、重试策略 | 防止死循环 |
| 内存分层 | 工作记忆 / 情景记忆 / 长期记忆 | 信息的存取效率 |


### claude code 的状态

状态机 State 类型 (第 204-217 行)

  type State = {
    messages: Message[]                      // 累积的对话消息
    toolUseContext: ToolUseContext            // 工具调用上下文（工具列表、权限、agentId 等）
    autoCompactTracking: ...                  // 自动压缩追踪
    maxOutputTokensRecoveryCount: number      // 输出 token 超限恢复次数
    hasAttemptedReactiveCompact: boolean      // 是否尝试过反应式压缩
    maxOutputTokensOverride: number | undefined // 输出 token 上限覆盖
    pendingToolUseSummary: ...                // 待生成的工具调用摘要
    stopHookActive: boolean | undefined       // stop hook 是否激活
    turnCount: number                         // 当前轮次计数
    transition: Continue | undefined          // 上一轮为何 continue（用于测试断言）
  }
  除了这个还有很多很多的状态机

### codex的状态

codex也有很多很多的状态机


### 我的astrcodey的状态

把状态全部藏在eventlog中，eventlog是唯一的数据源，agentloop的每一步都基于eventlog的projection来进行。我不管理agent的状态，而是通过eventlog和projection来推断当前agent的状态，这样能大幅度减少项目复杂度


## 设计理念

让session eventlog来记录agent每次的状态，projection来推断状态，agentloop只使用不管理，agentloop的生命周期由hooks表达，虽然会增加前期eventlog和projection的设计复杂度，要考虑各种方法降低性能损耗，但是能大幅度降低agentloop的复杂度，让agentloop专注于控制流和生命周期管理，hooks专注于扩展性，eventlog和projection专注于状态管理，这样的分工能让整个项目更清晰，更易维护，也更易扩展。