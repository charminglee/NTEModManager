import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { ModInfo } from '@shared/types'

/** 仅为可见模组的排序和筛选补间位置，不延迟业务状态更新。 */
export function useModListMotion(
  listRef: RefObject<HTMLDivElement>,
  mods: ModInfo[],
  category: string,
  view: string
) {
  const previous = useRef(new Map<string, number>())
  const previousCategory = useRef(category)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      previous.current.clear()
      return
    }
    const viewport = list.getBoundingClientRect()
    const positions = new Map<string, number>()
    const animations: Animation[] = []
    const measurements = [...list.querySelectorAll<HTMLElement>('[data-mod-name]')].map((row) => ({
      row,
      rect: row.getBoundingClientRect()
    }))
    // 批量读取后再写入，避免逐行交错触发布局。
    for (const { row, rect } of measurements) {
      const name = row.dataset.modName!
      const top = rect.top - viewport.top + list.scrollTop
      positions.set(name, top)
      const oldTop = previousCategory.current === category ? previous.current.get(name) : undefined
      if (oldTop === undefined || rect.bottom < viewport.top || rect.top > viewport.bottom) continue
      const offset = oldTop - top
      if (Math.abs(offset) < 1) continue
      const travel = Math.max(-32, Math.min(32, offset))
      animations.push(
        row.animate(
          [
            { transform: `translateY(${travel}px)`, opacity: 0.72 },
            { transform: 'translateY(0)', opacity: 1 }
          ],
          { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
        )
      )
    }
    previous.current = positions
    previousCategory.current = category
    return () => animations.forEach((animation) => animation.cancel())
  }, [listRef, mods, category, view])
}
