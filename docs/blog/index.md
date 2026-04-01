---
title: 博客列表
---

# 最新文章

<script setup>
import { data as posts } from './posts.data.mts'

const formatDate = (dateStr) => {
  return dateStr.split('T')[0]
}
</script>

<div class="blog-list" v-if="posts.length > 0">
  <div v-for="post in posts" :key="post.url" class="post-item">
    <a :href="post.url" class="post-title">{{ post.title }}</a>
    <div class="post-meta">
      <span class="post-date">🕒 {{ formatDate(post.date) }}</span>
      <span v-if="post.category" class="post-category">📁 {{ post.category }}</span>
      <span v-if="post.tags && post.tags.length > 0" class="post-tags">
        🔗 <span class="tag" v-for="tag in post.tags">{{ tag }}</span>
      </span>
    </div>
  </div>
</div>

<style>
.blog-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  margin-top: 2rem;
}
.post-item {
  border-bottom: 1px solid var(--vp-c-divider);
  padding-bottom: 1rem;
}
.post-title {
  font-size: 1.3rem;
  font-weight: bold;
  color: var(--vp-c-brand);
  text-decoration: none;
}
.post-title:hover {
  text-decoration: underline;
}
.post-meta {
  display: flex;
  gap: 1.2rem;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  margin-top: 0.5rem;
}
.tag {
  display: inline-block;
  background-color: var(--vp-c-bg-alt);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  margin-right: 0.3rem;
}
</style>