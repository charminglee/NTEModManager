import { Bone } from './workbench-spine-codec/IceBone'
import type { AtlasRegion } from './workbench-spine-atlas'
import type { Attachment, Keyframe, SpineModel } from './workbench-spine-model'

function bezier(a: number, b: number, c: number, d: number, t: number) {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}
function sample(t: number, a: Keyframe, b: Keyframe | undefined, start: number, end: number, channel = 0) {
  if (!b || a.curve === 'stepped') return start
  const from = a.time ?? 0,
    to = b.time ?? 0
  const curve = a.curve?.slice(channel * 4, channel * 4 + 4)
  if (curve?.length === 4) {
    let lo = 0,
      hi = 1
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      if (bezier(from, curve[0], curve[2], to, mid) < t) lo = mid
      else hi = mid
    }
    return bezier(start, curve[1], curve[3], end, (lo + hi) / 2)
  }
  return start + ((end - start) * (t - from)) / (to - from)
}
function frameAt(frames: Keyframe[], time: number) {
  let i = frames.length - 1
  while (i >= 0 && (frames[i].time ?? 0) > time) i--
  return i
}
function durationOf(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  if ('time' in value && typeof value.time === 'number') return value.time
  if (Array.isArray(value) && typeof value[0] === 'number') return 0
  return Object.values(value).reduce<number>((max, item) => Math.max(max, durationOf(item)), 0)
}
export function createPose(model: SpineModel, animation: string, regions?: Map<string, AtlasRegion>) {
  const byName = new Map<string, Bone>()
  const bones = model.bones.map((data) => {
    const parent = data.parent ? byName.get(data.parent) : null
    if (data.parent && !parent) throw new Error('找不到父骨骼：' + data.parent)
    const bone = new Bone(data.name, parent, data.length)
    byName.set(data.name, bone)
    return bone
  })
  const constraints = [...(model.transform ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const anim = model.animations[animation]
  const skin = model.skins.find((s) => s.name === 'default') ?? model.skins[0]
  const quads = new Map<Attachment, Attachment>()
  for (const attachments of Object.values(skin?.attachments ?? {})) {
    for (const [name, a] of Object.entries(attachments)) {
      if (a.type && a.type !== 'region') continue
      const region = regions?.get(a.path ?? a.name ?? name)
      const [left, bottom, w, h] = region?.offsets.length
        ? region.offsets : [0, 0, region?.w ?? a.width ?? 1, region?.h ?? a.height ?? 1]
      if (w <= 0 || h <= 0) continue
      const x0 = left / w, x1 = (left + (region?.w ?? w)) / w
      const y0 = bottom / h, y1 = (bottom + (region?.h ?? h)) / h
      const angle = (a.rotation ?? 0) * Math.PI / 180
      const vertices = [[x0,y0], [x1,y0], [x1,y1], [x0,y1]].flatMap(([u,v]) => {
        const x = (u - 0.5) * (a.width ?? w) * (a.scaleX ?? 1)
        const y = (v - 0.5) * (a.height ?? h) * (a.scaleY ?? 1)
        return [(a.x ?? 0) + x * Math.cos(angle) - y * Math.sin(angle),
          (a.y ?? 0) + x * Math.sin(angle) + y * Math.cos(angle)]
      })
      quads.set(a, { ...a, vertices, uvs: [x0,1-y0,x1,1-y0,x1,1-y1,x0,1-y1], triangles: [0,1,2,2,3,0] })
    }
  }
  return {
    bones,
    duration: durationOf(anim),
    sample(
      time: number,
      draw: (a: Attachment, name: string, points: number[], opacity: number, additive: boolean) => void
    ) {
      bones.forEach((bone, i) => {
        const base = model.bones[i]
        bone.x = base.x ?? 0
        bone.y = base.y ?? 0
        bone.rotation = base.rotation ?? 0
        bone.scaleX = base.scaleX ?? 1
        bone.scaleY = base.scaleY ?? 1
        for (const [track, frames] of Object.entries(anim?.bones?.[base.name] ?? {})) {
          const index = frameAt(frames, time)
          if (index < 0) continue
          const a = frames[index],
            b = frames[index + 1]
          const val = (field: 'value' | 'x' | 'y', fallback: number) =>
            sample(time, a, b, a[field] ?? fallback, b?.[field] ?? fallback, field === 'y' ? 1 : 0)
          if (track === 'rotate') bone.rotation += val('value', 0)
          if (track === 'translate' || track === 'translatex')
            bone.x += val(track === 'translate' ? 'x' : 'value', 0)
          if (track === 'translate' || track === 'translatey')
            bone.y += val(track === 'translate' ? 'y' : 'value', 0)
          if (track === 'scale' || track === 'scalex')
            bone.scaleX *= val(track === 'scale' ? 'x' : 'value', 1)
          if (track === 'scale' || track === 'scaley')
            bone.scaleY *= val(track === 'scale' ? 'y' : 'value', 1)
        }
        bone.updateWorldTransform()
        if (base.inherit === 'noRotationOrReflection' && bone.parent) {
          const p = bone.parent
          const sx = Math.hypot(p.a, p.c)
          const sy = sx ? Math.abs(p.a * p.d - p.b * p.c) / sx : Math.hypot(p.b, p.d)
          const angle = Math.atan2(p.c, p.a)
          const cs = Math.cos(angle),
            sn = Math.sin(angle)
          const a = cs * cs * sx + sn * sn * sy,
            d = sn * sn * sx + cs * cs * sy,
            b = sn * cs * (sx - sy)
          const r = (bone.rotation * Math.PI) / 180,
            x = Math.cos(r),
            y = Math.sin(r)
          bone.a = (a * x + b * y) * bone.scaleX
          bone.c = (b * x + d * y) * bone.scaleX
          bone.b = (-a * y + b * x) * bone.scaleY
          bone.d = (-b * y + d * x) * bone.scaleY
        }
      })
      for (const constraint of constraints) {
        const target = byName.get(constraint.target)
        if (!target || constraint.local || constraint.relative) continue
        const x = constraint.x ?? 0,
          y = constraint.y ?? 0
        for (const name of constraint.bones) {
          const bone = byName.get(name)!
          const dx = (target.worldX + target.a * x + target.b * y - bone.worldX) * (constraint.mixX ?? 1)
          const dy =
            (target.worldY + target.c * x + target.d * y - bone.worldY) *
            (constraint.mixY ?? constraint.mixX ?? 1)
          const subtree = [bone]
          while (subtree.length) {
            const child = subtree.pop()!
            child.worldX += dx
            child.worldY += dy
            subtree.push(...child.children)
          }
        }
      }
      for (const slot of model.slots ?? []) {
        const tracks = anim?.slots?.[slot.name]
        const swap = tracks?.attachment ?? []
        const k = frameAt(swap, time)
        const name = k < 0 ? slot.attachment : swap[k].name
        if (!name) continue
        const source = skin?.attachments?.[slot.name]?.[name]
        const att = source && (quads.get(source) ?? source)
        if (!att?.vertices || !att.uvs || !att.triangles) continue
        const frames = anim?.attachments?.[skin.name]?.[slot.name]?.[name]?.deform ?? []
        const index = frameAt(frames, time)
        const f = frames[index],
          next = frames[index + 1]
        const factor = f ? sample(time, f, next, 0, 1) : 0
        const displacement = (i: number) =>
          (1 - factor) * (f?.vertices?.[i - (f.offset ?? 0)] ?? 0) +
          factor * (next?.vertices?.[i - (next.offset ?? 0)] ?? 0)
        const v = att.vertices,
          weighted = v.length !== att.uvs.length
        const points: number[] = []
        let deform = 0
        for (let j = 0; j < v.length;) {
          const n = weighted ? v[j++] : 1
          if (!Number.isInteger(n) || n <= 0 || j + n * (weighted ? 4 : 2) > v.length)
            throw new Error('网格权重数据无效：' + name)
          let x = 0,
            y = 0
          for (let influence = 0; influence < n; influence++) {
            const bone = weighted ? bones[v[j++]] : byName.get(slot.bone)!
            const u = v[j++] + displacement(deform++),
              w = v[j++] + displacement(deform++)
            const weight = weighted ? v[j++] : 1
            x += weight * (bone.worldX + bone.a * u + bone.b * w)
            y += weight * (bone.worldY + bone.c * u + bone.d * w)
          }
          points.push(x, y)
        }
        const colors = tracks?.rgba ?? [],
          c = frameAt(colors, time)
        const alpha = (hex?: string) => parseInt((hex ?? 'ffffffff').slice(6, 8), 16) / 255
        const opacity =
          c < 0
            ? alpha(slot.color)
            : sample(time, colors[c], colors[c + 1], alpha(colors[c].color), alpha(colors[c + 1]?.color), 3)
        draw(att, att.path ?? att.name ?? name, points, opacity, slot.blend === 'additive')
      }
    }
  }
}
