export interface Bone {
  name: string
  parent?: string
  inherit?: string
  x?: number
  y?: number
  rotation?: number
  length?: number
  scaleX?: number
  scaleY?: number
}
export interface Attachment {
  type?: string
  x?: number
  y?: number
  rotation?: number
  scaleX?: number
  scaleY?: number
  path?: string
  name?: string
  vertices?: number[]
  width?: number
  height?: number
  triangles?: number[]
  uvs?: number[]
}
export interface Keyframe {
  time?: number
  x?: number
  y?: number
  value?: number
  name?: string
  color?: string
  vertices?: number[]
  offset?: number
  curve?: 'stepped' | number[]
}
export interface SpineModel {
  skeleton: { spine: string; x?: number; y?: number; width?: number; height?: number }
  slots?: { name: string; bone: string; attachment?: string; color?: string; blend?: string }[]
  transform?: {
    target: string
    bones: string[]
    order?: number
    local?: boolean
    relative?: boolean
    x?: number
    y?: number
    mixX?: number
    mixY?: number
  }[]
  physics?: unknown[]
  bones: Bone[]
  skins: { name: string; attachments?: Record<string, Record<string, Attachment>> }[]
  animations: Record<
    string,
    {
      bones?: Record<string, Record<string, Keyframe[]>>
      slots?: Record<string, Record<string, Keyframe[]>>
      attachments?: Record<string, Record<string, Record<string, { deform: Keyframe[] }>>>
    }
  >
}

export function readModel(bytes: Uint8Array): SpineModel {
  const model = JSON.parse(new TextDecoder().decode(bytes))
  if (!/^4\.2\.\d+$/.test(model.skeleton?.spine) || !Array.isArray(model.bones) || !model.bones.length)
    throw new Error('请选择带有骨骼的 Spine 4.2 数据。')
  model.animations ??= {}
  model.skins ??= []
  return model
}

export function binaryVersion(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes.subarray(9, 8 + bytes[8]))
}

export function meshList(model: SpineModel) {
  return model.skins.flatMap((skin, skinIndex) =>
    Object.entries(skin.attachments ?? {}).flatMap(([slot, attachments]) =>
      Object.entries(attachments)
        .filter(([, a]) => a.type === 'mesh' && a.uvs && a.vertices)
        .map(([name, attachment]) => ({
          skinIndex,
          slot,
          name,
          attachment,
          label: [skin.name, slot, name].join(' ／ ')
        }))
    )
  )
}

export function vertexOffsets(vertices: number[], count: number) {
  const offsets: number[] = []
  for (let offset = 0; offset < vertices.length;) {
    const influences = vertices[offset]
    if (!Number.isSafeInteger(influences) || influences < 1 || offset + 1 + 4 * influences > vertices.length)
      throw new Error('网格顶点的权重布局无效。')
    offsets.push(offset)
    offset += 1 + influences * 4
  }
  if (offsets.length !== count) throw new Error('网格顶点数与 UV 数量不匹配。')
  return offsets
}

export function addInfluence(
  model: SpineModel,
  mesh: ReturnType<typeof meshList>[number],
  vertex: number,
  bone: number
) {
  const skin = model.skins[mesh.skinIndex]
  const attachment = skin.attachments![mesh.slot][mesh.name]
  const vertices = attachment.vertices!
  const count = attachment.uvs!.length / 2
  if (vertices.length === count * 2) {
    const slotBone = model.slots?.find((s) => s.name === mesh.slot)?.bone
    const base = model.bones.findIndex((b) => b.name === slotBone)
    if (base < 0) throw new Error('网格插槽没有对应的骨骼。')
    attachment.vertices = Array.from({ length: count }, (_, i) => [
      1,
      base,
      vertices[2 * i],
      vertices[2 * i + 1],
      1
    ]).flat()
  }
  const weighted = attachment.vertices!
  const offsets = vertexOffsets(weighted, count)
  const pos = offsets[vertex]
  const influences = weighted[pos]
  for (let i = 0; i < influences; i++)
    if (weighted[pos + 1 + i * 4] === bone) throw new Error('该骨骼已经影响所选顶点。')
  // 每个骨骼绑定在形变轨道占两个坐标。插入绑定时同步移动后续坐标。
  const deformIndex = ((pos - vertex) / 4 + influences) * 2
  for (const anim of Object.values(model.animations)) {
    for (const frame of anim.attachments?.[skin.name]?.[mesh.slot]?.[mesh.name]?.deform ?? []) {
      if (!frame.vertices?.length) continue
      const start = frame.offset ?? 0
      if (deformIndex <= start) frame.offset = start + 2
      else if (deformIndex < start + frame.vertices.length)
        frame.vertices.splice(deformIndex - start, 0, 0, 0)
    }
  }
  weighted[pos]++
  weighted.splice(pos + 1 + 4 * influences, 0, bone, 0, 0, 0)
}
