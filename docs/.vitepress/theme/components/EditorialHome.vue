<script setup>
import { ref, computed } from 'vue'
import { data as realPosts } from '../../../blog/posts.data.mts' // VitePress 构建时自动爬取的博客数据
import Sidebar from './Sidebar.vue'
import SearchBar from './SearchBar.vue'
import PostList from './PostList.vue'

// === 数据来源：真实 Markdown 数据 ===
const posts = realPosts.map(post => ({
  id: post.url,
  title: post.title,
  date: post.date
    ? new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
    : '',
  author: 'whatevertogo',
  summary: post.excerpt || '这篇文章暂无摘要与预览，点击阅读完整内容。',
  category: post.category || 'Uncategorized',
  tags: post.tags || [],
  url: post.url,
}))

// 自动提取所有类别
const categories = [
  ...new Set(posts.map(p => p.category).filter(Boolean)),
].map(c => ({ name: c, subcategories: [] }))

// 热门标签（取前 5 个）
const hotTags = [...new Set(posts.flatMap(p => p.tags))].slice(0, 5)

// 状态管理
const activeCategory = ref(null)
const searchQuery = ref('')

/** 按分类 + 关键词过滤 */
const filteredPosts = computed(() =>
  posts.filter(post => {
    const matchesCategory = activeCategory.value
      ? post.category === activeCategory.value
      : true
    const q = searchQuery.value.toLowerCase()
    const matchesSearch =
      !q ||
      post.title.toLowerCase().includes(q) ||
      post.summary.toLowerCase().includes(q) ||
      post.tags.some(tag => tag.toLowerCase().includes(q))
    return matchesCategory && matchesSearch
  }),
)

/** 处理分类变更 */
const handleCategoryChange = (catName) => {
  activeCategory.value = catName
}
</script>

<template>
  <div class="min-h-screen bg-paper text-ink font-sans flex selection:bg-paper-dark selection:text-ink">
    <Sidebar
      :categories="categories"
      :active-category="activeCategory"
      @category-change="handleCategoryChange"
    />

    <main class="flex-1 max-w-5xl mx-auto px-6 py-8 md:px-14 md:py-12 w-full">
      <div class="md:hidden flex items-center justify-between border-b border-paper-dark pb-4 mb-8">
        <h1 class="font-serif text-xl font-bold text-ink">whatevertogo</h1>
        <button class="border border-paper-dark px-3 py-1 text-sm font-medium uppercase tracking-wide">
          Menu
        </button>
      </div>

      <SearchBar
        :hot-tags="hotTags"
        :active-category="activeCategory"
        :filtered-count="filteredPosts.length"
        v-model="searchQuery"
      />

      <PostList :posts="filteredPosts" />
    </main>
  </div>
</template>
