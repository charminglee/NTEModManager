import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'
import Switch from './ui/switch'
import { atlasRegions, atlasUV, type TextureSet } from './workbench-spine-atlas'
import type { Attachment, SpineModel } from './workbench-spine-model'
import { createPose } from './workbench-spine-pose'

export default function SpinePreview({
  model,
  textures,
  animation
}: {
  model: SpineModel
  textures: TextureSet | null
  animation: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(true)
  const [overlay, setOverlay] = useState(false)
  const playback = useRef({ playing, overlay })
  playback.current = { playing, overlay }
  useEffect(() => {
    const target = canvas.current!
    const gl = target.getContext('webgl', { alpha: true, antialias: true })
    if (!gl) {
      setError('当前设备未启用 WebGL。')
      return
    }
    const program = gl.createProgram()!
    const buffer = gl.createBuffer()
    const elements = gl.createBuffer()
    const maps = new Map<string, WebGLTexture>()
    let frame = 0
    try {
      const shaders: [number, string][] = [
        [
          gl.VERTEX_SHADER,
          'attribute vec2 pos,uv; uniform vec2 center,scale; varying vec2 v; void main(){gl_Position=vec4((pos-center)*scale,0.,1.);v=uv;}'
        ],
        [
          gl.FRAGMENT_SHADER,
          'precision mediump float; varying vec2 v; uniform sampler2D page; uniform bool wire; uniform float opacity; void main(){gl_FragColor=wire?vec4(0.3,0.75,0.9,0.8):texture2D(page,v)*vec4(1.,1.,1.,opacity);}'
        ]
      ]
      for (const [type, source] of shaders) {
        const shader = gl.createShader(type)!
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        gl.attachShader(program, shader)
        gl.deleteShader(shader)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!)
      gl.useProgram(program)
      const pos = gl.getAttribLocation(program, 'pos'),
        uv = gl.getAttribLocation(program, 'uv')
      const uniform = (key: string) => gl.getUniformLocation(program, key)
      const wire = uniform('wire'),
        opacity = uniform('opacity'),
        scale = uniform('scale')
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements)
      gl.enableVertexAttribArray(pos)
      gl.enableVertexAttribArray(uv)
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0)
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8)
      gl.enable(gl.BLEND)
      const regions = atlasRegions(textures?.atlas ?? '')
      for (const [name, image] of Object.entries(textures?.images ?? {})) {
        const tex = gl.createTexture()!
        maps.set(name, tex)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        for (const param of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
          gl.texParameteri(gl.TEXTURE_2D, param, gl.CLAMP_TO_EDGE)
        for (const param of [gl.TEXTURE_MAG_FILTER, gl.TEXTURE_MIN_FILTER])
          gl.texParameteri(gl.TEXTURE_2D, param, gl.LINEAR)
      }
      const pose = createPose(model, animation, regions)
      const width = model.skeleton.width || 500,
        height = model.skeleton.height || 500
      gl.uniform2f(
        uniform('center'),
        (model.skeleton.x ?? -width / 2) + width / 2,
        (model.skeleton.y ?? -height / 2) + height / 2
      )
      const cache = new Map<
        Attachment,
        { coords: number[]; triangles: Uint16Array; lines: Uint16Array; tex?: WebGLTexture }
      >()
      let last = performance.now(),
        time = 0
      const draw = (now: number) => {
        try {
          if (!target.clientWidth || !target.clientHeight) {
            last = now
            frame = requestAnimationFrame(draw)
            return
          }
          if (playback.current.playing && pose.duration)
            time = (time + Math.min((now - last) / 1000, 0.12)) % pose.duration
          last = now
          const w = Math.max(1, Math.round(target.clientWidth * devicePixelRatio)),
            h = Math.max(1, Math.round(target.clientHeight * devicePixelRatio))
          if (target.width !== w || target.height !== h) {
            target.width = w
            target.height = h
          }
          gl.viewport(0, 0, w, h)
          gl.clear(gl.COLOR_BUFFER_BIT)
          const zoom = 1.9 * Math.min(w / width, h / height)
          gl.uniform2f(scale, zoom / w, zoom / h)
          pose.sample(time, (att, name, points, alpha, additive) => {
            let mesh = cache.get(att)
            if (!mesh) {
              const region = regions.get(name),
                image = region && textures?.images[region.page]
              const triangles = new Uint16Array(att.triangles!)
              const lines = new Uint16Array(triangles.length * 2)
              for (let i = 0; i < triangles.length; i += 3) {
                const [a, b, c] = triangles.subarray(i, i + 3)
                lines.set([a, b, b, c, c, a], i * 2)
              }
              mesh = {
                triangles,
                lines,
                coords: image && region ? atlasUV(att.uvs!, region, image.width, image.height) : att.uvs!,
                tex: region && maps.get(region.page)
              }
              cache.set(att, mesh)
            }
            const vertices = new Float32Array(points.length * 2)
            for (let i = 0; i < points.length; i += 2)
              vertices.set([points[i], points[i + 1], mesh.coords[i], mesh.coords[i + 1]], i * 2)
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW)
            gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA)
            gl.uniform1f(opacity, alpha)
            if (mesh.tex) {
              gl.bindTexture(gl.TEXTURE_2D, mesh.tex)
              gl.uniform1i(wire, 0)
              gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.triangles, gl.STREAM_DRAW)
              gl.drawElements(gl.TRIANGLES, mesh.triangles.length, gl.UNSIGNED_SHORT, 0)
            }
            if (!mesh.tex || playback.current.overlay) {
              gl.uniform1i(wire, 1)
              gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.lines, gl.STREAM_DRAW)
              gl.drawElements(gl.LINES, mesh.lines.length, gl.UNSIGNED_SHORT, 0)
            }
          })
          if (!textures || playback.current.overlay) {
            const lines = pose.bones.flatMap((b) => [
              b.worldX,
              b.worldY,
              0,
              0,
              b.worldX + b.a * (b.length || 5),
              b.worldY + b.c * (b.length || 5),
              0,
              0
            ])
            gl.uniform1i(wire, 1)
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW)
            gl.drawArrays(gl.LINES, 0, lines.length / 4)
          }
          frame = requestAnimationFrame(draw)
        } catch (reason) {
          setError(String(reason))
        }
      }
      setError('')
      draw(last)
    } catch (reason) {
      setError(String(reason))
    }
    return () => {
      cancelAnimationFrame(frame)
      for (const tex of maps.values()) gl.deleteTexture(tex)
      gl.deleteBuffer(buffer)
      gl.deleteBuffer(elements)
      gl.deleteProgram(program)
    }
  }, [model, textures, animation])
  return (
    <section className="workbench-panel">
      <header className="workbench-panel-heading"><h2>动画预览</h2></header>
      <div className="grid gap-3 p-4">
        <canvas className="block h-80 w-full rounded-md bg-(--ink)" ref={canvas} aria-label="Spine 动画预览" />
        {error && <p role="alert" className="break-all text-sm text-destructive">{error}</p>}
        {Boolean(model.physics?.length) && (
          <p className="text-xs text-muted-foreground">游戏物理约束需在游戏中验证。</p>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-4 border-t px-4 py-3 text-sm">
        <Button size="sm" variant="secondary" type="button" onClick={() => setPlaying(!playing)}>
          {playing ? '暂停' : '播放'}
        </Button>
        <label className="flex items-center gap-2">
          <span>骨架与网格</span>
          <Switch
            aria-label="骨架与网格"
            checked={!textures || overlay}
            disabled={!textures}
            onCheckedChange={setOverlay}
          />
        </label>
      </footer>
    </section>
  )
}
