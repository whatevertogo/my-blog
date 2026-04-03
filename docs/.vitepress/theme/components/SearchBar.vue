<script setup>
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
</script>

<template>
  <div>
    <!-- 搜索栏 -->
    <div class="mb-12 border-b border-paper-dark pb-8">
      <div class="font-sans text-sm text-ink-faint mb-3 uppercase tracking-wide">
        Search / <span class="font-medium text-ink">{{ activeCategory ? activeCategory : 'Global' }}</span>
      </div>
      <div class="relative">
        <!-- 搜索图标 -->
        <svg
          class="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-light"
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
          placeholder="Search by keywords, tags, or concepts..."
          class="
            w-full bg-paper-alt/20 border border-paper-dark
            ps-14 pe-4 py-5 text-xl font-serif text-ink
            placeholder:text-ink-faint
            focus:outline-none focus:border-ink transition-colors
            rounded-none
          "
        />
      </div>
      <!-- 热门标签 -->
      <div class="flex items-center gap-3 mt-4 text-sm font-sans text-ink-light">
        <span>Trending:</span>
        <button
          v-for="tag in hotTags"
          :key="tag"
          class="border border-paper-dark px-3 py-0.5 hover:bg-ink hover:text-paper transition-colors"
        >
          {{ tag }}
        </button>
      </div>
    </div>

    <!-- 结果计数和排序 -->
    <div class="flex justify-between items-end mb-4 font-sans text-xs uppercase tracking-widest text-ink-light border-b border-paper-dark pb-2">
      <span>{{ filteredCount }} Results</span>
      <span>Sort by: <span class="text-ink font-semibold cursor-pointer">Latest ↓</span></span>
    </div>
  </div>
</template>
