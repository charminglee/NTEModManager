import Worker from './worker?worker'

export function convert(
  input: Uint8Array,
  binary: boolean,
  version: string
): Promise<Uint8Array<ArrayBuffer>> {
  if (!/^4\.2\.\d+$/.test(version)) throw new Error('需要 Spine 4.2 骨架。')
  const worker = new Worker()
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate()
      if (data.error) reject(new Error(data.error))
      else resolve(data.output)
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage({ input, binary, version })
  })
}
