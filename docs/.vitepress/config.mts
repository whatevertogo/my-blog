import { defineConfig } from 'vitepress'

const base = '/my-blog/'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "我的技术博客",
  description: "记录技术与生活，沉淀项目文档",
  base,
  appearance: false, // 关闭自带的深色模式，使用暖白纸张风格
  
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}avatar.png` }],
  ],
  
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    siteTitle: "我的技术博客",
    nav: [
      { text: '最新发布', link: '/' },
      { text: '关于', link: '/projects/' },
      { text: '友链', link: '/links/' }
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
      ],
      '/links/': [
        {
          text: '友链',
          items: [
            { text: '我的友链', link: '/links/mylinks' }
          ]
        }
      ]
    },

    socialLinks: [
      {
        icon: {
          svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="github-avatar-clip"><circle cx="12" cy="12" r="12"/></clipPath></defs><image href="${base}avatar.png" width="24" height="24" clip-path="url(#github-avatar-clip)" preserveAspectRatio="xMidYMid slice"/></svg>`
        },
        link: 'https://github.com/whatevertogo',
        ariaLabel: 'GitHub'
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
