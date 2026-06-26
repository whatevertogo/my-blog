<script setup>
import { computed } from 'vue'
import { useData } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import EditorialHome from './components/EditorialHome.vue'

const { frontmatter } = useData()

const formattedDate = computed(() => {
  const d = frontmatter.value.date
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
  } catch {
    return String(d)
  }
})
</script>

<template>
  <div v-if="frontmatter.layout === 'editorial'">
    <EditorialHome />
  </div>
  <DefaultTheme.Layout v-else>
    <template #doc-before>
      <header
        v-if="frontmatter.title && frontmatter.layout !== 'editorial'"
        class="blog-post-header"
      >
        <!-- 文章元信息：日期 / 分类 -->
        <div
          v-if="formattedDate || frontmatter.category"
          class="blog-post-meta font-sans text-xs uppercase tracking-[0.2em] text-ink-faint flex items-center gap-3 mb-4"
        >
          <time v-if="formattedDate" class="tabular-nums">{{ formattedDate }}</time>
          <template v-if="formattedDate && frontmatter.category">
            <span class="text-paper-dark">/</span>
          </template>
          <span v-if="frontmatter.category" class="text-ink font-semibold">{{ frontmatter.category }}</span>
        </div>
        <h1 class="blog-post-title">{{ frontmatter.title }}</h1>
      </header>
    </template>
  </DefaultTheme.Layout>
</template>

<style scoped>
.blog-post-header {
  margin-bottom: 2rem;
}
.blog-post-meta {
  opacity: 0;
  animation: fadeInUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.05s both;
}
.blog-post-title {
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1.2;
  color: var(--vp-c-text-1);
  letter-spacing: -0.015em;
  margin: 0;
  /* 入场淡入 + 装饰墨线（::after 在全局 style.css 中定义） */
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
