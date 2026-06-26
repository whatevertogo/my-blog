import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    // 全局 v-reveal 指令：元素进入视口时加 .is-visible，触发 CSS 入场过渡。
    // once 模式，极轻量。无障碍方面尊重 prefers-reduced-motion（由 CSS 统一兜底）。
    app.directive('reveal', {
      mounted(el: HTMLElement) {
        // 已经在视口内或平台不支持 IO 时，直接显示，避免内容被隐藏
        if (typeof IntersectionObserver === 'undefined') {
          el.classList.add('is-visible')
          return
        }
        el.classList.add('reveal')
        const io = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                el.classList.add('is-visible')
                io.unobserve(el)
              }
            })
          },
          { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
        )
        io.observe(el)
        // 元素卸载时清理观察，防止泄漏
        ;(el as any)._revealIO = io
      },
      unmounted(el: HTMLElement) {
        ;(el as any)._revealIO?.disconnect()
      },
    })
  },
} satisfies Theme
