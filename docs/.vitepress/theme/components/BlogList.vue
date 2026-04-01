<template>
  <div class="blog-container">
    <!-- 搜索框 -->
    <div class="search-bar">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索文章标题、标签..."
        class="search-input"
      />
      <span v-if="searchQuery" class="clear-btn" @click="searchQuery = ''">✕</span>
    </div>

    <!-- 标签筛选栏 -->
    <div class="tag-filter-bar" v-if="allTags.length > 0">
      <button
        class="tag-filter-btn"
        :class="{ active: selectedTags.size === 0 }"
        @click="selectedTags.clear()"
      >全部</button>
      <button
        v-for="tag in allTags"
        :key="tag"
        class="tag-filter-btn"
        :class="{ active: selectedTags.has(tag) }"
        @click="toggleTag(tag)"
      >{{ tag }}</button>
    </div>

    <!-- 文章数量 -->
    <div class="result-count">
      共 {{ filteredPosts.length }} 篇文章
      <span v-if="selectedTags.size > 0">（已筛选 {{ [...selectedTags].join('、') }}）</span>
    </div>

    <!-- 文章列表 -->
    <div class="blog-list" v-if="filteredPosts.length > 0">
      <a v-for="post in filteredPosts" :key="post.url" :href="post.url" class="post-item">
        <div class="post-title">{{ post.title }}</div>
        <div class="post-excerpt" v-if="post.excerpt">{{ post.excerpt }}</div>
        <div class="post-meta">
          <span class="post-date">{{ formatDate(post.date) }}</span>
          <span v-if="post.category" class="post-category">{{ post.category }}</span>
          <span class="tag" v-for="tag in post.tags" :key="tag">{{ tag }}</span>
        </div>
      </a>
    </div>

    <div v-else class="no-results">
      没有找到匹配的文章
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { data as posts } from '../../../blog/posts.data.mts'

const searchQuery = ref('')
const selectedTags = ref(new Set())

const allTags = computed(() => {
  const tagSet = new Set()
  posts.forEach(p => (p.tags || []).forEach(t => tagSet.add(t)))
  return [...tagSet].sort()
})

const formatDate = (dateStr) => dateStr.split('T')[0]

function toggleTag(tag) {
  if (selectedTags.value.has(tag)) {
    selectedTags.value.delete(tag)
  } else {
    selectedTags.value.add(tag)
  }
  // 触发响应式更新
  selectedTags.value = new Set(selectedTags.value)
}

const filteredPosts = computed(() => {
  let result = posts

  // 按标签筛选（交集：文章必须包含所有选中的标签）
  if (selectedTags.value.size > 0) {
    result = result.filter(post =>
      [...selectedTags.value].every(tag => (post.tags || []).includes(tag))
    )
  }

  // 按搜索词筛选
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(post => {
      const haystack = [
        post.title,
        post.category || '',
        post.excerpt || '',
        ...(post.tags || [])
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }

  return result
})
</script>

<style scoped>
.blog-container {
  margin-top: 1rem;
}

.search-bar {
  position: relative;
  margin-bottom: 1.2rem;
}

.search-input {
  width: 100%;
  padding: 0.7rem 1rem;
  padding-right: 2.5rem;
  border-radius: 8px;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.search-input:focus {
  border-color: var(--vp-c-brand-1);
}

.search-input::placeholder {
  color: var(--vp-c-text-3);
}

.clear-btn {
  position: absolute;
  right: 0.8rem;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
  color: var(--vp-c-text-3);
  font-size: 0.9rem;
}

.clear-btn:hover {
  color: var(--vp-c-text-2);
}

.tag-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.2rem;
}

.tag-filter-btn {
  padding: 0.3rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.2s;
}

.tag-filter-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

.tag-filter-btn.active {
  background: var(--vp-c-brand-1);
  color: #18181A;
  border-color: var(--vp-c-brand-1);
  font-weight: 500;
}

.result-count {
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
  margin-bottom: 1rem;
}

.blog-list {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.post-item {
  border: 1px solid var(--vp-c-border);
  background-color: var(--vp-c-bg-alt);
  padding: 1.3rem 1.5rem;
  border-radius: 8px;
  transition: border-color 0.3s, background-color 0.3s, transform 0.3s;
  text-decoration: none;
  display: block;
}

.post-item:hover {
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-bg-elv);
  transform: translateY(-2px);
}

.post-title {
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 0.4rem;
}

.post-item:hover .post-title {
  color: var(--vp-c-brand-1);
}

.post-excerpt {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  margin-bottom: 0.6rem;
  line-height: 1.5;
}

.post-meta {
  display: flex;
  gap: 0.8rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
  align-items: center;
  flex-wrap: wrap;
}

.tag {
  display: inline-block;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  padding: 0.15rem 0.5rem;
  border-radius: 5px;
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
}

.no-results {
  text-align: center;
  color: var(--vp-c-text-3);
  padding: 3rem 0;
  font-size: 1rem;
}
</style>
