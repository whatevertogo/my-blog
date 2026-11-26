<script setup>
import { ref } from 'vue'

const friends = [
  {
    name: "Letr's Blog",
    url: 'https://www.letr7.com/',
    domain: 'letr7.com',
    avatar: 'https://www.letr7.com/img/avatar.webp',
    bio: '技术分享，日常记录。',
  },
  {
    name: "Soulter's Blog",
    url: 'https://blog.soulter.top/',
    domain: 'blog.soulter.top',
    avatar: 'https://blog.soulter.top/assets/avatar.webp',
    bio: 'Developer & ACG enthusiast. AstrBot 作者。',
  },
  {
    name: 'lishining的博客',
    url: 'https://app.lishining.top/',
    domain: 'app.lishining.top',
    avatar: 'https://app.lishining.top/themes/theme-earth/assets/images/default-avatar.svg',
    bio: '抽象代数、Claude Code 源码阅读等技术文章。',
  },
  {
    name: '木星逃亡',
    url: 'https://catdfd.com/',
    domain: 'catdfd.com',
    avatar: 'https://catdfd.com/themes/theme-earth/assets/images/default-avatar.svg',
    bio: '落入宇宙。Claude Code 原理分析等技术文章。',
  },
]

const loadedAvatars = ref({})

function onAvatarLoad(name, event) {
  const img = event?.target
  if (img && img.naturalWidth > 0) {
    loadedAvatars.value[name] = true
  }
}

function onAvatarError(name) {
  loadedAvatars.value[name] = false
}
</script>

<template>
  <div class="friend-grid grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
    <a
      v-for="item in friends"
      :key="item.url"
      :href="item.url"
      target="_blank"
      rel="noopener noreferrer"
      class="friend-card group relative border border-paper-dark bg-paper-alt/35 hover:bg-paper-alt/70 hover:border-ink p-4 flex items-start gap-4 transition-all duration-200 no-underline"
    >
      <div class="relative w-12 h-12 flex-shrink-0 border border-paper-dark bg-paper-alt overflow-hidden flex items-center justify-center font-serif font-bold text-lg text-ink">
        <span aria-hidden="true">
          {{ item.name.slice(0, 1).toUpperCase() }}
        </span>
        <img
          :src="item.avatar"
          :alt="item.name"
          referrerpolicy="no-referrer"
          class="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
          :class="loadedAvatars[item.name] ? 'opacity-100' : 'opacity-0'"
          @load="onAvatarLoad(item.name, $event)"
          @error="onAvatarError(item.name)"
        />
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="font-serif font-bold text-base text-ink group-hover:text-brand-3 transition-colors truncate">
            {{ item.name }}
          </span>
          <span class="text-xs text-ink-faint group-hover:text-ink transition-transform duration-200 group-hover:translate-x-0.5">
            ↗
          </span>
        </div>
        <div class="font-sans text-[11px] uppercase tracking-wider text-ink-faint mt-0.5 mb-2">
          {{ item.domain }}
        </div>
        <p class="font-serif text-xs md:text-sm text-ink-light leading-relaxed m-0">
          {{ item.bio }}
        </p>
      </div>
    </a>
  </div>
</template>
