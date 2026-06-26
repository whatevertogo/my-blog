<script setup>
import { ref, computed, onMounted } from 'vue'
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

// Hero 分割线入场动画触发
const heroDividerReady = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    heroDividerReady.value = true
  })
})
</script>

<template>
  <div class="min-h-screen bg-paper text-ink font-sans flex selection:bg-paper-dark selection:text-ink">
    <Sidebar
      :categories="categories"
      :active-category="activeCategory"
      @category-change="handleCategoryChange"
    />

    <main class="flex-1 max-w-5xl mx-auto px-6 py-8 md:px-14 md:py-12 w-full">
      <!-- ===== Hero 区 ===== -->
      <header class="hero mb-10 md:mb-14">
        <p class="hero-kicker font-sans text-xs uppercase tracking-[0.3em] text-ink-faint mb-4">
          Engineering &amp; Notes
        </p>
        <h1 class="hero-title font-serif text-ink">
          whatevertogo
        </h1>
        <p class="hero-sub font-serif text-ink-light">
          在代码与思考之间，沉淀关于架构、AI 与工程的笔记。
        </p>
        <!-- 装饰墨线（展开动画） -->
        <div
          class="ink-divider mt-8"
          :class="{ animate: heroDividerReady }"
          style="--divider-delay: 250ms;"
        ></div>
      </header>

      <!-- 移动端简化头（与 Hero 整合，仅留 Menu 占位） -->
      <div class="md:hidden flex items-center justify-between mb-6 -mt-4">
        <span class="text-[11px] uppercase tracking-widest text-ink-faint">Publications</span>
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

<style scoped>
/* ===== Hero ===== */
.hero-kicker {
  opacity: 0;
  animation: fadeInUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.05s both;
}
.hero-title {
  font-size: clamp(2.75rem, 7vw, 4.5rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.03em;
  margin: 0 0 0.75rem;
  opacity: 0;
  animation: fadeInUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.12s both;
}
.hero-sub {
  font-size: clamp(1.05rem, 2vw, 1.25rem);
  line-height: 1.6;
  max-width: 38rem;
  opacity: 0;
  animation: fadeInUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.22s both;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
