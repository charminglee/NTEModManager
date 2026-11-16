import { useEffect, useRef, useState, type ReactElement } from 'react'

/** 为应用中的条件面板保留退场时间，重新打开时立即取消卸载。 */
export default function MotionPresence({
  present,
  children
}: {
  present: boolean
  children: ReactElement | null
}) {
  const [mounted, setMounted] = useState(present)
  const retained = useRef(children)
  useEffect(() => {
    if (present) retained.current = children
  }, [present, children])
  useEffect(() => {
    if (present) return
    const timer = window.setTimeout(
      () => setMounted(false),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200
    )
    return () => window.clearTimeout(timer)
  }, [present])
  if (present && !mounted) setMounted(true)
  if (!present && !mounted) return null
  return (
    <div
      className="motion-presence"
      data-state={present ? 'open' : 'closed'}
      {...(!present ? { inert: '' } : {})}
      onAnimationEnd={(event) => {
        if (!present && event.animationName === 'motion-exit') setMounted(false)
      }}
    >
      {present ? children : retained.current}
    </div>
  )
}
