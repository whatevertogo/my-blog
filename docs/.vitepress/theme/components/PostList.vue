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
        v-for="(post, index) in posts"
        :key="post.id"
        v-reveal
        class="post-item py-12 border-b border-paper-dark last:border-b-0 group"
        :style="{ '--reveal-delay': `${Math.min(index, 6) * 70}ms` }"
      >
        <!-- 日期 + 标题 -->
        <div class="flex flex-col md:flex-row md:items-baseline gap-4 md:gap-8 mb-5">
          <time class="font-sans text-xs uppercase tracking-widest text-ink-faint min-w-[120px] tabular-nums pt-1">
            {{ post.date }}
          </time>
          <a :href="withBase(post.url)" class="post-title-link">
            <h2 class="post-title font-serif text-3xl font-bold text-ink group-hover:text-brand transition-colors duration-300 leading-tight cursor-pointer">
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
              <span class="post-category font-bold text-ink border-b border-ink pb-0.5">
                {{ post.category }}
              </span>
              <span class="text-paper-dark">|</span>
              <template v-for="(tag, tagIndex) in post.tags" :key="tag">
                <span class="cursor-pointer hover:text-ink transition-colors duration-200">{{ tag }}</span>
                <span v-if="tagIndex < post.tags.length - 1" class="text-paper-dark">•</span>
              </template>
              <span class="read-more ml-auto text-ink-faint group-hover:text-ink transition-colors duration-300 inline-flex items-center gap-1">
                Read
                <span class="read-arrow inline-block transition-transform duration-300 group-hover:translate-x-1">→</span>
              </span>
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

<style scoped>
/* 标题 hover：墨水下划线从左展开 */
.post-title-link {
  display: inline-block;
  text-decoration: none;
  position: relative;
}
.post-title-link::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: -2px;
  width: 100%;
  height: 2px;
  background-color: var(--vp-c-brand-1, #d4a373);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.post-title-link:hover::after {
  transform: scaleX(1);
}

/* 文章条目上移极小的视觉聚焦感 */
.post-item {
  transition: transform 0.3s ease;
}
@media (hover: hover) {
  .post-item:hover {
    transform: translateY(-1px);
  }
}

/* 分类标签 hover */
.post-category {
  transition: opacity 0.2s ease;
}
</style>
