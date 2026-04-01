// docs/blog/posts.data.mts
import { createContentLoader } from 'vitepress'

interface Post {
  title: string
  url: string
  date: string
  category?: string
  tags?: string[]
  excerpt?: string
}

declare const data: Post[]
export { data }

export default createContentLoader('blog/posts/*.md', {
  includeSrc: true,
  render: false,
  transform(raw): Post[] {
    return raw
      .filter((page) => page.frontmatter.publish !== false)
      .map((page) => {
        const src = page.src || ''
        // 去掉 frontmatter，取第一段非空内容作为摘要
        const body = src.replace(/^---[\s\S]*?---/, '').trim()
        const firstParagraph = body.split(/\n\n+/).find(p => !p.startsWith('#') && !p.startsWith('```') && p.trim().length > 0) || ''
        const excerpt = firstParagraph.replace(/[#*`[\]]/g, '').slice(0, 150).trim()

        return {
          title: page.frontmatter.title || '无标题',
          url: page.url,
          date: page.frontmatter.date || '1970-01-01',
          category: page.frontmatter.category || '未分类',
          tags: page.frontmatter.tags || [],
          excerpt
        }
      })
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
  }
})