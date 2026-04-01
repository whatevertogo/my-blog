<script setup>
import { ref, computed } from 'vue';

const categories = [
  { name: 'AI Agents', subcategories: ['Subagent 架构', '记忆系统'] },
  { name: 'Game Engine Dev', subcategories: ['Unity', 'C# Toolchain'] },
  { name: 'Rust Projects', subcategories: [] },
  { name: 'CLI Tools', subcategories: [] }
];

const mockPosts = [
  {
    id: 1,
    title: '构建具有长程记忆的自动化 Agent 系统',
    date: 'Apr 01, 2026',
    author: 'whatevertogo',
    summary: '探讨如何基于本地文件系统和向量数据库，为大语言模型赋予跨越多次会话的持久化记忆能力。本文深入分析了不同层级记忆域的架构设计。',
    category: 'AI Agents',
    tags: ['Memory System', 'LLM', 'Architecture']
  },
  {
    id: 2,
    title: 'Rust 在命令行工具开发中的最佳实践',
    date: 'Mar 28, 2026',
    author: 'whatevertogo',
    summary: '相较于传统的 Bash 脚本或 Python，Rust 提供了无与伦比的性能与类型安全。这篇指南涵盖了 Clap、Serde 等核心库的使用，以及如何打包分发二进制文件。',
    category: 'CLI Tools',
    tags: ['Rust', 'CLI', 'Performance']
  },
  {
    id: 3,
    title: '深入浅出：Unity DOTS 与面向数据的编程范式',
    date: 'Mar 15, 2026',
    author: 'whatevertogo',
    summary: '传统 OOP 在处理海量实体时遇到性能瓶颈。本文通过一个具体的寻路算法案例，解析 Unity Data-Oriented Technology Stack (DOTS) 如何将 CPU 缓存命中率推向极致。',
    category: 'Game Engine Dev',
    tags: ['Unity', 'DOTS', 'C#', 'Optimization']
  },
  {
    id: 4,
    title: '设计一个可扩展的 Subagent 并行协作框架',
    date: 'Feb 10, 2026',
    author: 'whatevertogo',
    summary: '当单个模型无法处理复杂任务时，我们需要引入层级化 Agent 架构。本研究提出了一种基于消息总线和状态机的非阻塞式异步分发系统。',
    category: 'AI Agents',
    tags: ['Multi-Agent', 'Concurrency', 'System Design']
  }
];

const hotTags = ['LLM', 'Rust', 'Architecture', 'Unity'];
const activeCategory = ref(null);
const searchQuery = ref('');

const filteredPosts = computed(() => {
  return mockPosts.filter((post) => {
    const matchesCategory = activeCategory.value ? post.category === activeCategory.value : true;
    const searchLower = searchQuery.value.toLowerCase();
    const matchesSearch =
      post.title.toLowerCase().includes(searchLower) ||
      post.summary.toLowerCase().includes(searchLower) ||
      post.tags.some((tag) => tag.toLowerCase().includes(searchLower));
    
    return matchesCategory && matchesSearch;
  });
});
</script>

<template>
  <div class="min-h-screen bg-[#FDFBF7] text-stone-800 font-sans flex selection:bg-stone-300 selection:text-stone-900">
    <aside class="w-72 border-r border-stone-300 h-screen sticky top-0 overflow-y-auto px-6 py-8 hidden md:block shrink-0">
      <div class="mb-10">
        <h1 class="font-serif text-2xl font-bold tracking-tight text-stone-900">whatevertogo</h1>
        <p class="text-sm text-stone-500 mt-2 font-sans tracking-wide uppercase">Engineering & Notes</p>
      </div>

      <nav class="font-sans text-sm">
        <div class="mb-4 text-xs font-semibold text-stone-400 uppercase tracking-widest">Directory</div>
        <ul class="flex flex-col gap-1">
          <li
            @click="activeCategory = null"
            class="py-2 px-3 cursor-pointer transition-colors duration-150"
            :class="activeCategory === null ? 'bg-stone-200 text-stone-900 font-medium' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'"
          >
            All Publications
          </li>

          <li v-for="cat in categories" :key="cat.name" class="flex flex-col">
            <div
              @click="activeCategory = cat.name"
              class="py-2 px-3 cursor-pointer transition-colors duration-150 flex items-center justify-between"
              :class="activeCategory === cat.name ? 'bg-stone-200 text-stone-900 font-medium' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'"
            >
              <span>{{ cat.name }}</span>
              <span v-if="cat.subcategories.length > 0" class="text-stone-300">+</span>
            </div>

            <ul v-if="cat.subcategories.length > 0 && activeCategory === cat.name" class="pl-6 flex flex-col gap-1 mt-1 mb-2 border-l border-stone-200 ml-4">
              <li v-for="sub in cat.subcategories" :key="sub" class="py-1 cursor-pointer text-stone-500 hover:text-stone-900 transition-colors">
                — {{ sub }}
              </li>
            </ul>
          </li>
        </ul>
      </nav>
    </aside>

    <main class="flex-1 max-w-5xl mx-auto px-6 py-8 md:px-12 md:py-12 w-full">
      <div class="md:hidden flex items-center justify-between border-b border-stone-300 pb-4 mb-8">
        <h1 class="font-serif text-xl font-bold text-stone-900">whatevertogo</h1>
        <button class="border border-stone-300 px-3 py-1 text-sm font-medium uppercase tracking-wide">Menu</button>
      </div>

      <div class="mb-12 border-b border-stone-300 pb-8">
        <div class="font-sans text-sm text-stone-500 mb-3 uppercase tracking-wide">
          Search / {{ activeCategory ? activeCategory : 'Global' }}
        </div>
        <div class="relative">
          <svg class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="square" stroke-linejoin="miter" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <input
            type="text"
            v-model="searchQuery"
            placeholder="Search by keywords, tags, or concepts..."
            class="w-full bg-transparent border border-stone-300 px-12 py-4 text-lg font-serif text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 transition-colors rounded-none"
          />
        </div>
        <div class="flex items-center gap-3 mt-4 text-sm font-sans text-stone-500">
          <span>Trending:</span>
          <button v-for="tag in hotTags" :key="tag" class="border border-stone-300 px-2 py-0.5 hover:bg-stone-900 hover:text-stone-100 transition-colors">
            {{ tag }}
          </button>
        </div>
      </div>

      <div class="flex justify-between items-end mb-4 font-sans text-xs uppercase tracking-widest text-stone-500 border-b border-stone-300 pb-2">
        <span>{{ filteredPosts.length }} Results</span>
        <span>Sort by: Latest ↓</span>
      </div>

      <div class="flex flex-col">
        <template v-if="filteredPosts.length > 0">
          <article v-for="post in filteredPosts" :key="post.id" class="py-8 border-b border-stone-300 last:border-b-0 group">
            <div class="flex flex-col md:flex-row md:items-baseline gap-4 md:gap-8 mb-3">
              <time class="font-sans text-xs uppercase tracking-widest text-stone-500 min-w-[120px] tabular-nums">
                {{ post.date }}
              </time>
              <h2 class="font-serif text-2xl font-bold text-stone-900 group-hover:text-stone-600 transition-colors leading-tight cursor-pointer">
                {{ post.title }}
              </h2>
            </div>
            
            <div class="flex flex-col md:flex-row gap-4 md:gap-8">
              <div class="hidden md:block min-w-[120px]"></div>
              <div>
                <p class="font-serif text-stone-700 text-lg leading-relaxed mb-4 max-w-3xl">
                  {{ post.summary }}
                </p>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2 font-sans text-xs text-stone-500 uppercase tracking-wider">
                  <span class="font-bold text-stone-900 border-b border-stone-900 pb-0.5">{{ post.category }}</span>
                  <span class="text-stone-300">|</span>
                  <template v-for="(tag, index) in post.tags" :key="tag">
                    <span class="cursor-pointer hover:text-stone-900 transition-colors">{{ tag }}</span>
                    <span v-if="index < post.tags.length - 1" class="text-stone-300">•</span>
                  </template>
                </div>
              </div>
            </div>
          </article>
        </template>
        <div v-else class="py-12 text-center text-stone-500 font-serif text-lg">
          No publications matching your criteria.
        </div>
      </div>
    </main>
  </div>
</template>
