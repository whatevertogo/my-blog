# whatevertogo's Blog

> 在代码与思考之间，沉淀关于架构、AI 与工程的笔记。

🌐 **在线访问 / Live Site:** <https://whatevertogo.github.io/my-blog/>

---

## 简介

基于 [VitePress](https://vitepress.dev/) 构建的个人技术博客，采用 Anthropic 工程博客风格（暖白纸张 + 墨黑 + 暖棕品牌色）的精致编辑风设计。

内容涵盖 AI 编程工具、架构设计、工程实践等。

## 本地预览

```bash
npm install      # 安装依赖
npm run docs:dev # 启动本地开发服务器
```

默认地址：<http://localhost:5173/my-blog/>

## 写作

文章为 Markdown 文件，放在 `docs/blog/posts/` 下，文件头使用 frontmatter 描述元信息：

```markdown
---
title: "文章标题"
date: 2026-05-11
category: "分类名"
tags:
  - 标签1
  - 标签2
description: "一句话摘要"
---

正文从这里开始……
```

保存后推送至 `main` 分支，GitHub Actions 会自动构建并部署。

## 部署

推送到 `main` 即触发 `.github/workflows/deploy.yml`，自动发布到 GitHub Pages。

工作流也会每周重新部署一次。若仓库连续 45 天没有新提交，它会创建一个空的保活提交，避免 GitHub 因公开仓库长期无活动而在 60 天后停用定时工作流。

## License

MIT
