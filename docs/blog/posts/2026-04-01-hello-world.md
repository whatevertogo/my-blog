---
title: "第一篇博客：你好 VitePress！"
date: 2026-04-01T10:00:00Z
category: "技术经验"
tags: ["VitePress", "博客", "前端"]
---

# {{ $frontmatter.title }}

这是我的第一篇博客文章，用于测试 VitePress 博客搭建效果。

## 多种功能支持

### 代码高亮展示

VitePress 内置了 [Shiki](https://shiki.style/) 代码高亮工具。下面是一个简单的 Python 代码段：

```python
def hello_world():
    print("Hello, VitePress!")

hello_world()
```

### Markdown 增强

VitePress 支持各种 Markdown 增强，例如提示框：

::: info 提示
这是文章中的一个提示块，帮助读者理解重要内容。
:::

::: warning 注意
代码可能有依赖限制或者特定的运行环境！
:::
