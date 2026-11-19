import create from './converter.js'
import wasm from './converter.wasm?url'

self.onmessage = async ({ data }: MessageEvent<{ input: Uint8Array; binary: boolean; version: string }>) => {
  try {
    const codec = await create({ locateFile: () => wasm })
    const version = new TextEncoder().encode(data.version + '\0')
    const pointer = codec._malloc(data.input.length)
    const versionPointer = codec._malloc(version.length)
    if (!pointer || !versionPointer) throw new Error('转换器内存不足。')
    codec.HEAPU8.set(data.input, pointer)
    codec.HEAPU8.set(version, versionPointer)
    if (
      codec._st_convert(
        pointer,
        data.input.length,
        Number(data.binary),
        Number(!data.binary),
        versionPointer,
        0
      )
    )
      throw new Error(codec.UTF8ToString(codec._st_last_error()))
    const offset = codec._st_output_data()
    const output = codec.HEAPU8.slice(offset, offset + codec._st_output_size())
    self.postMessage({ output })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
