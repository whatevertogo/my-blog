---
title: "用 VitePress 搭建静态博客的完整流程"
date: 2026-03-25T16:00:00Z
category: "技术经验"
tags: ["VitePress", "前端", "部署"]
---

# {{ $frontmatter.title }}

从零开始用 VitePress 搭建一个静态博客，并部署到 GitHub Pages。整个流程比想象中简单得多。

## 初始化项目

```bash
npm init -y
npm add -D vitepress vue
```

创建基础的目录结构，添加配置文件，然后就可以开始编写内容了。

## 部署到 GitHub Pages

利用 GitHub Actions，每次推送到 main 分支时自动构建和部署。关键配置：

```yaml
- name: Build
  run: npm run docs:build
- name: Deploy
  uses: peaceiris/actions-gh-pages@v3
```

## 自定义主题

VitePress 支持深度自定义，从 CSS 变量到完全替换布局组件。配合 Tailwind CSS 可以快速实现独特的设计风格。
