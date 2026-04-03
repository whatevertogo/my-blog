<script setup>
import { withBase } from 'vitepress'

defineProps({
  posts: {
    type: Array,
    required: true,
  },
})
</script>

<template>
  <div class="flex flex-col">
    <template v-if="posts.length > 0">
      <article
        v-for="post in posts"
        :key="post.id"
        class="py-12 border-b border-paper-dark last:border-b-0 group"
      >
        <!-- 日期 + 标题 -->
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

        <!-- 摘要 + 元数据 -->
        <div class="flex flex-col md:flex-row gap-4 md:gap-8">
          <!-- 日期占位（md 屏幕） -->
          <div class="hidden md:block min-w-[120px]"></div>
          <div>
            <p class="font-serif text-ink-light text-lg leading-relaxed mb-6 max-w-3xl">
              {{ post.summary }}
            </p>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 font-sans text-[11px] text-ink-light uppercase tracking-widest">
              <span class="font-bold text-ink border-b border-ink pb-0.5">
                {{ post.category }}
              </span>
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
</template>
