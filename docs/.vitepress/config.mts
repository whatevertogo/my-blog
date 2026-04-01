import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "我的技术博客",
  description: "记录技术与生活，沉淀项目文档",
  base: '/my-blog/', // 配置为目标仓库名
  appearance: false, // 关闭自带的深色模式，使用暖白纸张风格
  
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    siteTitle: "我的技术博客",
    nav: [
      { text: '最新发布', link: '/' },
      { text: '关于', link: '/projects/' }
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
      { 
        icon: {
          svg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><image href="https://github.com/whatevertogo.png" width="24" height="24" preserveAspectRatio="xMidYMid slice" /></svg>'
        }, 
        link: 'https://github.com/whatevertogo' 
      }
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
