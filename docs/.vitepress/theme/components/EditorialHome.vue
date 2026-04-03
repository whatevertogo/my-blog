<script setup>
import { ref, computed } from 'vue';
import { withBase } from 'vitepress';
import { data as realPosts } from '../../../blog/posts.data.mts'; // 使用 VitePress 生成的真实数据

// === 数据来源替换为真实 Markdown 数据 ===
// 我们从 realPosts (这是 VitePress 在构建时自动爬取的所有博客) 中提取数据
const posts = realPosts.map(post => ({
  id: post.url, // url 是唯一标识
  title: post.title,
  date: post.date ? new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : '',
  author: 'whatevertogo', // 默认作者一致
  summary: post.excerpt || '这篇文章暂无摘要与预览，点击阅读完整内容。',
  category: post.category || 'Uncategorized',
  tags: post.tags || [],
  url: post.url // 提供跳转链接
}));

// 从文章中自动提取所有的类别和子类别（可选：简化为单层）
const categories = [
  ...new Set(posts.map(p => p.category).filter(Boolean))
].map(c => ({ name: c, subcategories: [] }));

const hotTags = [...new Set(posts.flatMap(p => p.tags))].slice(0, 5); // 提取前5个常用 Tag

const activeCategory = ref(null);
const searchQuery = ref('');
const sidebarCollapsed = ref(false); // 控制侧边栏折叠状态

const filteredPosts = computed(() => {
  return posts.filter((post) => {
    const matchesCategory = activeCategory.value ? post.category === activeCategory.value : true;
    const searchLower = searchQuery.value.toLowerCase();
    const matchesSearch =
      post.title.toLowerCase().includes(searchLower) ||
      post.summary.toLowerCase().includes(searchLower) ||
      post.tags.some((tag) => tag.toLowerCase().includes(searchLower));
    
    return matchesCategory && matchesSearch;
  });
});

// 切换侧边栏折叠状态
const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
};
</script>

<template>
  <div class="min-h-screen bg-paper text-ink font-sans flex selection:bg-paper-dark selection:text-ink">
    <aside
      class="relative border-r border-paper-dark h-screen sticky top-0 overflow-y-auto px-6 py-8 hidden md:block shrink-0 transition-all duration-500 ease-in-out flex"
      :class="sidebarCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-72'"
    >
      <div class="w-72 min-w-72">
        <div class="mb-10">
          <h1 class="font-serif text-2xl font-bold tracking-tight text-ink">whatevertogo</h1>
          <p class="text-sm text-ink-light mt-2 font-sans tracking-wide uppercase">Engineering & Notes</p>
        </div>

        <nav class="font-sans text-sm">
          <div class="mb-4 text-xs font-semibold text-ink-faint uppercase tracking-widest">Directory</div>
          <ul class="flex flex-col gap-1">
            <li
              @click="activeCategory = null"
              class="py-2 px-3 cursor-pointer transition-colors duration-150"
              :class="activeCategory === null ? 'bg-paper-alt text-ink font-medium shadow-[rgba(0,0,0,0.05)_0px_2px_4px]' : 'text-ink-light hover:bg-paper-alt hover:text-ink'"
            >
              All Publications
            </li>

            <li v-for="cat in categories" :key="cat.name" class="flex flex-col">
              <div
                @click="activeCategory = cat.name"
                class="py-2 px-3 cursor-pointer transition-colors duration-150 flex items-center justify-between"
                :class="activeCategory === cat.name ? 'bg-paper-alt text-ink font-medium shadow-[rgba(0,0,0,0.05)_0px_2px_4px]' : 'text-ink-light hover:bg-paper-alt hover:text-ink'"
              >
                <span>{{ cat.name }}</span>
                <span v-if="cat.subcategories.length > 0" class="text-paper-dark">+</span>
              </div>

              <ul v-if="cat.subcategories.length > 0 && activeCategory === cat.name" class="pl-6 flex flex-col gap-1 mt-1 mb-2 border-l border-paper-dark ml-4">
                <li v-for="sub in cat.subcategories" :key="sub" class="py-1 cursor-pointer text-ink-light hover:text-ink transition-colors">
                  — {{ sub }}
                </li>
              </ul>
            </li>
          </ul>
        </nav>
      </div>
    </aside>

    <!-- 折叠按钮，固定在屏幕左上角 -->
    <button
      @click="toggleSidebar"
      class="hidden md:flex fixed top-5 z-50 p-2 rounded-md transition-all duration-500 ease-in-out text-ink-faint hover:text-ink hover:bg-paper-alt"
      :style="{ left: sidebarCollapsed ? '1.5rem' : '18rem' }"
    >
      <!-- 展开时显示左箭头，折叠时显示右箭头 -->
      <svg v-if="sidebarCollapsed" class="w-5 h-5 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
      <svg v-else class="w-5 h-5 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>

    <main
      class="flex-1 max-w-5xl mx-auto px-6 py-8 md:px-14 md:py-12 w-full transition-transform duration-500 ease-in-out"
    >
      <div class="md:hidden flex items-center justify-between border-b border-paper-dark pb-4 mb-8">
        <h1 class="font-serif text-xl font-bold text-ink">whatevertogo</h1>
        <button class="border border-paper-dark px-3 py-1 text-sm font-medium uppercase tracking-wide">Menu</button>
      </div>

      <div class="mb-12 border-b border-paper-dark pb-8">
        <div class="font-sans text-sm text-ink-faint mb-3 uppercase tracking-wide">
          Search / <span class="font-medium text-ink">{{ activeCategory ? activeCategory : 'Global' }}</span>
        </div>
        <div class="relative">
          <svg class="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="square" stroke-linejoin="miter" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <input
            type="text"
            v-model="searchQuery"
            placeholder="Search by keywords, tags, or concepts..."
            class="w-full bg-paper-alt/20 border border-paper-dark ps-14 pe-4 py-5 text-xl font-serif text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink transition-colors rounded-none"
          />
        </div>
        <div class="flex items-center gap-3 mt-4 text-sm font-sans text-ink-light">
          <span>Trending:</span>
          <button v-for="tag in hotTags" :key="tag" class="border border-paper-dark px-3 py-0.5 hover:bg-ink hover:text-paper transition-colors">
            {{ tag }}
          </button>
        </div>
      </div>

      <div class="flex justify-between items-end mb-4 font-sans text-xs uppercase tracking-widest text-ink-light border-b border-paper-dark pb-2">
        <span>{{ filteredPosts.length }} Results</span>
        <span>Sort by: <span class="text-ink font-semibold cursor-pointer">Latest ↓</span></span>
      </div>

      <div class="flex flex-col">
        <template v-if="filteredPosts.length > 0">
          <article v-for="post in filteredPosts" :key="post.id" class="py-12 border-b border-paper-dark last:border-b-0 group">
            <div class="flex flex-col md:flex-row md:items-baseline gap-4 md:gap-8 mb-5">
              <time class="font-sans text-xs uppercase tracking-widest text-ink-faint min-w-[120px] tabular-nums pt-1">
                {{ post.date }}
              </time>
              <a :href="withBase(post.url)">
                <h2 class="font-serif text-3xl font-bold text-ink group-hover:text-brand transition-colors leading-tight cursor-pointer">
                  {{ post.title }}
                </h2>
              </a>
            </div>
            
            <div class="flex flex-col md:flex-row gap-4 md:gap-8">
              <div class="hidden md:block min-w-[120px]"></div>
              <div>
                <p class="font-serif text-ink-light text-lg leading-relaxed mb-6 max-w-3xl">
                  {{ post.summary }}
                </p>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2 font-sans text-[11px] text-ink-light uppercase tracking-widest">
                  <span class="font-bold text-ink border-b border-ink pb-0.5">{{ post.category }}</span>
                  <span class="text-paper-dark">|</span>
                  <template v-for="(tag, index) in post.tags" :key="tag">
                    <span class="cursor-pointer hover:text-ink transition-colors">{{ tag }}</span>
                    <span v-if="index < post.tags.length - 1" class="text-paper-dark">•</span>
                  </template>
                </div>
              </div>
            </div>
          </article>
        </template>
        <div v-else class="py-16 text-center text-ink-faint font-serif text-xl border-b border-paper-dark">
          No publications matching your criteria.
        </div>
      </div>
    </main>
  </div>
</template>