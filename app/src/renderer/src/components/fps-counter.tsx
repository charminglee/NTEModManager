import { useEffect, useState } from 'react'

/**
 * FPS 计数器可在设置界面「高级」中开启，写入配置 Debug/fps_counter。NTEMM_FPS=1 可强制开启。
 * 角标固定在窗口左上角，显示当前秒的帧数。隐藏界面时仍然可见，便于测量。
 */
export default function FpsCounter() {
  const [fps, setFps] = useState('--')

  useEffect(() => {
    let raf = 0
    let bucket = -1
    let bucketCount = 0
    let lastPublish = 0

    const loop = (now: number) => {
      const second = Math.floor(now / 1000)
      if (bucket === -1) {
        bucket = second
      }
      if (second !== bucket) {
        bucket = second
        bucketCount = 0
      }
      bucketCount += 1
      if (now - lastPublish >= 500) {
        lastPublish = now
        setFps(String(bucketCount))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <span className="shrink-0 tabular-nums">
      {fps} FPS
    </span>
  )
}
