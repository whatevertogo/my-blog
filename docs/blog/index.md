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
  <div v-for="post in posts" :key="post.url">
    <a :href="post.url" class="post-item">
      <div class="post-title">{{ post.title }}</div>
      <div class="post-meta">
        <span class="post-date">📅 {{ formatDate(post.date) }}</span>
        <span v-if="post.category" class="post-category">📚 {{ post.category }}</span>
        <span v-if="post.tags && post.tags.length > 0" class="post-tags">
          <span class="tag" v-for="tag in post.tags" :key="tag">🏷️ {{ tag }}</span>
        </span>
      </div>
    </a>
  </div>
</div>