import { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { MeshGradient, Shader } from 'shaders/react'

const names = ['娜娜莉', '九原', '薄荷', '伊洛伊', '安魂曲']
const counts = [12, 8, 5, 9, 3]
const motion = matchMedia('(prefers-reduced-motion: reduce)')
function subscribeMotion(notify: () => void) {
  motion.addEventListener('change', notify)
  return () => motion.removeEventListener('change', notify)
}

function Preview() {
  const [selected, select] = useState(0)
  const [wave, setWave] = useState({ sequence: 0, x: 0, y: 0 })
  const [engine, setEngine] = useState('正在初始化')
  const reduced = useSyncExternalStore(subscribeMotion, () => motion.matches)
  return <main>
    <small>NTEMM　／　MOTION STUDY　01</small>
    <h1>流金 · 角色侧栏</h1>
    <section><nav aria-label="角色列表">{names.map((name, index) => <button key={name}
      aria-pressed={selected === index} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        select(index)
        const x = event.detail ? event.clientX - rect.left : rect.width / 2
        const y = event.detail ? event.clientY - rect.top : rect.height / 2
        setWave(last => ({ sequence: last.sequence + 1, x, y }))
      }}>
      {selected === index && <><span className="edge" aria-hidden="true">{!reduced && <Shader className="gpu" disableTelemetry
        onReady={() => setEngine('WebGPU')} onUnavailable={() => setEngine('CSS 流光')}>
        <MeshGradient colorA="#664522" colorB="#fff0ac" speed={0.65} />
      </Shader>}</span>{wave.sequence > 0 && <span key={wave.sequence} className="wave" aria-hidden="true" style={{ left: wave.x, top: wave.y }} />}</>}
      <img src={`/${name}.png`} alt="" />{name}<b>{counts[index]}</b>
    </button>)}</nav><article><small>角色档案　／　{String(selected + 1).padStart(2, '0')}</small>
      <img src={`/${names[selected]}.png`} alt="" /><div><output>{reduced ? '静态描边' : engine}</output><h2>{names[selected]}</h2></div>
    </article></section><p>点击角色切换流光，重复点击可重播光波。</p>
  </main>
}

createRoot(document.getElementById('root')!).render(<Preview />)
