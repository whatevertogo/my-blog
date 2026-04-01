---
title: "claude code 的 agent loop"
date: 2026-04-02T 0:500:17Z
category: "claude code"
tags: ["agent"]
---

# {{ $frontmatter.title }}

claude code

## ref 与 reactive 的选择

在实际项目中，`ref` 更适合基础类型的响应式数据，而 `reactive` 适合对象结构。两者各有优劣，关键在于使用场景。

```typescript
const count = ref(0)
const user = reactive({ name: '张三', age: 25 })
```

## 组合式函数（Composables）

通过抽取可复用的逻辑到独立的 composables 中，我们可以在多个组件间共享状态和行为，替代了 Vue 2 时代的 Mixins 模式。

::: tip 建议
优先使用 composables 而非 Mixins，避免命名冲突和数据来源不清晰的问题。
:::
