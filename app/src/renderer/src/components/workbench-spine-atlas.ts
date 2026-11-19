export interface TextureSet {
  atlas: string
  images: Record<string, HTMLImageElement>
}
export interface AtlasRegion {
  page: string
  x: number
  y: number
  w: number
  h: number
  rotate: number
  offsets: number[]
}
export function atlasRegions(atlas: string) {
  const regions = new Map<string, AtlasRegion>()
  for (const block of atlas.trim().split(/\r?\n\s*\r?\n/)) {
    const [page, ...lines] = block.split(/\r?\n/).map((line) => line.trim())
    let region: AtlasRegion | undefined
    for (const line of lines) {
      const colon = line.indexOf(':')
      if (colon < 0) {
        region = { page, x: 0, y: 0, w: 0, h: 0, rotate: 0, offsets: [] }
        regions.set(line, region)
      } else if (region) {
        const key = line.slice(0, colon),
          raw = line.slice(colon + 1).trim()
        const values = raw.split(',').map(Number)
        if (key === 'bounds') [region.x, region.y, region.w, region.h] = values
        if (key === 'xy') [region.x, region.y] = values
        if (key === 'size') [region.w, region.h] = values
        if (key === 'rotate') region.rotate = raw === 'true' ? 90 : Number(raw) || 0
        if (key === 'offsets') region.offsets = values
      }
    }
  }
  return regions
}
export function atlasUV(uvs: number[], region: AtlasRegion, width: number, height: number) {
  const uv: number[] = []
  const { w, h, rotate } = region
  const [left, bottom, originalW, originalH] = region.offsets.length ? region.offsets : [0, 0, w, h]
  for (let i = 0; i < uvs.length; i += 2) {
    const u = uvs[i] * originalW - left,
      v = (uvs[i + 1] - 1) * originalH + h + bottom
    const [x, y] =
      rotate === 90 ? [v, w - u] : rotate === 180 ? [w - u, h - v] : rotate === 270 ? [h - v, u] : [u, v]
    uv.push((region.x + x) / width, (region.y + y) / height)
  }
  return uv
}
