import type { SpineFile } from '@shared/workbench-spine'

const magic = 0x9e2a83c1
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

export function unpackNative(header: SpineFile, body: SpineFile) {
  const h = view(header.bytes)
  const b = view(body.bytes)
  if (
    h.getUint32(0, true) !== magic ||
    h.getInt32(4, true) !== -9 ||
    h.getUint32(44, true) !== h.byteLength ||
    !new TextDecoder().decode(header.bytes).includes('SpineSkeletonDataAsset\0') ||
    b.getUint32(b.byteLength - 4, true) !== magic
  )
    throw new Error('需要 UE 5.6 的 SpineSkeletonDataAsset 文件对。')
  // retoc 的 UE 5.6 legacy 包：包路径 FString 后为标志、名称表和导入导出表。
  const pathLength = h.getInt32(52, true)
  const fields = 56 + (pathLength < 0 ? -2 * pathLength : pathLength)
  const exports = h.getInt32(fields + 32, true)
  const sizeField = exports + 28
  const bulkField = fields + 144
  const serialSize = b.byteLength - 4
  if (
    h.getInt32(fields + 28, true) !== 1 ||
    h.getBigInt64(sizeField, true) !== BigInt(serialSize) ||
    h.getBigInt64(sizeField + 8, true) !== BigInt(h.byteLength) ||
    h.getBigInt64(bulkField, true) !== BigInt(h.byteLength + serialSize) ||
    b.getUint16(0, true) !== 0x0507
  )
    throw new Error('该骨架资源的 UE 导出布局尚未支持。')
  const length = b.getUint32(2, true)
  if (length + 6 > serialSize) throw new Error('骨架数据长度超出导出范围。')
  const skeleton = body.bytes.slice(6, 6 + length)
  return {
    skeleton,
    write(bytes: Uint8Array): SpineFile[] {
      const next = new Uint8Array(b.byteLength - length + bytes.length)
      next.set(body.bytes.subarray(0, 6))
      view(next).setUint32(2, bytes.length, true)
      next.set(bytes, 6)
      next.set(body.bytes.subarray(6 + length), 6 + bytes.length)
      const copy = header.bytes.slice()
      view(copy).setBigInt64(sizeField, BigInt(next.length - 4), true)
      view(copy).setBigInt64(bulkField, BigInt(copy.length + next.length - 4), true)
      return [
        { name: header.name, bytes: copy },
        { name: body.name, bytes: next }
      ]
    }
  }
}

export function unpackAtlas(bytes: Uint8Array) {
  const data = view(bytes)
  const field = 6 + 4 * data.getUint32(2, true)
  const length = data.getUint32(field, true)
  const start = field + 4
  if (
    data.getUint16(0, true) !== 0x0700 ||
    length < 2 ||
    start + length > bytes.length ||
    bytes[start + length - 1] !== 0 ||
    data.getUint32(bytes.length - 4, true) !== magic
  )
    throw new Error('图集资源格式无效。')
  return new TextDecoder().decode(bytes.subarray(start, start + length - 1))
}
