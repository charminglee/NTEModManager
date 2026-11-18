import { useLayoutEffect, type RefObject } from 'react'
import type { groupBySecondaryName } from '@shared/mod-list-logic'

export function useModGroupViewport(
  listRef: RefObject<HTMLDivElement>,
  groups: ReturnType<typeof groupBySecondaryName>,
  viewportKey: string | null
) {
  useLayoutEffect(() => {
    const list = listRef.current
    if (viewportKey === null || !list || groups.length === 0) return

    const bodies = [...list.querySelectorAll<HTMLDivElement>('.mod-group-body')]
    let frame: number | undefined

    const update = () => {
      const viewport = list.getBoundingClientRect()
      const visibleInsets = bodies.map((body) => {
        const bounds = body.getBoundingClientRect()
        const visible = bounds.bottom > viewport.top && bounds.top < viewport.bottom

        return {
          body,
          top: visible ? Math.max(0, viewport.top - bounds.top) : 0,
          bottom: visible ? Math.max(0, bounds.bottom - viewport.bottom) : 0
        }
      })

      for (const { body, top, bottom } of visibleInsets) {
        const topInset = `${top.toFixed(3)}px`
        const bottomInset = `${bottom.toFixed(3)}px`
        if (body.style.getPropertyValue('--group-viewport-top') !== topInset) {
          body.style.setProperty('--group-viewport-top', topInset)
        }
        if (body.style.getPropertyValue('--group-viewport-bottom') !== bottomInset) {
          body.style.setProperty('--group-viewport-bottom', bottomInset)
        }
      }
    }

    function onScroll() {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        update()
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(list)
    for (const body of bodies) observer.observe(body.parentElement!)
    list.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer.disconnect()
      list.removeEventListener('scroll', onScroll)
    }
  }, [listRef, groups, viewportKey])
}
