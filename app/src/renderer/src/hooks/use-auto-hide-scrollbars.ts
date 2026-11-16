import { useEffect } from 'react'

const scrollbarHideDelay = 800

export function useAutoHideScrollbars() {
  useEffect(() => {
    const hideTimers = new WeakMap<Element, number>()
    const timeoutIds = new Set<number>()
    const visibleElements = new Set<Element>()

    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      target.setAttribute('data-scrollbar-visible', 'true')
      visibleElements.add(target)

      const previousTimer = hideTimers.get(target)
      if (previousTimer !== undefined) {
        window.clearTimeout(previousTimer)
        timeoutIds.delete(previousTimer)
      }

      const timer = window.setTimeout(() => {
        target.removeAttribute('data-scrollbar-visible')
        hideTimers.delete(target)
        timeoutIds.delete(timer)
        visibleElements.delete(target)
      }, scrollbarHideDelay)
      hideTimers.set(target, timer)
      timeoutIds.add(timer)
    }

    document.addEventListener('scroll', onScroll, { capture: true, passive: true })

    return () => {
      document.removeEventListener('scroll', onScroll, true)
      timeoutIds.forEach((timer) => window.clearTimeout(timer))
      visibleElements.forEach((element) => element.removeAttribute('data-scrollbar-visible'))
    }
  }, [])
}
