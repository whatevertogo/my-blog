import React, { useState } from 'react';

// --- Mock Data ---
const categories = [
  {
    name: 'AI Agents',
    subcategories: ['Subagent 架构', '记忆系统']
  },
  {
    name: 'Game Engine Dev',
    subcategories: ['Unity', 'C# Toolchain']
  },
  {
    name: 'Rust Projects',
    subcategories: []
  },
  {
    name: 'CLI Tools',
    subcategories: []
  }
];

const mockPosts = [
  {
    id: 1,
    title: '构建具有长程记忆的自动化 Agent 系统',
    date: 'Apr 01, 2026',
    author: 'whatevertogo',
    summary: '探讨如何基于本地文件系统和向量数据库，为大语言模型赋予跨越多次会话的持久化记忆能力。本文深入分析了不同层级记忆域的架构设计。',
    category: 'AI Agents',
    tags: ['Memory System', 'LLM', 'Architecture']
  },
  {
    id: 2,
    title: 'Rust 在命令行工具开发中的最佳实践',
    date: 'Mar 28, 2026',
    author: 'whatevertogo',
    summary: '相较于传统的 Bash 脚本或 Python，Rust 提供了无与伦比的性能与类型安全。这篇指南涵盖了 Clap、Serde 等核心库的使用，以及如何打包分发二进制文件。',
    category: 'CLI Tools',
    tags: ['Rust', 'CLI', 'Performance']
  },
  {
    id: 3,
    title: '深入浅出：Unity DOTS 与面向数据的编程范式',
    date: 'Mar 15, 2026',
    author: 'whatevertogo',
    summary: '传统 OOP 在处理海量实体时遇到性能瓶颈。本文通过一个具体的寻路算法案例，解析 Unity Data-Oriented Technology Stack (DOTS) 如何将 CPU 缓存命中率推向极致。',
    category: 'Game Engine Dev',
    tags: ['Unity', 'DOTS', 'C#', 'Optimization']
  },
  {
    id: 4,
    title: '设计一个可扩展的 Subagent 并行协作框架',
    date: 'Feb 10, 2026',
    author: 'whatevertogo',
    summary: '当单个模型无法处理复杂任务时，我们需要引入层级化 Agent 架构。本研究提出了一种基于消息总线和状态机的非阻塞式异步分发系统。',
    category: 'AI Agents',
    tags: ['Multi-Agent', 'Concurrency', 'System Design']
  }
];

const hotTags = ['LLM', 'Rust', 'Architecture', 'Unity'];

// --- Components ---

const Sidebar = ({ activeCategory, onSelectCategory }) => {
  return (
    <aside className="w-72 border-r border-stone-300 h-screen sticky top-0 overflow-y-auto px-6 py-8 hidden md:block">
      <div className="mb-10">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 border-none">whatevertogo</h1>
        <p className="text-sm text-stone-500 mt-2 font-sans tracking-wide uppercase">Engineering & Notes</p>
      </div>

      <nav className="font-sans text-sm">
        <div className="mb-4 text-xs font-semibold text-stone-400 uppercase tracking-widest">Directory</div>
        <ul className="flex flex-col gap-1">
          <li 
            className={`py-2 px-3 cursor-pointer transition-colors duration-150 ${activeCategory === null ? 'bg-stone-200 text-stone-900 font-medium' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'}`}
            onClick={() => onSelectCategory(null)}
          >
            All Publications
          </li>
          
          {categories.map((cat) => (
            <li key={cat.name} className="flex flex-col">
              <div 
                className={`py-2 px-3 cursor-pointer transition-colors duration-150 flex items-center justify-between ${activeCategory === cat.name ? 'bg-stone-200 text-stone-900 font-medium' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'}`}
                onClick={() => onSelectCategory(cat.name)}
              >
                <span>{cat.name}</span>
                {cat.subcategories.length > 0 && <span className="text-stone-300">+</span>}
              </div>
              
              {/* Optional: Subcategories logic could go here if we wanted to expand/collapse explicitly. 
                  For now, cleanly laying them out under the parent if matched. */}
              {cat.subcategories.length > 0 && activeCategory === cat.name && (
                <ul className="pl-6 flex flex-col gap-1 mt-1 mb-2 border-l border-stone-200 ml-4">
                  {cat.subcategories.map(sub => (
                     <li key={sub} className="py-1 cursor-pointer text-stone-500 hover:text-stone-900 transition-colors">
                       — {sub}
                     </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};

const SearchHero = ({ categoryContext, searchQuery, setSearchQuery }) => {
  return (
    <div className="mb-12 border-b border-stone-300 pb-8">
      <div className="font-sans text-sm text-stone-500 mb-3 uppercase tracking-wide">
        Search / {categoryContext ? categoryContext : 'Global'}
      </div>
      <div className="relative">
        <svg 
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" 
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
        </svg>
        <input 
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by keywords, tags, or concepts..."
          className="w-full bg-transparent border border-stone-300 px-12 py-4 text-lg font-serif text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 transition-colors rounded-none"
        />
      </div>
      <div className="flex items-center gap-3 mt-4 text-sm font-sans text-stone-500">
        <span>Tags:</span>
        {hotTags.map(tag => (
           <button key={tag} className="border border-stone-300 px-2 py-0.5 hover:bg-stone-900 hover:text-stone-100 transition-colors">
             {tag}
           </button>
        ))}
      </div>
    </div>
  );
};

const PostItem = ({ post }) => {
  return (
    <article className="py-8 border-b border-stone-300 last:border-b-0 group">
      <div className="flex flex-col md:flex-row md:items-baseline gap-4 md:gap-8 mb-3">
        <time className="font-sans text-xs uppercase tracking-widest text-stone-500 min-w-[120px] tabular-nums">
          {post.date}
        </time>
        <h2 className="font-serif text-2xl font-bold text-stone-900 group-hover:text-stone-600 transition-colors leading-tight cursor-pointer">
          {post.title}
        </h2>
      </div>
      
      <div className="flex flex-col md:flex-row gap-4 md:gap-8">
        <div className="hidden md:block min-w-[120px]">
          {/* Empty spacer to align with date above */}
        </div>
        <div>
          <p className="font-serif text-stone-700 text-lg leading-relaxed mb-4 max-w-3xl">
            {post.summary}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-sans text-xs text-stone-500 uppercase tracking-wider">
            <span className="font-bold text-stone-900 border-b border-stone-900 pb-0.5">{post.category}</span>
            <span className="text-stone-300">|</span>
            {post.tags.map((tag, index) => (
              <React.Fragment key={tag}>
                <span className="cursor-pointer hover:text-stone-900 transition-colors">{tag}</span>
                {index < post.tags.length - 1 && <span className="text-stone-300">•</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
};

export default function EditorialBlog() {
  const [activeCategory, setActiveCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Derived state: filter posts based on active category and search query
  const filteredPosts = mockPosts.filter(post => {
    const matchesCategory = activeCategory ? post.category === activeCategory : true;
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = 
      post.title.toLowerCase().includes(searchLower) ||
      post.summary.toLowerCase().includes(searchLower) ||
      post.tags.some(tag => tag.toLowerCase().includes(searchLower));
      
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-stone-800 font-sans flex selection:bg-stone-300 selection:text-stone-900">
      
      <Sidebar 
        activeCategory={activeCategory} 
        onSelectCategory={setActiveCategory} 
      />

      <main className="flex-1 max-w-5xl mx-auto px-6 py-8 md:px-12 md:py-12">
        {/* Mobile Header (Hidden on Desktop) */}
        <div className="md:hidden flex items-center justify-between border-b border-stone-300 pb-4 mb-8">
          <h1 className="font-serif text-xl font-bold text-stone-900">whatevertogo</h1>
          <button className="border border-stone-300 px-3 py-1 text-sm font-medium uppercase tracking-wide">Menu</button>
        </div>

        <SearchHero 
          categoryContext={activeCategory} 
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />

        <div className="flex justify-between items-end mb-4 font-sans text-xs uppercase tracking-widest text-stone-500 border-b border-stone-300 pb-2">
          <span>{filteredPosts.length} Results</span>
          <span>Sort by: Latest ↓</span>
        </div>

        <div className="flex flex-col">
          {filteredPosts.length > 0 ? (
            filteredPosts.map(post => (
              <PostItem key={post.id} post={post} />
            ))
          ) : (
            <div className="py-12 text-center text-stone-500 font-serif text-lg">
              No publications matching your criteria.
            </div>
          )}
        </div>
        
        {/* Simple Footer/Pagination indication */}
        {filteredPosts.length > 0 && (
          <div className="mt-12 pt-8 border-t border-stone-300 flex justify-between items-center font-sans text-sm font-medium uppercase tracking-wide text-stone-500">
            <button className="text-stone-300 cursor-not-allowed">← Previous</button>
            <button className="hover:text-stone-900 transition-colors">Next →</button>
          </div>
        )}
      </main>
      
    </div>
  );
}
