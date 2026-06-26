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
  filteredCount: {
    type: Number,
    required: true,
  },
  modelValue: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue'])

const focused = ref(false)
</script>

<template>
  <div>
    <!-- 搜索栏 -->
    <div class="mb-12 border-b border-paper-dark pb-8">
      <div class="font-sans text-sm text-ink-faint mb-3 uppercase tracking-wide">
        Search / <span class="font-medium text-ink">{{ activeCategory ? activeCategory : 'Global' }}</span>
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
            ps-14 pe-4 py-5 text-xl font-serif text-ink
            placeholder:text-ink-faint
            focus:outline-none focus:border-ink transition-colors duration-300
            rounded-none
          "
        />
        <!-- 聚焦时底部墨线展开 -->
        <span class="focus-underline"></span>
      </div>
      <!-- 热门标签 -->
      <div class="flex items-center gap-3 mt-4 text-sm font-sans text-ink-light">
        <span>Trending:</span>
        <button
          v-for="tag in hotTags"
          :key="tag"
          class="trend-tag border border-paper-dark px-3 py-0.5 relative overflow-hidden"
        >
          <span class="trend-label relative z-10">{{ tag }}</span>
        </button>
      </div>
    </div>

    <!-- 结果计数和排序 -->
    <div class="results-bar flex justify-between items-end mb-4 font-sans text-xs uppercase tracking-widest text-ink-light border-b border-paper-dark pb-2">
      <span>{{ filteredCount }} Results</span>
      <span>Sort by: <span class="text-ink font-semibold cursor-pointer">Latest ↓</span></span>
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
  transition: border-color 0.25s ease, color 0.25s ease;
}
.trend-tag::before {
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
  .trend-tag:hover {
    border-color: var(--vp-c-text-1, #222222);
  }
  .trend-tag:hover::before {
    transform: translateY(0);
  }
  .trend-tag:hover .trend-label {
    color: var(--vp-c-bg, #f9f6f0);
  }
}

/* 结果计数条装饰：底部已有 border，给“Latest”轻微强调 */
.results-bar span:last-child {
  position: relative;
}
</style>
