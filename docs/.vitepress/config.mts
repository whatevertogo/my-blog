import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "我的技术博客",
  description: "记录技术与生活，沉淀项目文档",
  base: '/my-blog/', // 配置为目标仓库名
  appearance: 'dark', // 强制或默认开启深色模式以契合极简深色风格
  
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: '博客', link: '/blog/' },
      { text: '项目文档', link: '/projects/' }
    ],

    sidebar: {
      '/projects/': [
        {
          text: '示例项目',
          items: [
            { text: '项目介绍', link: '/projects/' },
            { text: '快速开始', link: '/projects/quickstart' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
    ],

    search: {
      provider: 'local'
    },
    
    outline: {
      level: [2, 3],
      label: '页面导航'
    }
  }
})
