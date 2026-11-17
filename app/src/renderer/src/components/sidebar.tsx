import { memo } from 'react'
import { Blocks } from 'lucide-react'
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
  const characterCategories = displayCategories.filter(
    (name) => name !== ALL_CATEGORY && name !== OTHER_CATEGORY
  )
  return (
    <aside className="character-sidebar">
      <nav className="character-scroll" aria-label="角色分类">
        {characterCategories.map(categoryButton)}
        {!characterCategories.length && <p className="px-3 py-5 text-sm">暂无角色分类</p>}
      </nav>
      <div className="other-category">
        {categoryButton(OTHER_CATEGORY)}
        {categoryButton(ALL_CATEGORY)}
      </div>
    </aside>
  )
}
export default memo(Sidebar)
