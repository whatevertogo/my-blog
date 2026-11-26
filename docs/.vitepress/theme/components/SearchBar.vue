<script setup>
import { ref } from 'vue'

defineProps({
  hotTags: {
    type: Array,
    required: true,
  },
  activeCategory: {
    type: [String, null],
    default: null,
  },
  selectedTag: {
    type: [String, null],
    default: null,
  },
  sortOrder: {
    type: String,
    default: 'desc',
  },
  filteredCount: {
    type: Number,
    required: true,
  },
  modelValue: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue', 'toggle-tag', 'toggle-sort', 'clear-filters'])

const focused = ref(false)
</script>

<template>
  <div>
    <!-- 搜索栏 -->
    <div class="mb-10 border-b border-paper-dark pb-7">
      <div class="flex items-center justify-between font-sans text-sm text-ink-faint mb-3 uppercase tracking-wide">
        <div>
          Search / <span class="font-medium text-ink">{{ activeCategory ? activeCategory : 'Global' }}</span>
          <template v-if="selectedTag">
            <span class="mx-1.5 text-paper-dark">/</span>
            <span class="font-medium text-ink">#{{ selectedTag }}</span>
          </template>
        </div>
        <button
          v-if="activeCategory || selectedTag || modelValue"
          @click="emit('clear-filters')"
          class="text-[11px] uppercase tracking-widest text-ink-light hover:text-ink border-b border-paper-dark hover:border-ink pb-0.5 transition-colors"
        >
          Reset Filters ×
        </button>
      </div>

      <div
        class="search-wrap relative"
        :class="{ 'is-focused': focused }"
      >
        <!-- 搜索图标 -->
        <svg
          class="search-icon absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-light"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="square"
            stroke-linejoin="miter"
            stroke-width="1.5"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          :value="modelValue"
          @input="emit('update:modelValue', $event.target.value)"
          @focus="focused = true"
          @blur="focused = false"
          placeholder="Search by keywords, tags, or concepts..."
          class="
            w-full bg-paper-alt/20 border border-paper-dark
            ps-14 pe-12 py-4 md:py-5 text-lg md:text-xl font-serif text-ink
            placeholder:text-ink-faint
            focus:outline-none focus:border-ink transition-colors duration-300
            rounded-none
          "
        />
        <!-- 清空输入框按钮 -->
        <button
          v-if="modelValue"
          @click="emit('update:modelValue', '')"
          aria-label="Clear search"
          class="absolute right-4 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-ink-faint hover:text-ink transition-colors"
        >
          ✕
        </button>
        <!-- 聚焦时底部墨线展开 -->
        <span class="focus-underline"></span>
      </div>

      <!-- 热门标签（可交互筛选） -->
      <div class="flex flex-wrap items-center gap-2.5 mt-4 text-sm font-sans text-ink-light">
        <span class="text-xs uppercase tracking-widest text-ink-faint mr-1">Topics:</span>
        <button
          v-for="tag in hotTags"
          :key="tag"
          @click="emit('toggle-tag', tag)"
          class="trend-tag border px-3 py-0.5 relative overflow-hidden cursor-pointer text-xs tracking-wide"
          :class="
            selectedTag === tag
              ? 'is-active border-ink bg-ink text-paper'
              : 'border-paper-dark text-ink-light'
          "
        >
          <span class="trend-label relative z-10">{{ tag }}</span>
        </button>
      </div>
    </div>

    <!-- 结果计数和排序切换 -->
    <div class="results-bar flex justify-between items-end mb-2 font-sans text-xs uppercase tracking-widest text-ink-light border-b border-paper-dark pb-2.5">
      <span class="tabular-nums">{{ filteredCount }} {{ filteredCount === 1 ? 'Result' : 'Results' }}</span>
      <button
        @click="emit('toggle-sort')"
        class="uppercase tracking-widest text-ink-light hover:text-ink transition-colors cursor-pointer"
      >
        Sort by:
        <span class="text-ink font-semibold">
          {{ sortOrder === 'desc' ? 'Latest ↓' : 'Oldest ↑' }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 聚焦时图标变深 + 微缩 */
.search-icon {
  transition: color 0.3s ease, transform 0.3s ease;
}
.search-wrap.is-focused .search-icon {
  color: var(--vp-c-text-1, #222222);
  transform: translateY(-50%) scale(1.05);
}

/* 聚焦底部墨线：从中心向两侧展开 */
.focus-underline {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 1px;
  background-color: var(--vp-c-text-1, #222222);
  transform: scaleX(0);
  transform-origin: center;
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}
.search-wrap.is-focused .focus-underline {
  transform: scaleX(1);
}

/* 热门标签：hover 时墨水从底部填充上推 */
.trend-tag {
  transition: border-color 0.25s ease, color 0.25s ease, background-color 0.25s ease;
}
.trend-tag:not(.is-active)::before {
  content: "";
  position: absolute;
  inset: 0;
  background-color: var(--vp-c-text-1, #222222);
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 1;
}
.trend-label {
  transition: color 0.25s ease;
}
@media (hover: hover) {
  .trend-tag:not(.is-active):hover {
    border-color: var(--vp-c-text-1, #222222);
  }
  .trend-tag:not(.is-active):hover::before {
    transform: translateY(0);
  }
  .trend-tag:not(.is-active):hover .trend-label {
    color: var(--vp-c-bg, #f9f6f0);
  }
}
</style>
