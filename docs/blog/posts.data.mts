// docs/blog/posts.data.mts
import { createContentLoader } from 'vitepress'

interface Post {
  title: string
  url: string
  date: string
  category?: string
  tags?: string[]
}

declare const data: Post[]
export { data }

export default createContentLoader('blog/posts/*.md', {
  includeSrc: false,
  render: false,
  transform(raw): Post[] {
    return raw
      .filter((page) => page.frontmatter.publish !== false)
      .map((page) => ({
        title: page.frontmatter.title || '无标题',
        url: page.url,
        date: page.frontmatter.date || '1970-01-01',
        category: page.frontmatter.category || '未分类',
        tags: page.frontmatter.tags || []
      }))
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
  }
})