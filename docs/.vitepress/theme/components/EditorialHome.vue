<script setup>
import { ref, computed, onMounted } from 'vue'
import { withBase } from 'vitepress'
import { data as realPosts } from '../../../blog/posts.data.mts'
import Sidebar from './Sidebar.vue'
import SearchBar from './SearchBar.vue'
import PostList from './PostList.vue'

// === 数据来源：真实 Markdown 数据 ===
const posts = realPosts.map((post) => ({
  id: post.url,
  title: post.title,
  date: post.date
    ? new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
    : '',
  rawDate: post.date || '1970-01-01',
  author: 'whatevertogo',
  summary: post.description || post.excerpt || '这篇文章暂无摘要与预览，点击阅读完整内容。',
  category: post.category || 'Uncategorized',
  tags: post.tags || [],
  url: post.url,
  wordCount: post.wordCount || 0,
  readingMinutes: post.readingMinutes || 1,
}))

// 大小写无关聚合分类（合并 Astrcodey / astrcodey 这类大小写差异）
const categories = computed(() => {
  const map = new Map()
  for (const post of posts) {
    const raw = (post.category || '').trim()
    if (!raw) continue
    const key = raw.toLowerCase()
    if (!map.has(key)) {
      // 优先保留首字母大写的展示形式
      map.set(key, { name: raw, count: 1 })
    } else {
      const entry = map.get(key)
      entry.count += 1
      if (/^[A-Z]/.test(raw) && !/^[A-Z]/.test(entry.name)) {
        entry.name = raw
      }
    }
  }
  return [...map.values()]
})

// 按出现频次排序取前 6 个热门标签
const hotTags = computed(() => {
  const counts = new Map()
  for (const p of posts) {
    for (const t of p.tags) {
      counts.set(t, (counts.get(t) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag]) => tag)
})

const totalWordsLabel = computed(() => {
  const sum = posts.reduce((acc, p) => acc + (p.wordCount || 0), 0)
  return sum >= 1000 ? `${(sum / 1000).toFixed(1)}k` : String(sum)
})

// 状态管理
const activeCategory = ref(null)
const selectedTag = ref(null)
const searchQuery = ref('')
const sortOrder = ref('desc')

const filteredPosts = computed(() => {
  const list = posts.filter((post) => {
    const matchesCategory = activeCategory.value
      ? (post.category || '').toLowerCase() === activeCategory.value.toLowerCase()
      : true
    const matchesTag = selectedTag.value ? post.tags.includes(selectedTag.value) : true
    const q = searchQuery.value.trim().toLowerCase()
    const matchesSearch =
      !q ||
      post.title.toLowerCase().includes(q) ||
      post.summary.toLowerCase().includes(q) ||
      post.tags.some((tag) => tag.toLowerCase().includes(q)) ||
      (post.category || '').toLowerCase().includes(q)
    return matchesCategory && matchesTag && matchesSearch
  })

  if (sortOrder.value === 'asc') {
    return [...list].sort((a, b) => +new Date(a.rawDate) - +new Date(b.rawDate))
  }
  return list
})

const handleCategoryChange = (catName) => {
  activeCategory.value = catName
}

const handleToggleTag = (tag) => {
  selectedTag.value = selectedTag.value === tag ? null : tag
}

const handleSelectCategoryFromPost = (catName) => {
  if (!catName) return
  const matched = categories.value.find((c) => c.name.toLowerCase() === catName.toLowerCase())
  activeCategory.value = matched ? matched.name : catName
}

const handleToggleSort = () => {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
}

const handleClearFilters = () => {
  activeCategory.value = null
  selectedTag.value = null
  searchQuery.value = ''
}

// Hero 分割线入场动画 + URL 查询参数同步（支持从文章页点击 tag/category 跳回过滤）
const heroDividerReady = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    heroDividerReady.value = true
  })
  const params = new URLSearchParams(window.location.search)
  const cat = params.get('category')
  const tag = params.get('tag')
  if (cat) handleSelectCategoryFromPost(cat)
  if (tag) selectedTag.value = tag
})
</script>

<template>
  <div class="min-h-screen bg-paper text-ink font-sans flex selection:bg-paper-dark selection:text-ink">
    <Sidebar
      :categories="categories"
      :active-category="activeCategory"
      :total-posts="posts.length"
      :total-words-label="totalWordsLabel"
      @category-change="handleCategoryChange"
    />

    <main class="flex-1 max-w-5xl mx-auto px-6 py-8 md:px-14 md:py-12 w-full min-w-0">
      <!-- ===== 移动端顶栏（提供页面导航与身份锚点） ===== -->
      <div class="md:hidden flex items-center justify-between border-b border-paper-dark pb-4 mb-7 font-sans text-xs uppercase tracking-widest">
        <div class="flex items-center gap-2.5">
          <img
            :src="withBase('/avatar.png')"
            alt="whatevertogo"
            class="w-6 h-6 object-cover border border-paper-dark"
          />
          <span class="font-bold text-ink">whatevertogo</span>
        </div>
        <div class="flex items-center gap-4 text-ink-light">
          <a :href="withBase('/projects/')" class="hover:text-ink no-underline">关于</a>
          <a :href="withBase('/links/mylinks')" class="hover:text-ink no-underline">友链</a>
          <a href="https://github.com/whatevertogo" target="_blank" rel="noopener noreferrer" class="hover:text-ink no-underline">GitHub</a>
        </div>
      </div>

      <!-- ===== Hero 区 ===== -->
      <header class="hero mb-8 md:mb-12">
        <p class="hero-kicker font-sans text-xs uppercase tracking-[0.3em] text-ink-faint mb-3.5">
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
          class="ink-divider mt-7"
          :class="{ animate: heroDividerReady }"
          style="--divider-delay: 250ms;"
        ></div>
      </header>

      <!-- ===== 移动端分类筛选条 ===== -->
      <div class="md:hidden flex items-center gap-2 overflow-x-auto pb-3 mb-6 font-sans text-xs">
        <button
          @click="handleCategoryChange(null)"
          class="px-3 py-1 border flex-shrink-0 transition-colors"
          :class="activeCategory === null ? 'border-ink bg-ink text-paper' : 'border-paper-dark text-ink-light'"
        >
          全部 ({{ posts.length }})
        </button>
        <button
          v-for="cat in categories"
          :key="cat.name"
          @click="handleCategoryChange(cat.name)"
          class="px-3 py-1 border flex-shrink-0 transition-colors"
          :class="
            activeCategory && activeCategory.toLowerCase() === cat.name.toLowerCase()
              ? 'border-ink bg-ink text-paper'
              : 'border-paper-dark text-ink-light'
          "
        >
          {{ cat.name }} ({{ cat.count }})
        </button>
      </div>

      <SearchBar
        :hot-tags="hotTags"
        :active-category="activeCategory"
        :selected-tag="selectedTag"
        :sort-order="sortOrder"
        :filtered-count="filteredPosts.length"
        v-model="searchQuery"
        @toggle-tag="handleToggleTag"
        @toggle-sort="handleToggleSort"
        @clear-filters="handleClearFilters"
      />

      <PostList
        :posts="filteredPosts"
        :selected-tag="selectedTag"
        @select-tag="handleToggleTag"
        @select-category="handleSelectCategoryFromPost"
      />

      <!-- ===== 极简纸墨页脚 ===== -->
      <footer class="mt-16 pt-6 border-t border-paper-dark flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-sans text-xs text-ink-faint tracking-wider">
        <span>© 2026 whatevertogo · {{ posts.length }} 篇文章 · 累计 {{ totalWordsLabel }} 字</span>
        <div class="flex items-center gap-5 uppercase">
          <a :href="withBase('/projects/')" class="hover:text-ink transition-colors no-underline">关于</a>
          <a :href="withBase('/links/mylinks')" class="hover:text-ink transition-colors no-underline">友链</a>
          <a href="https://github.com/whatevertogo/my-blog" target="_blank" rel="noopener noreferrer" class="hover:text-ink transition-colors no-underline">Source ↗</a>
        </div>
      </footer>
    </main>
  </div>
</template>

<style scoped>
/* ===== Hero ===== */
.hero-kicker {
  animation: fadeInUp 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.hero-title {
  font-size: clamp(2.5rem, 6.5vw, 4.25rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.03em;
  margin: 0 0 0.75rem;
}
.hero-sub {
  font-size: clamp(1.02rem, 1.9vw, 1.2rem);
  line-height: 1.65;
  max-width: 38rem;
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
