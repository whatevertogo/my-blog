<script setup>
import { ref } from 'vue'
import { withBase } from 'vitepress'

defineProps({
  categories: {
    type: Array,
    required: true,
  },
  activeCategory: {
    type: [String, null],
    default: null,
  },
  totalPosts: {
    type: Number,
    default: 0,
  },
  totalWordsLabel: {
    type: String,
    default: '0',
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
      aria-label="Toggle sidebar"
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
      <div class="w-72 h-full px-6 py-8 overflow-y-auto flex flex-col justify-between gap-8">
        <div>
          <!-- Blog 标识 + 方正头像 -->
          <div class="mb-9 flex items-center gap-3.5">
            <img
              :src="withBase('/avatar.png')"
              alt="whatevertogo"
              class="w-10 h-10 object-cover border border-paper-dark bg-paper-alt flex-shrink-0"
            />
            <div>
              <h1 class="font-serif text-xl font-bold tracking-tight text-ink leading-tight">
                whatevertogo
              </h1>
              <p class="text-[11px] text-ink-light mt-1 font-sans tracking-[0.18em] uppercase">
                Engineering & Notes
              </p>
            </div>
          </div>

          <!-- 目录导航 -->
          <nav class="font-sans text-sm mb-8">
            <div class="directory-label mb-3 text-xs font-semibold text-ink-faint uppercase tracking-widest flex items-center gap-2">
              <span class="directory-rule"></span>
              Directory
            </div>
            <ul class="flex flex-col gap-1">
              <!-- All Publications -->
              <li
                @click="selectCategory(null)"
                class="nav-item py-2 px-3 cursor-pointer relative overflow-hidden flex items-center justify-between transition-colors duration-200"
                :class="
                  activeCategory === null
                    ? 'nav-active bg-paper-alt text-ink font-medium'
                    : 'text-ink-light hover:bg-paper-alt hover:text-ink'
                "
              >
                <span class="nav-bar"></span>
                <span>All Publications</span>
                <span class="text-[11px] tabular-nums text-ink-faint">{{ totalPosts }}</span>
              </li>

              <!-- 分类列表 -->
              <li v-for="cat in categories" :key="cat.name" class="flex flex-col">
                <div
                  @click="selectCategory(cat.name)"
                  class="
                    nav-item py-2 px-3 cursor-pointer relative overflow-hidden
                    flex items-center justify-between transition-colors duration-200
                  "
                  :class="
                    activeCategory && activeCategory.toLowerCase() === cat.name.toLowerCase()
                      ? 'nav-active bg-paper-alt text-ink font-medium'
                      : 'text-ink-light hover:bg-paper-alt hover:text-ink'
                  "
                >
                  <span class="nav-bar"></span>
                  <span>{{ cat.name }}</span>
                  <span class="text-[11px] tabular-nums text-ink-faint">{{ cat.count }}</span>
                </div>
              </li>
            </ul>
          </nav>

          <!-- 站点页面直达 -->
          <nav class="font-sans text-sm">
            <div class="directory-label mb-3 text-xs font-semibold text-ink-faint uppercase tracking-widest flex items-center gap-2">
              <span class="directory-rule"></span>
              Pages
            </div>
            <ul class="flex flex-col gap-1">
              <li>
                <a
                  :href="withBase('/projects/')"
                  class="side-link py-1.5 px-3 flex items-center justify-between text-ink-light hover:text-ink hover:bg-paper-alt transition-colors duration-200"
                >
                  <span>关于</span>
                  <span class="text-xs text-ink-faint">→</span>
                </a>
              </li>
              <li>
                <a
                  :href="withBase('/links/mylinks')"
                  class="side-link py-1.5 px-3 flex items-center justify-between text-ink-light hover:text-ink hover:bg-paper-alt transition-colors duration-200"
                >
                  <span>友链</span>
                  <span class="text-xs text-ink-faint">→</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/whatevertogo"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="side-link py-1.5 px-3 flex items-center justify-between text-ink-light hover:text-ink hover:bg-paper-alt transition-colors duration-200"
                >
                  <span>GitHub</span>
                  <span class="text-xs text-ink-faint">↗</span>
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <!-- 底部极简站点统计（借鉴友链博客的统计区块，保持纸墨风格） -->
        <div class="border-t border-paper-dark pt-5 font-sans">
          <div class="grid grid-cols-2 gap-3 text-left">
            <div class="border border-paper-dark bg-paper-alt/40 px-3 py-2">
              <div class="text-[10px] uppercase tracking-widest text-ink-faint">Articles</div>
              <div class="font-serif text-lg font-bold text-ink tabular-nums mt-0.5">{{ totalPosts }}</div>
            </div>
            <div class="border border-paper-dark bg-paper-alt/40 px-3 py-2">
              <div class="text-[10px] uppercase tracking-widest text-ink-faint">Words</div>
              <div class="font-serif text-lg font-bold text-ink tabular-nums mt-0.5">{{ totalWordsLabel }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 目录标签前的装饰短线 */
.directory-rule {
  display: inline-block;
  width: 14px;
  height: 1px;
  background-color: var(--vp-c-text-3, #8f8a84);
}

/* active 项的左侧墨线指示条：默认收起，active 时从顶向下展开 */
.nav-bar {
  position: absolute;
  left: 0;
  top: 0;
  width: 2px;
  height: 100%;
  background-color: var(--vp-c-text-1, #222222);
  transform: scaleY(0);
  transform-origin: top center;
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.nav-active .nav-bar {
  transform: scaleY(1);
}

.side-link {
  text-decoration: none;
}

/* hover 时也轻微显出指示条，增强反馈 */
@media (hover: hover) {
  .nav-item:hover .nav-bar {
    transform: scaleY(0.4);
    opacity: 0.5;
  }
  .nav-active:hover .nav-bar {
    transform: scaleY(1);
    opacity: 1;
  }
}
</style>
