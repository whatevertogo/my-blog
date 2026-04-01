---
title: "TypeScript 泛型：从入门到进阶"
date: 2026-03-20T11:00:00Z
category: "前端开发"
tags: ["TypeScript", "前端", "编程语言"]
---

# {{ $frontmatter.title }}

泛型是 TypeScript 中最强大的特性之一。掌握泛型能让你写出更灵活、类型更安全的代码。

## 基础泛型函数

```typescript
function identity<T>(arg: T): T {
  return arg;
}

const result = identity<string>("hello"); // 类型为 string
```

## 泛型约束

通过 `extends` 关键字，我们可以限制泛型参数必须满足某些条件：

```typescript
interface HasLength {
  length: number;
}

function getLength<T extends HasLength>(arg: T): number {
  return arg.length;
}
```

泛型在工具类型（Utility Types）中也大量使用，比如 `Partial<T>`、`Pick<T, K>` 等都是基于泛型实现的。
