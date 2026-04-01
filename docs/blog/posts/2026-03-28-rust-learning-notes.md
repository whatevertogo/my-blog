---
title: "Rust 学习笔记：所有权与借用"
date: 2026-03-28T09:00:00Z
category: "编程语言"
tags: ["Rust", "编程语言", "系统编程"]
---

# {{ $frontmatter.title }}

Rust 的所有权系统是它最独特的特性之一。它让 Rust 能在不需要垃圾回收的情况下保证内存安全。

## 三条核心规则

1. Rust 中每个值都有一个所有者（owner）
2. 一次只能有一个所有者
3. 当所有者离开作用域时，值被丢弃（drop）

## 借用与引用

通过引用，我们可以使用数据而不获取其所有权。不可变引用允许读取，可变引用允许修改，但不能同时存在。

```rust
fn main() {
    let s1 = String::from("hello");
    let len = calculate_length(&s1);
    println!("'{}' 的长度是 {}", s1, len);
}

fn calculate_length(s: &String) -> usize {
    s.len()
}
```

所有权系统虽然增加了学习曲线，但它从根本上消除了悬垂指针、数据竞争等内存安全问题。
