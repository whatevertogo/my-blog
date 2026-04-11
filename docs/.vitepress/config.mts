import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "我的技术博客",
  description: "记录技术与生活，沉淀项目文档",
  base: '/my-blog/', // 配置为目标仓库名
  appearance: false, // 关闭自带的深色模式，使用暖白纸张风格
  
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/avatar.png' }],
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
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><foreignObject width="24" height="24"><img src="/avatar.png" width="24" height="24" style="border-radius:50%;object-fit:cover;"/></foreignObject></svg>'
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
