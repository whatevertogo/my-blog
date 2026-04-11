<script setup>
import { useData } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import EditorialHome from './components/EditorialHome.vue'

const { frontmatter } = useData()
</script>

<template>
  <div v-if="frontmatter.layout === 'editorial'">
    <EditorialHome />
  </div>
  <DefaultTheme.Layout v-else>
    <template #doc-before>
      <h1 v-if="frontmatter.title && frontmatter.layout !== 'editorial'" class="blog-post-title">{{ frontmatter.title }}</h1>
    </template>
  </DefaultTheme.Layout>
</template>

<style scoped>
.blog-post-title {
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1.2;
  color: var(--vp-c-text-1);
  letter-spacing: -0.015em;
  margin-bottom: 2rem;
}
</style>
