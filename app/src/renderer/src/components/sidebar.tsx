import { memo, useState } from 'react'
import { Blocks, Search } from 'lucide-react'
import { ALL_CATEGORY, OTHER_CATEGORY } from '@shared/types'
import { cn } from '@/lib/utils'
interface SidebarProps {
  displayCategories: string[]
  counts: Map<string, number>
  currentCategory: string
  categoryImages: Map<string, string | null>
  onSelectCategory: (category: string) => void
}
function Sidebar({
  displayCategories,
  counts,
  currentCategory,
  categoryImages,
  onSelectCategory
}: SidebarProps) {
  const [query, setQuery] = useState('')
  const categoryButton = (category: string) => {
    const image = categoryImages.get(category)
    return (
      <button
        key={category}
        type="button"
        className={cn('category-row', currentCategory === category && 'is-active')}
        aria-current={currentCategory === category ? 'page' : undefined}
        onClick={() => onSelectCategory(category)}
      >
        {image ? (
          <img src={image} alt="" draggable={false} />
        ) : (
          <span className="category-placeholder">
            <Blocks size={20} />
          </span>
        )}
        <span className="category-name">{category === ALL_CATEGORY ? '全部模组' : category}</span>
        <span className="category-count">{counts.get(category) ?? 0}</span>
      </button>
    )
  }
  const matches = displayCategories.filter(
    (name) => name !== ALL_CATEGORY && name !== OTHER_CATEGORY && name.includes(query.trim())
  )
  return (
    <aside className="character-sidebar">
      <div className="sidebar-heading">
        <h2>角色分类</h2>
        <span className="hazard-mark" aria-hidden />
      </div>
      <label className="character-search">
        <Search size={16} />
        <input
          aria-label="查找角色"
          placeholder="查找角色"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {categoryButton(ALL_CATEGORY)}
      <div className="sidebar-section-label">
        角色
        <span />
      </div>
      <nav className="character-scroll" aria-label="角色分类">
        {matches.map(categoryButton)}
        {!matches.length && <p className="px-3 py-5 text-sm">没有匹配的角色</p>}
      </nav>
      <div className="other-category">{categoryButton(OTHER_CATEGORY)}</div>
    </aside>
  )
}
export default memo(Sidebar)
