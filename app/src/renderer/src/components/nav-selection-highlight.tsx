import { useLayoutEffect, useRef } from 'react'

export default function NavSelectionHighlight() {
  const highlightRef = useRef<HTMLSpanElement>(null)
  const selectionRef = useRef<HTMLButtonElement | null>(null)

  useLayoutEffect(() => {
    const highlight = highlightRef.current!
    const container = highlight.parentElement!

    function syncHighlight() {
      const selected = container.querySelector<HTMLButtonElement>('button[aria-current="page"]')
      const previous = selectionRef.current
      selectionRef.current = selected
      highlight.hidden = !selected
      if (!selected) return

      // 按钮和高亮使用同一个定位容器，滚动项只保留视口内的部分。
      let top = selected.offsetTop
      let bottom = top + selected.offsetHeight
      const scroll = selected.closest<HTMLElement>('[data-nav-selection-scroll]')
      if (scroll) {
        const start = scroll.offsetTop
        const end = start + scroll.clientHeight
        top = Math.min(end, Math.max(start, top - scroll.scrollTop))
        bottom = Math.min(end, Math.max(start, bottom - scroll.scrollTop))
      }

      const transform = `translate(${selected.offsetLeft}px, ${top}px)`
      const width = `${selected.offsetWidth}px`
      const height = `${bottom - top}px`
      const style = highlight.style
      if (style.transform === transform && style.width === width && style.height === height) return

      highlight.toggleAttribute('data-moving', previous !== null && previous !== selected)
      style.transform = transform
      style.width = width
      style.height = height
    }

    syncHighlight()
    const observer = new ResizeObserver(syncHighlight)
    observer.observe(container)
    for (const child of container.children) {
      if (child !== highlight) observer.observe(child)
    }
    container.addEventListener('scroll', syncHighlight, true)
    return () => {
      observer.disconnect()
      container.removeEventListener('scroll', syncHighlight, true)
    }
  })

  return <span ref={highlightRef} className="nav-selection-highlight" aria-hidden="true" hidden />
}
