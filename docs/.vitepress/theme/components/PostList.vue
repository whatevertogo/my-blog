<script setup>
import { withBase } from 'vitepress'

defineProps({
  posts: {
    type: Array,
    required: true,
  },
  selectedTag: {
    type: [String, null],
    default: null,
  },
})

const emit = defineEmits(['select-tag', 'select-category'])

function formatWords(n) {
  if (!n) return '0 字'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k 字` : `${n} 字`
}
</script>

<template>
  <div class="flex flex-col">
    <template v-if="posts.length > 0">
      <article
        v-for="(post, index) in posts"
        :key="post.id"
        v-reveal
        class="post-item py-10 md:py-11 border-b border-paper-dark last:border-b-0 group relative"
        :style="{ '--reveal-delay': `${Math.min(index, 6) * 70}ms` }"
      >
        <!-- 左侧墨色/暖棕细条（借鉴友链卡片指示条，悬浮时滑出） -->
        <span class="post-accent-bar" aria-hidden="true"></span>

        <!-- 日期 + 标题 -->
        <div class="flex flex-col md:flex-row md:items-baseline gap-3 md:gap-8 mb-4">
          <div class="md:min-w-[136px] flex md:flex-col gap-3 md:gap-1 pt-1">
            <time class="font-sans text-xs uppercase tracking-widest text-ink-faint tabular-nums">
              {{ post.date }}
            </time>
            <span class="font-sans text-[11px] tracking-wider text-ink-faint/80 tabular-nums">
              {{ formatWords(post.wordCount) }} · {{ post.readingMinutes }} min
            </span>
          </div>
          <a :href="withBase(post.url)" class="post-title-link">
            <h2 class="post-title font-serif text-2xl md:text-3xl font-bold text-ink group-hover:text-brand-3 transition-colors duration-300 leading-snug cursor-pointer">
              {{ post.title }}
            </h2>
          </a>
        </div>

        <!-- 摘要 + 元数据 -->
        <div class="flex flex-col md:flex-row gap-3 md:gap-8">
          <div class="hidden md:block md:min-w-[136px]"></div>
          <div class="flex-1 min-w-0">
            <p class="font-serif text-ink-light text-base md:text-lg leading-relaxed mb-5 max-w-3xl">
              {{ post.summary }}
            </p>
            <div class="flex flex-wrap items-center gap-x-3.5 gap-y-2 font-sans text-[11px] text-ink-light uppercase tracking-widest">
              <button
                @click="emit('select-category', post.category)"
                class="post-category font-bold text-ink border-b border-ink pb-0.5 cursor-pointer hover:text-brand-3 hover:border-brand-3 transition-colors"
              >
                {{ post.category }}
              </button>
              <span class="text-paper-dark">|</span>
              <template v-for="(tag, tagIndex) in post.tags" :key="tag">
                <button
                  @click="emit('select-tag', tag)"
                  class="cursor-pointer transition-colors duration-200 px-1.5 py-0.5 border"
                  :class="
                    selectedTag === tag
                      ? 'border-ink bg-ink text-paper'
                      : 'border-transparent hover:border-paper-dark hover:bg-paper-alt/60 hover:text-ink'
                  "
                >
                  #{{ tag }}
                </button>
                <span v-if="tagIndex < post.tags.length - 1" class="text-paper-dark">·</span>
              </template>
              <a
                :href="withBase(post.url)"
                class="read-more ml-auto text-ink-faint group-hover:text-ink transition-colors duration-300 inline-flex items-center gap-1 no-underline"
              >
                Read
                <span class="read-arrow inline-block transition-transform duration-300 group-hover:translate-x-1">→</span>
              </a>
            </div>
          </div>
        </div>
      </article>
    </template>
    <div v-else class="py-16 text-center text-ink-faint font-serif text-xl border-b border-paper-dark">
      没有找到匹配的文章，试试更换关键词或重置筛选条件。
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

/* 左侧隐形指示条，hover 时显现 */
.post-item {
  transition: padding-left 0.28s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.28s ease;
}
.post-accent-bar {
  position: absolute;
  left: 0;
  top: 2.5rem;
  bottom: 2.5rem;
  width: 2px;
  background-color: var(--vp-c-brand-1, #d4a373);
  transform: scaleY(0);
  transform-origin: top center;
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
@media (hover: hover) {
  .post-item:hover {
    padding-left: 1rem;
  }
  .post-item:hover .post-accent-bar {
    transform: scaleY(1);
  }
}

.read-more {
  text-decoration: none;
}
</style>
