import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import WorkbenchSelect from './workbench-select'
import {
  addInfluence,
  meshList,
  vertexOffsets,
  type Bone,
  type Keyframe,
  type SpineModel
} from './workbench-spine-model'

const fields = ['x', 'y', 'rotation', 'length', 'scaleX', 'scaleY'] as const
const labels = ['横坐标', '纵坐标', '旋转角度', '长度', '横向缩放', '纵向缩放']
const tracks = ['rotate', 'translate', 'translatex', 'translatey', 'scale', 'scalex', 'scaley']
function field(label: string, value: number, key: string, min?: number) {
  return (
    <label key={key} className="grid gap-1">
      {label}
      <Input
        type="number"
        name={key}
        required
        step="any"
        min={min}
        defaultValue={value}
      />
    </label>
  )
}
export default function Inspector({
  model,
  animation,
  setAnimation,
  edit,
  disabled
}: {
  model: SpineModel
  animation: string
  setAnimation: (v: string) => void
  edit: (change: (copy: SpineModel) => void) => void
  disabled: boolean
}) {
  const [tab, setTab] = useState('骨骼')
  const [boneIndex, setBone] = useState(0)
  const [meshIndex, setMesh] = useState(0)
  const [vertex, setVertex] = useState(0)
  const [track, setTrack] = useState('rotate')
  const [index, setIndex] = useState(0)
  const bone = model.bones[Math.min(boneIndex, model.bones.length - 1)]
  const meshes = meshList(model)
  const mesh = meshes[meshIndex]
  const verts = mesh?.attachment.vertices ?? []
  const count = (mesh?.attachment.uvs?.length ?? 0) / 2
  const weighted = verts.length !== count * 2
  const offset = weighted ? vertexOffsets(verts, count)[vertex] : vertex * 2
  const rows = weighted ? verts[offset] : 0
  const frames = model.animations[animation]?.bones?.[bone.name]?.[track] ?? []
  const current = frames[index] ?? {}
  const pair = track === 'scale' || track === 'translate'
  const axis = pair ? (['x', 'y'] as const) : (['value'] as const)
  const boneOptions = model.bones.map((bone, index) => [String(index), bone.name] as const)
  return (
    <div className="grid gap-3 p-4 text-sm">
      <div role="group" aria-label="编辑属性分组" className="flex flex-wrap gap-2">
        {['骨骼', '网格权重', '动画关键帧'].map((t) => (
          <Button size="sm" aria-pressed={tab === t} variant={tab === t ? 'default' : 'secondary'} key={t} onClick={() => setTab(t)}>
            {t}
          </Button>
        ))}
      </div>
      {tab !== '网格权重' && (
        <label className="grid gap-1">
          骨骼
          <WorkbenchSelect
            label="骨骼" disabled={disabled} options={boneOptions}
            value={String(Math.min(boneIndex, model.bones.length - 1))}
            onValueChange={(value) => {
              setBone(Number(value))
              setIndex(0)
            }}
          />
        </label>
      )}
      {tab === '骨骼' && (
        <>
          <form
            key={JSON.stringify(bone)}
            className="grid grid-cols-2 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              edit((copy) => {
                const target = copy.bones.find((b) => b.name === bone.name)!
                for (const key of fields) target[key] = Number(form.get(key))
                if (target.parent) target.parent = String(form.get('parent'))
              })
            }}
          >
            {bone.parent && (
              <label className="col-span-2 grid gap-1">
                父骨骼
                <WorkbenchSelect label="父骨骼" name="parent" disabled={disabled} defaultValue={bone.parent}
                  options={model.bones.slice(0, model.bones.indexOf(bone)).map((b) => [b.name, b.name])} />
              </label>
            )}
            {fields.map((key, i) => field(labels[i], bone[key] ?? (key.startsWith('scale') ? 1 : 0), key))}
            <Button size="sm" className="col-span-2">
              应用骨骼变换
            </Button>
          </form>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const name = String(new FormData(e.currentTarget).get('name')).trim()
              edit((copy) => {
                if (!name || copy.bones.some((b) => b.name === name))
                  throw new Error('请输入唯一的骨骼名称。')
                const child: Bone = { name, parent: bone.name, length: 30 }
                copy.bones.push(child)
              })
            }}
          >
            <Input
              name="name"
              aria-label="子骨骼名称"
              placeholder="子骨骼名称"
              required
              className="w-auto flex-1 basis-32"
            />
            <Button variant="secondary">
              新增子骨骼
            </Button>
          </form>
        </>
      )}
      {tab === '网格权重' &&
        (mesh ? (
          <>
            <label className="grid gap-1">
              网格
              <WorkbenchSelect
                label="网格" disabled={disabled} options={meshes.map((m, i) => [String(i), m.label])}
                value={String(meshIndex)}
                onValueChange={(value) => {
                  setMesh(Number(value))
                  setVertex(0)
                }}
              />
            </label>
            <label className="grid gap-1">
              顶点编号（共 {count} 个）
              <Input
                type="number"
                min="0"
                max={count - 1}
                value={vertex}
                onChange={(e) =>
                  setVertex(Math.max(0, Math.min(count - 1, Math.floor(Number(e.target.value)))))
                }
              />
            </label>
            <form
              key={mesh.label + vertex + JSON.stringify(verts.slice(offset, offset + 1 + rows * 4))}
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const form = new FormData(e.currentTarget)
                edit((copy) => {
                  const v = copy.skins[mesh.skinIndex].attachments![mesh.slot][mesh.name].vertices!
                  if (!weighted) {
                    v[offset] = Number(form.get('x'))
                    v[offset + 1] = Number(form.get('y'))
                    return
                  }
                  const weights = Array.from({ length: rows }, (_, i) => Number(form.get('w' + i)))
                  const total = weights.reduce((a, b) => a + b, 0)
                  if (!total) throw new Error('至少一个影响骨骼需要正权重。')
                  const bindings = weights.map((_, i) => Number(form.get('bone' + i)))
                  if (new Set(bindings).size !== bindings.length)
                    throw new Error('同一顶点的影响骨骼不能重复。')
                  weights.forEach((w, i) =>
                    v.splice(
                      offset + 1 + i * 4,
                      4,
                      bindings[i],
                      Number(form.get('x' + i)),
                      Number(form.get('y' + i)),
                      w / total
                    )
                  )
                })
              }}
            >
              {weighted ? (
                Array.from({ length: rows }, (_, i) => (
                  <fieldset className="grid grid-cols-3 gap-2" key={i}>
                    <label className="col-span-3 grid gap-1">
                      影响骨骼
                      <WorkbenchSelect
                        label={`影响骨骼 ${i + 1}`} disabled={disabled} options={boneOptions}
                        name={'bone' + i}
                        defaultValue={String(verts[offset + 1 + i * 4])}
                      />
                    </label>
                    {field('横坐标', verts[offset + 2 + i * 4], 'x' + i)}
                    {field('纵坐标', verts[offset + 3 + i * 4], 'y' + i)}
                    {field('权重', verts[offset + 4 + i * 4], 'w' + i, 0)}
                  </fieldset>
                ))
              ) : (
                <>
                  {field('横坐标', verts[offset], 'x')}
                  {field('纵坐标', verts[offset + 1], 'y')}
                </>
              )}
              <Button size="sm">{weighted ? '应用并归一化权重' : '应用顶点位置'}</Button>
            </form>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const target = Number(new FormData(e.currentTarget).get('binding'))
                edit((copy) => addInfluence(copy, mesh, vertex, target))
              }}
            >
              <WorkbenchSelect label="新绑定的骨骼" name="binding" disabled={disabled} defaultValue="0"
                options={boneOptions} className="flex-1 basis-32" />
              <Button variant="secondary">
                添加影响骨骼
              </Button>
            </form>
          </>
        ) : (
          <p className="text-muted-foreground">当前骨架没有可编辑的网格。</p>
        ))}
      {tab === '动画关键帧' && (
        <>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const name = String(new FormData(e.currentTarget).get('name')).trim()
              edit((copy) => {
                if (!name || name in copy.animations) throw new Error('请输入唯一的动画名称。')
                Object.defineProperty(copy.animations, name, {
                  value: {},
                  enumerable: true,
                  configurable: true,
                  writable: true
                })
                setAnimation(name)
                setIndex(0)
              })
            }}
          >
            <Input
              name="name"
              required
              placeholder="动画名称"
              aria-label="新动画名称"
              className="w-auto flex-1 basis-32"
            />
            <Button variant="secondary">
              新增动画
            </Button>
          </form>
          {animation && (
            <>
              <label className="grid gap-1">
                轨道
                <WorkbenchSelect
                  label="轨道" disabled={disabled} options={tracks.map((t) => [t, t])}
                  value={track}
                  onValueChange={(value) => {
                    setTrack(value)
                    setIndex(0)
                  }}
                />
              </label>
              <label className="grid gap-1">
                关键帧
                <WorkbenchSelect
                  label="关键帧" disabled={disabled} value={frames[index] ? String(index) : '-1'}
                  onValueChange={(value) => setIndex(Number(value))}
                  options={[
                    ...frames.map((f, i) => [String(i), `${(f.time ?? 0).toFixed(3)} 秒`] as const),
                    ['-1', '新增关键帧']
                  ]}
                />
              </label>
              <form
                className="grid gap-2"
                key={animation + bone.name + track + index + JSON.stringify(current)}
                onSubmit={(e) => {
                  e.preventDefault()
                  const form = new FormData(e.currentTarget)
                  edit((copy) => {
                    const a = copy.animations[animation]
                    a.bones ??= Object.create(null)
                    if (!Object.hasOwn(a.bones!, bone.name))
                      Object.defineProperty(a.bones!, bone.name, {
                        value: {},
                        enumerable: true,
                        configurable: true,
                        writable: true
                      })
                    const timeline = (a.bones![bone.name][track] ??= [])
                    const time = Number(form.get('time'))
                    if (timeline.some((f, i) => i !== index && (f.time ?? 0) === time))
                      throw new Error('此时刻已有关键帧。')
                    const next: Keyframe = { ...current, time }
                    for (const key of axis) next[key] = Number(form.get(key))
                    const curve = form.get('curve')
                    if (curve === 'linear') delete next.curve
                    if (curve === 'stepped') next.curve = 'stepped'
                    if (timeline[index]) timeline[index] = next
                    else timeline.push(next)
                    timeline.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
                    setIndex(timeline.indexOf(next))
                  })
                }}
              >
                {field(
                  '时间（秒）',
                  current.time ?? (frames[index] ? 0 : (frames.at(-1)?.time ?? 0) + 0.1),
                  'time',
                  0
                )}
                {axis.map((key) =>
                  field(
                    key === 'value' ? '数值' : key.toUpperCase(),
                    current[key] ?? (track.startsWith('scale') ? 1 : 0),
                    key
                  )
                )}
                <label className="grid gap-1">
                  插值
                  <WorkbenchSelect
                    label="插值" disabled={disabled}
                    name="curve"
                    defaultValue={Array.isArray(current.curve) ? 'bezier' : (current.curve ?? 'linear')}
                    options={[
                      ['linear', '线性'],
                      ['stepped', '阶梯'],
                      ...(Array.isArray(current.curve) ? [['bezier', '原始贝塞尔曲线'] as const] : [])
                    ]}
                  />
                </label>
                <Button size="sm">保存关键帧</Button>
              </form>
              {frames[index] && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    edit((copy) => {
                      const timelines = copy.animations[animation].bones![bone.name]
                      timelines[track].splice(index, 1)
                      if (!timelines[track].length) delete timelines[track]
                      setIndex(0)
                    })
                  }
                >
                  删除当前关键帧
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
