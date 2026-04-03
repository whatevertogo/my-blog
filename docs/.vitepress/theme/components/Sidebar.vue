<script setup>
import { ref } from 'vue'

defineProps({
  categories: {
    type: Array,
    required: true,
  },
  activeCategory: {
    type: [String, null],
    default: null,
  },
})

const emit = defineEmits(['category-change'])

// 侧边栏折叠状态 - 默认展开
const isCollapsed = ref(false)

/** 切换侧边栏折叠状态 */
const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value
}

/** 选择分类 */
const selectCategory = (catName) => {
  emit('category-change', catName)
}
</script>

<template>
  <!-- 侧边栏容器：根据状态控制宽度 -->
  <aside
    class="
      relative
      hidden md:block flex-shrink-0
      h-screen sticky top-0
      transition-all duration-500 ease-in-out
      z-40
    "
    :class="
      isCollapsed
        ? 'w-0 border-r-0'
        : 'w-72 border-r border-paper-dark'
    "
  >
    <!-- 折叠/展开按钮 -->
    <button
      @click="toggleCollapse"
      class="
        flex
        items-center justify-center
        absolute top-8 z-50
        w-6 h-6
        rounded-full
        bg-paper border border-paper-dark
        text-ink-faint hover:text-ink hover:border-ink
        transition-all duration-500 ease-in-out
        shadow-sm hover:shadow
      "
      :class="
        isCollapsed
          ? '-right-3 translate-x-full'
          : '-right-3'
      "
    >
      <svg
        class="w-3 h-3 transition-transform duration-500"
        :class="isCollapsed ? 'rotate-180' : ''"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 19l-7-7 7-7"
        />
      </svg>
    </button>

    <!-- 内部内容遮罩区：折叠时隐藏内容 -->
    <div
      class="h-full overflow-hidden transition-all duration-500 ease-in-out"
      :class="isCollapsed ? 'opacity-0 delay-0' : 'opacity-100 delay-200'"
    >
      <div class="w-72 h-full px-6 py-8 overflow-y-auto">
        <!-- Blog 标识 -->
        <div class="mb-10">
          <h1 class="font-serif text-2xl font-bold tracking-tight text-ink">
            whatevertogo
          </h1>
          <p class="text-sm text-ink-light mt-2 font-sans tracking-wide uppercase">
            Engineering & Notes
          </p>
        </div>

        <!-- 目录导航 -->
        <nav class="font-sans text-sm">
          <div class="mb-4 text-xs font-semibold text-ink-faint uppercase tracking-widest">
            Directory
          </div>
          <ul class="flex flex-col gap-1">
            <!-- All Publications：activeCategory 为 null 时高亮 -->
            <li
              @click="selectCategory(null)"
              class="py-2 px-3 cursor-pointer transition-colors duration-150"
              :class="
                activeCategory === null
                  ? 'bg-paper-alt text-ink font-medium shadow-[rgba(0,0,0,0.05)_0px_2px_4px]'
                  : 'text-ink-light hover:bg-paper-alt hover:text-ink'
              "
            >
              All Publications
            </li>

            <!-- 分类列表 -->
            <li v-for="cat in categories" :key="cat.name" class="flex flex-col">
              <div
                @click="selectCategory(cat.name)"
                class="
                  py-2 px-3 cursor-pointer transition-colors duration-150
                  flex items-center justify-between
                "
                :class="
                  activeCategory === cat.name
                    ? 'bg-paper-alt text-ink font-medium shadow-[rgba(0,0,0,0.05)_0px_2px_4px]'
                    : 'text-ink-light hover:bg-paper-alt hover:text-ink'
                "
              >
                <span>{{ cat.name }}</span>
                <span v-if="cat.subcategories && cat.subcategories.length > 0" class="text-paper-dark">
                  +
                </span>
              </div>

              <!-- 子分类（预留扩展） -->
              <ul
                v-if="cat.subcategories && cat.subcategories.length > 0 && activeCategory === cat.name"
                class="
                  pl-6 flex flex-col gap-1 mt-1 mb-2
                  border-l border-paper-dark ml-4
                "
              >
                <li
                  v-for="sub in cat.subcategories"
                  :key="sub"
                  class="py-1 cursor-pointer text-ink-light hover:text-ink transition-colors"
                >
                  — {{ sub }}
                </li>
              </ul>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  </aside>
</template>
