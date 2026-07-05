---
publish: true
title: "PR Review Agent 的设计"
date: 2026-07-05
category: "Astrcodey"
tags:
  - AI 编程工具
  - 架构设计
  - 插件系统
description: "模型负责提意见，插件负责不让它乱发评论。"
---

## 引言

最近写一个 PR Review Agent。写之前想得挺简单：监听 GitHub PR，丢给 agent 看一下，然后把 review 发回去。

真写起来才发现，最麻烦的不是让模型看代码。模型当然会看，也会说得很像那么回事。麻烦的是它会把不确定的东西说得很肯定，比如编一个行号，或者把一个只能算提醒的问题写成 blocker。

所以这个插件的设计核心不是“让 AI 自动审代码”。我现在越来越讨厌这种大词。它更像是一个很啰嗦的 worker：把 PR 拉下来，让模型提候选意见，然后自己检查一遍，能发的再发，不能发的收进 summary。

模型负责提意见。插件负责不信它。

## 一个插件

这个东西是外部 s5r 插件。Astrcodey 启动它的时候，实际跑的是：

```bash
astrcode-pr-review-agent s5r
```

启动以后它会注册一个 `/pr-review-agent` 命令和一个 status tool。真正干活的是后台 poll loop。配置开了 webhook 的话，它还会起一个本地 HTTP receiver。

也就是说，它更像一个被 Astrcodey 托管的小服务，而不是页面上的一个按钮。

目前有两个入口：

- PR 评论里提到配置的账号，比如 `@whatevertogo review it`
- 配置仓库里新开的 PR

自动 review 新 PR 这件事我加了一个保护：第一次启用的时候，只 baseline 已经打开的 PR，不立刻全部跑一遍。不然一个仓库几十个 open PR，插件刚上线就开始刷屏，那画面有点丢人。

## 队列先行

GitHub 事件进来以后，不会马上开始 review。它会先进入本地状态：

```text
GitHub event / polling
        |
        v
state queue
        |
        v
review worker
```

状态都写在 `~/.astrcode/pr-review-agent/state.json`。这里面有处理过的 comment、见过的 PR、webhook delivery、正在排队的事件、PR session、review memory。

听起来土，但很好用。

webhook 和 polling 可能同时来，不能一起改 state。插件会抢 `run.lock`，抢到了就处理，抢不到的 webhook 事件先写到 spool 文件，下一轮 poll 再导入。没有 Redis，没有数据库，也没有额外 daemon。一个本地 JSON 文件加一个锁，够了。

我挺喜欢这种设计。它不酷，但失败模式很清楚。

## 为什么一个 PR 一个 session

每个 PR 都会绑定一个 Astrcode session。

第一次有人触发 review，插件创建 session。之后同一个 PR 再有人评论，比如“重点看看并发那块”，插件继续把内容塞进同一个 session。

这里的原因很现实。PR review 通常不是一次性的。第一次 review 可能发现几个问题，作者改完以后又 push，一会儿又有人让你看测试。每次都新建 session，模型就失忆了，只能重新读一遍上下文。

session 复用也不是绝对安全。旧 session 可能上下文太脏，或者 Astrcodey 服务重启以后状态不完整。所以代码里做了兜底：复用失败就重建 session，再跑一次。

## review 不要一次跑完

一开始我也想过，直接把整个 PR 拼成一个 prompt，让模型一次输出所有 finding。

后来放弃了。大 PR 会爆上下文，小 PR 也会因为信息太杂导致模型乱抓重点。一次性 review 看起来简单，结果很不可控。

现在默认走 coverage-first：

```text
orientation pass
file shard pass 1
file shard pass 2
...
global pass
merge outputs
final report
```

orientation pass 先看 PR 元信息、仓库记忆和文件清单。它不急着评论，先建立一个大概判断。

file shard pass 按文件分片。每一片都要求模型返回 `files_reviewed`，插件用这个判断哪些文件真的被看过。模型如果漏看了某个文件，coverage 里会留下记录。

global pass 再看跨文件风险。比如状态迁移、API contract、并发边界，这些东西只看一个文件经常看不出来。

这个流程没有很神秘，就是把“一次性看完”拆成几次比较可控的检查。

## 强制 JSON

这应该是整个插件里最重要的决定。

模型不能直接写 GitHub 评论。它只能返回 JSON，大概是这些字段：

```text
confirmed_findings
advisory_findings
observations
verification
residual_risk
summary
```

真正能发 inline comment 的只有 finding。每个 finding 还要过校验：

- `severity` 是不是 P0/P1/P2/P3
- `confidence` 能不能归一化
- `path`、`side`、`line` 有没有
- 这个 line 是不是 GitHub diff 里能评论的位置
- 有没有重复
- 数量有没有超过 `max_inline_comments`

GitHub inline comment 对位置很挑。模型说“第 42 行有问题”不够，42 行必须真的在 PR diff 的 commentable line 里。否则 API 直接拒绝。

插件会尝试找附近的 RIGHT 行，但不会硬造一个位置。宁愿少发一条，也不要在错误位置上装作很懂。

## 发评论要克制

默认最多发 12 条 inline comments。P3 通常只进 summary，除非触发评论明显是在要 nitpick。

这不是为了显得保守，是为了不烦人。

自动 review 很容易变成噪音。它只要连续几次刷出一堆低价值评论，大家就会开始忽略它。我的想法是，inline comment 应该留给真正需要作者停下来看的问题。其他东西放 summary，读的人自己决定要不要管。

发布时分两层：

第一层用 GitHub Pull Request Review API 发 inline comments。

第二层发 final summary，里面写这次 review 的 session、触发来源、head SHA、inline 数量、unplaced findings、验证信息和剩余风险。

如果 GitHub 拒绝 inline payload，插件不会静默失败。它会把这些 finding 转成 unplaced finding，写进 summary。难看一点，但至少人能看到。

## memory 不只是给模型看的

插件有 Markdown memory：

```text
memory/repos/<owner>__<repo>/index.md
memory/repos/<owner>__<repo>/pr-<number>.md
```

repo index 记仓库层面的 review 历史。PR memory 记单个 PR 的历史。prompt 会带上这些内容，让模型知道之前说过什么。

还有一份结构化 memory 在 `state.json` 里。这里会保存已经发布过的 finding fingerprint。

这个比 Markdown memory 更硬。模型下次又提同一个问题，插件会发现 fingerprint 已经存在，然后把它打成 already posted。否则同一个 PR 每 push 一次，agent 就重复提醒一遍，谁受得了。

## webhook 和 polling

webhook 很快，但我不想只靠 webhook。

webhook 路径大概是：

```text
GitHub webhook -> HMAC 校验 -> delivery 去重 -> event queue
```

polling 做的事情更多：

- 检查 `gh` 是否登录
- 搜索提到配置账号的 open PR
- 拉取配置仓库的 open PR
- 做新 PR 自动 review 的 baseline
- 清理旧 worktree 和旧 session
- 恢复卡住的 running review

webhook 像门铃，polling 像巡逻。门铃响了最好，但没响也不能假装什么都没发生。

## prompt 编进二进制

review 用的几个 prompt 在 `prompts/` 目录里，然后通过 `include_str!` 编进 binary。

我不想让这个插件还依赖某个本地 skill 目录。插件安装以后，最好只依赖这些东西：插件系统、`gh`、Astrcodey、GitHub。路径依赖越少，部署时越少出现“我这里明明可以”的问题。

这也符合我对内置插件的理解：能靠插件包自己解决的，就不要去摸项目里的其他东西。

## 我现在还不满意什么

最大的问题是 `review.rs` 太长。

它现在管 checkout、上下文收集、prompt、JSON 修复、finding 校验、GitHub 发布、memory 更新。功能上能跑，测试也能覆盖一部分，但读起来已经有点重。

后面我大概会拆成几块：

- `github_context`：PR 元信息、diff、checks
- `review_pipeline`：pass 规划和输出合并
- `finding_validation`：finding 到 diff line 的校验
- `publisher`：GitHub review 和 final comment
- `memory`：repo/PR 记忆

不过我不想为了拆而拆。worker 这类代码很容易拆成一堆名字好听的小模块，最后调试时还是要来回跳。等失败案例再多一点，边界会更自然。

## 结尾

这个 PR Review Agent 最让我在意的一点，是它没有把最后一道门交给模型。

模型可以说“这里可能有问题”。插件要问：行号对吗？严重性够吗？以前发过吗？会不会刷屏？GitHub 接不接受这个位置？

这些问题不适合交给模型自己回答。它太会圆了。

所以最后还是那句话：模型负责提意见，插件负责不信它。自动化 review 要是真的想进工程流程，至少得先学会这一点。
