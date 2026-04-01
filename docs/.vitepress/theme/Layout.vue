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
  <DefaultTheme.Layout v-else />
</template>
