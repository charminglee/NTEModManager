import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { Shader, SolidColor } from 'shaders/react'

const characters = [
  { name: '娜娜莉', count: 12, palette: ['#f56b85', '#bf254c', '#fff1e4', '#a298a7'] },
  { name: '九原', count: 8, palette: ['#9789ec', '#645b7a', '#f0d8cf', '#8b879b'] },
  { name: '薄荷', count: 5, palette: ['#62d5e1', '#1e8faa', '#89feff', '#d8aeb8'] },
  { name: '伊洛伊', count: 9, palette: ['#71d6b7', '#65938c', '#bcdbc7', '#a8727f'] },
  { name: '安魂曲', count: 3, palette: ['#dc76aa', '#ad0b39', '#d8d3eb', '#917686'] }
]
const motion = matchMedia('(prefers-reduced-motion: reduce)')
function subscribeMotion(notify: () => void) {
  motion.addEventListener('change', notify)
  return () => motion.removeEventListener('change', notify)
}

function Preview() {
  const [selected, select] = useState(0)
  const [wave, setWave] = useState({ sequence: 0, x: 0, y: 0, radius: 0 })
  const [engine, setEngine] = useState('正在初始化')
  const reduced = useSyncExternalStore(subscribeMotion, () => motion.matches)
  return <main>
    <small>NTEMM　／　MOTION STUDY　01</small>
    <h1>流彩 · 角色侧栏</h1>
    <section><nav aria-label="角色列表">{characters.map(({ name, count, palette: [accent, second, third, fourth] }, index) => <button key={name}
      style={{ '--accent': accent, '--second': second, '--third': third, '--fourth': fourth } as CSSProperties}
      aria-pressed={selected === index} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        select(index)
        const x = event.detail ? event.clientX - rect.left : rect.width / 2
        const y = event.detail ? event.clientY - rect.top : rect.height / 2
        const radius = Math.ceil(Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y))) + 2
        setWave(last => ({ sequence: last.sequence + 1, x, y, radius }))
      }}>
      {selected === index && <><span className="edge" aria-hidden="true">{!reduced && <Shader className="gpu" disableTelemetry
        onReady={() => setEngine('WebGPU')} onUnavailable={() => setEngine('CSS 流光')}>
        <SolidColor color={accent} />
      </Shader>}</span>{wave.sequence > 0 && <span key={wave.sequence} className="aurora" aria-hidden="true"
        style={{ '--origin': `${wave.x}px ${wave.y}px`, '--radius': `${wave.radius}px` } as CSSProperties} />}</>}
      <img src={`/${name}.png`} alt="" />{name}<b>{count}</b>
    </button>)}</nav><article><small>角色档案　／　{String(selected + 1).padStart(2, '0')}</small>
      <img src={`/${characters[selected].name}.png`} alt="" /><div><output>{reduced ? '静态描边' : engine}</output><h2>{characters[selected].name}</h2></div>
    </article></section><p>点击角色，光波会从落点揭开极光底色。再次点击可重播。</p>
  </main>
}

createRoot(document.getElementById('root')!).render(<Preview />)
