<script setup>
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import EditorialHome from './components/EditorialHome.vue'
import { data as allPosts } from '../../blog/posts.data.mts'

const { frontmatter, page } = useData()
const route = useRoute()

function normalizePostKey(urlOrRelPath) {
  return String(urlOrRelPath || '')
    .replace(/^\/my-blog\//, '/')
    .replace(/^\/+/, '')
    .replace(/\.(md|html)$/, '')
    .replace(/\/index$/, '')
}

const currentKey = computed(() => normalizePostKey(page.value.relativePath || route.path))

const currentPostIndex = computed(() =>
  allPosts.findIndex((p) => normalizePostKey(p.url) === currentKey.value),
)

const currentPost = computed(() =>
  currentPostIndex.value >= 0 ? allPosts[currentPostIndex.value] : null,
)

const isBlogPost = computed(() => currentPost.value !== null)

// allPosts 按日期从新到旧排序：index - 1 是更新一篇（Next），index + 1 是更早一篇（Prev）
const newerPost = computed(() =>
  currentPostIndex.value > 0 ? allPosts[currentPostIndex.value - 1] : null,
)
const olderPost = computed(() =>
  currentPostIndex.value >= 0 && currentPostIndex.value < allPosts.length - 1
    ? allPosts[currentPostIndex.value + 1]
    : null,
)

const formattedDate = computed(() => {
  const d = frontmatter.value.date
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
  } catch {
    return String(d)
  }
})

const wordCountLabel = computed(() => {
  const wc = currentPost.value?.wordCount || 0
  if (!wc) return ''
  return wc >= 1000 ? `${(wc / 1000).toFixed(1)}k 字` : `${wc} 字`
})

// 顶部阅读进度 & 回到顶部按钮状态
const readingProgress = ref(0)
const showBackTop = ref(false)
let rafId = null

function updateScrollState() {
  if (typeof window === 'undefined') return
  const scrollTop = window.scrollY || document.documentElement.scrollTop || 0
  const docHeight =
    document.documentElement.scrollHeight - document.documentElement.clientHeight
  readingProgress.value =
    docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0
  showBackTop.value = scrollTop > 360
}

function handleScroll() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    updateScrollState()
  })
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  updateScrollState()
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('resize', handleScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('resize', handleScroll)
  if (rafId !== null) cancelAnimationFrame(rafId)
})

watch(
  () => route.path,
  () => {
    requestAnimationFrame(updateScrollState)
  },
)
</script>

<template>
  <div v-if="frontmatter.layout === 'editorial'">
    <EditorialHome />
  </div>

  <template v-else>
    <!-- 顶部极细阅读进度条（借鉴技术阅读页体验，保持暖棕/墨色克制） -->
    <div
      v-if="isBlogPost"
      class="reading-progress-track"
      aria-hidden="true"
    >
      <div
        class="reading-progress-fill"
        :style="{ width: `${readingProgress}%` }"
      ></div>
    </div>

    <DefaultTheme.Layout>
      <template #doc-before>
        <header
          v-if="frontmatter.title && frontmatter.layout !== 'editorial'"
          class="blog-post-header"
        >
          <!-- 返回首页入口（借鉴极简阅读导航） -->
          <div v-if="isBlogPost" class="mb-5">
            <a
              :href="withBase('/')"
              class="back-home-link font-sans text-xs uppercase tracking-[0.18em] text-ink-light hover:text-ink inline-flex items-center gap-1.5"
            >
              <span>←</span>
              <span>返回文章列表</span>
            </a>
          </div>

          <!-- 文章元信息：日期 / 分类 / 字数与阅读耗时 -->
          <div
            v-if="formattedDate || frontmatter.category || wordCountLabel"
            class="blog-post-meta font-sans text-xs uppercase tracking-[0.18em] text-ink-faint flex flex-wrap items-center gap-x-3 gap-y-1 mb-4"
          >
            <time v-if="formattedDate" class="tabular-nums">{{ formattedDate }}</time>
            <template v-if="formattedDate && frontmatter.category">
              <span class="text-paper-dark">/</span>
            </template>
            <a
              v-if="frontmatter.category"
              :href="withBase(`/?category=${encodeURIComponent(frontmatter.category)}`)"
              class="text-ink font-semibold hover:text-brand-3 transition-colors no-underline"
            >
              {{ frontmatter.category }}
            </a>
            <template v-if="wordCountLabel">
              <span class="text-paper-dark">·</span>
              <span class="tabular-nums">{{ wordCountLabel }} · 约 {{ currentPost.readingMinutes }} 分钟</span>
            </template>
          </div>

          <h1 class="blog-post-title">{{ frontmatter.title }}</h1>

          <!-- 标签条 -->
          <div
            v-if="isBlogPost && frontmatter.tags && frontmatter.tags.length > 0"
            class="flex flex-wrap items-center gap-2 mt-6 font-sans text-[11px] uppercase tracking-wider"
          >
            <a
              v-for="tag in frontmatter.tags"
              :key="tag"
              :href="withBase(`/?tag=${encodeURIComponent(tag)}`)"
              class="post-tag-chip px-2.5 py-0.5 border border-paper-dark bg-paper-alt/40 text-ink-light hover:border-ink hover:text-ink transition-colors no-underline"
            >
              #{{ tag }}
            </a>
          </div>

          <!-- 导读摘要框（借鉴友链摘要模块，采用纸墨平铺质感） -->
          <div
            v-if="isBlogPost && frontmatter.description"
            class="article-tldr mt-7 border border-paper-dark border-l-[3px] border-l-ink bg-paper-alt/45 px-5 py-4"
          >
            <div class="font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-ink-faint mb-1.5">
              导读 · Summary
            </div>
            <p class="font-serif text-sm md:text-[15px] leading-relaxed text-ink-light m-0">
              {{ frontmatter.description }}
            </p>
          </div>
        </header>
      </template>

      <template #doc-after>
        <footer v-if="isBlogPost" class="article-footer mt-14 pt-8 border-t border-paper-dark">
          <!-- 版权与信息卡 -->
          <div class="license-card border border-paper-dark bg-paper-alt/40 px-5 py-4 mb-8 font-sans">
            <div class="text-sm font-serif font-bold text-ink mb-2">
              {{ frontmatter.title }}
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-ink-light pt-2 border-t border-paper-dark/80">
              <div>
                <div class="text-[10px] uppercase tracking-widest text-ink-faint">Author</div>
                <div class="text-ink font-medium mt-0.5">whatevertogo</div>
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-widest text-ink-faint">Published</div>
                <div class="text-ink font-medium tabular-nums mt-0.5">{{ formattedDate }}</div>
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-widest text-ink-faint">Length</div>
                <div class="text-ink font-medium tabular-nums mt-0.5">{{ wordCountLabel }}</div>
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-widest text-ink-faint">License</div>
                <div class="text-ink font-medium mt-0.5">CC BY-NC-SA 4.0</div>
              </div>
            </div>
          </div>

          <!-- 上一篇 / 下一篇导航 -->
          <nav
            v-if="newerPost || olderPost"
            aria-label="Post navigation"
            class="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <a
              v-if="newerPost"
              :href="withBase(newerPost.url)"
              class="pager-card border border-paper-dark bg-paper-alt/25 hover:border-ink hover:bg-paper-alt/60 px-4 py-3.5 transition-colors no-underline block"
            >
              <div class="font-sans text-[10px] uppercase tracking-[0.2em] text-ink-faint mb-1">
                ← 较新一篇
              </div>
              <div class="font-serif text-sm font-semibold text-ink line-clamp-2">
                {{ newerPost.title }}
              </div>
            </a>
            <div v-else class="hidden sm:block"></div>

            <a
              v-if="olderPost"
              :href="withBase(olderPost.url)"
              class="pager-card border border-paper-dark bg-paper-alt/25 hover:border-ink hover:bg-paper-alt/60 px-4 py-3.5 transition-colors no-underline block sm:text-right"
            >
              <div class="font-sans text-[10px] uppercase tracking-[0.2em] text-ink-faint mb-1">
                较早一篇 →
              </div>
              <div class="font-serif text-sm font-semibold text-ink line-clamp-2">
                {{ olderPost.title }}
              </div>
            </a>
          </nav>
        </footer>
      </template>
    </DefaultTheme.Layout>

    <!-- 右下角回到顶部按钮 -->
    <button
      v-show="showBackTop"
      @click="scrollToTop"
      aria-label="回到顶部"
      class="back-to-top-btn fixed bottom-7 right-6 z-50 w-10 h-10 border border-paper-dark bg-paper text-ink-light hover:border-ink hover:text-ink hover:bg-paper-alt flex items-center justify-center transition-all duration-200 font-sans text-sm"
    >
      ↑
    </button>
  </template>
</template>

<style scoped>
.reading-progress-track {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background-color: transparent;
  z-index: 60;
  pointer-events: none;
}
.reading-progress-fill {
  height: 100%;
  background-color: var(--vp-c-brand-3, #b3804d);
  transition: width 80ms linear;
}

.back-home-link {
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 1px;
  transition: color 0.2s ease, border-color 0.2s ease;
}
.back-home-link:hover {
  border-bottom-color: var(--vp-c-text-1, #222222);
}

.blog-post-header {
  margin-bottom: 2.2rem;
}
.blog-post-meta {
  opacity: 0;
  animation: fadeInUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.05s both;
}
.blog-post-title {
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  font-size: clamp(1.9rem, 4vw, 2.5rem);
  font-weight: 800;
  line-height: 1.22;
  color: var(--vp-c-text-1);
  letter-spacing: -0.015em;
  margin: 0;
}

.back-to-top-btn {
  box-shadow: 0 2px 8px rgba(34, 34, 34, 0.06);
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
