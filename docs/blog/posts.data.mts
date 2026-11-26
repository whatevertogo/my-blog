// docs/blog/posts.data.mts
import { createContentLoader } from 'vitepress'

export interface Post {
  title: string
  url: string
  date: string
  category?: string
  tags?: string[]
  description?: string
  excerpt?: string
  wordCount: number
  readingMinutes: number
}

declare const data: Post[]
export { data }

function estimateWordCount(markdownBody: string): number {
  const plain = markdownBody
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~\-|]/g, ' ')
  const cjk = (plain.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const latinWords = (plain.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[A-Za-z0-9_.\-]+/g) || []).length
  return cjk + latinWords
}

export default createContentLoader('blog/posts/*.md', {
  includeSrc: true,
  render: false,
  transform(raw): Post[] {
    return raw
      .filter((page) => page.frontmatter.publish !== false)
      .map((page) => {
        const src = page.src || ''
        const body = src.replace(/^---[\s\S]*?---/, '').trim()
        const firstParagraph =
          body
            .split(/\n\n+/)
            .find((p) => !p.startsWith('#') && !p.startsWith('```') && p.trim().length > 0) || ''
        const excerpt = firstParagraph.replace(/[#*`[\]]/g, '').slice(0, 150).trim()
        const wordCount = estimateWordCount(body)
        const readingMinutes = Math.max(1, Math.ceil(wordCount / 320))

        return {
          title: page.frontmatter.title || '无标题',
          url: page.url,
          date: page.frontmatter.date || '1970-01-01',
          category: page.frontmatter.category || '未分类',
          tags: page.frontmatter.tags || [],
          description: page.frontmatter.description || '',
          excerpt,
          wordCount,
          readingMinutes,
        }
      })
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
  },
})
