---
title: 项目文档介绍
---

# 项目文档主页

在这里你可以维护和记录技术项目的详细设计文档。

与常规的博客不同，这部分的内容一般通过侧边栏导航：

```json
// config.mts 中的 Sidebar 配置
sidebar: {
  '/projects/': [
    {
      text: '示例项目',
      items: [
        { text: '项目介绍', link: '/projects/' },
        { text: '快速开始', link: '/projects/quickstart' }
      ]
    }
  ]
}
```

## 功能特点
- 结构清晰且有严格层级关系
- 可以根据不同项目设定各自的侧边栏菜单