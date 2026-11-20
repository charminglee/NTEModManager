import { useRef, useState } from 'react'
import { FolderOpen, Layers } from 'lucide-react'
import type { SpineFile } from '@shared/workbench-spine'
import { Button } from './ui/button'
import { Input } from './ui/input'
import WorkbenchSelect from './workbench-select'
import Inspector from './workbench-spine-inspector'
import SpinePreview from './workbench-spine-preview'
import { atlasRegions, type TextureSet } from './workbench-spine-atlas'
import { convert } from './workbench-spine-codec'
import { binaryVersion, readModel, type SpineModel } from './workbench-spine-model'
import { unpackAtlas, unpackNative } from './workbench-spine-native'

interface Document {
  name: string
  model: SpineModel
  original: SpineModel
  binary?: Uint8Array<ArrayBuffer>
  native?: ReturnType<typeof unpackNative>
}

async function readFiles(files: FileList) {
  return Promise.all(
    Array.from(files, async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))
  )
}

async function readTextures(files: SpineFile[], previous: TextureSet | null) {
  const text = files.find((f) => /\.atlas(?:\.txt)?$/i.test(f.name))
  const native = files.find((f) => /\.uexp$/i.test(f.name) && f.bytes[0] === 0 && f.bytes[1] === 7)
  const atlas = text
    ? new TextDecoder().decode(text.bytes)
    : native
      ? unpackAtlas(native.bytes)
      : previous?.atlas
  if (!atlas) return null
  const images = { ...previous?.images }
  for (const file of files.filter((f) => /\.png$/i.test(f.name))) {
    const url = URL.createObjectURL(new Blob([file.bytes], { type: 'image/png' }))
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      images[file.name] = img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  return { atlas, images }
}

export default function WorkbenchSpine() {
  const [doc, setDoc] = useState<Document | null>(null)
  const [textures, setTextures] = useState<TextureSet | null>(null)
  const [history, setHistory] = useState<SpineModel[]>([])
  const [animation, setAnimation] = useState('')
  const [resource, setResource] = useState('SP_YEMJX_Data')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState(false)
  const [revision, setRevision] = useState(0)
  const skeletonInput = useRef<HTMLInputElement>(null)
  const atlasInput = useRef<HTMLInputElement>(null)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    setFailure(false)
    try {
      await action()
    } catch (reason) {
      setFailure(true)
      setMessage(String(reason))
    } finally {
      setBusy(false)
    }
  }
  async function open(files: SpineFile[]) {
    const body = files.find((f) => /\.uexp$/i.test(f.name) && f.bytes[0] === 7 && f.bytes[1] === 5)
    const header =
      body &&
      files.find((f) => f.name.toLowerCase() === body.name.replace(/\.uexp$/i, '.uasset').toLowerCase())
    if (body && !header) throw new Error('请选择同名的骨架 .uasset 和 .uexp 文件。')
    const native = header && body ? unpackNative(header, body) : undefined
    const source = body ?? files.find((f) => /\.(skel|json)$/i.test(f.name))
    if (!source) throw new Error('请选择 Spine 4.2 的骨架文件或原生资源对。')
    const binary = native?.skeleton ?? (/\.skel$/i.test(source.name) ? source.bytes : undefined)
    const model = readModel(binary ? await convert(binary, true, binaryVersion(binary)) : source.bytes)
    const nextTextures = await readTextures(files, null)
    setDoc({ name: source.name.replace(/\.[^.]+$/, ''), model, original: model, binary, native })
    setTextures(nextTextures)
    setHistory([])
    setRevision((r) => r + 1)
    setAnimation(
      Object.hasOwn(model.animations, 'idle1') ? 'idle1' : (Object.keys(model.animations)[0] ?? '')
    )
  }
  function edit(change: (copy: SpineModel) => void) {
    if (!doc) return
    try {
      const copy = structuredClone(doc.model)
      change(copy)
      setHistory((h) => [...h.slice(-19), doc.model])
      setDoc({ ...doc, model: copy })
      setMessage('')
      setFailure(false)
    } catch (error) {
      setFailure(true)
      setMessage(String(error))
    }
  }
  async function save(format: 'json' | 'skel' | 'native') {
    if (!doc) return
    const json = new TextEncoder().encode(JSON.stringify(doc.model))
    let files: SpineFile[]
    if (format === 'json') files = [{ name: doc.name + '.json', bytes: json }]
    else {
      const bytes =
        doc.model === doc.original && doc.binary
          ? doc.binary
          : await convert(json, false, doc.model.skeleton.spine)
      files = format === 'native' ? doc.native!.write(bytes) : [{ name: doc.name + '.skel', bytes }]
    }
    const result = await window.api.saveSpineFiles(files)
    if (result) setMessage('已导出至：' + result)
  }
  const pages = [...new Set([...atlasRegions(textures?.atlas ?? '').values()].map((r) => r.page))]
  const missing = pages.filter((page) => !textures?.images[page])
  const animations = doc ? Object.keys(doc.model.animations).filter(Boolean) : []
  return (
    <section className="grid min-w-0 gap-4">
      <fieldset disabled={busy} className="flex min-w-0 flex-wrap items-center gap-2">
        <Input
          className="w-auto flex-1 basis-40"
          aria-label="游戏骨架资源名"
          placeholder="游戏骨架资源名"
          value={resource}
          onChange={(e) => setResource(e.target.value)}
        />
        <Button
          disabled={!resource.trim()}
          onClick={() => run(async () => open(await window.api.loadGameSpine(resource.trim())))}
        >
          从游戏载入
        </Button>
        <Button type="button" variant="secondary" onClick={() => skeletonInput.current?.click()}>
          <FolderOpen />打开本地骨架
        </Button>
        <input ref={skeletonInput} hidden type="file" multiple accept=".json,.skel,.uasset,.uexp,.atlas,.txt,.png"
          onChange={(e) => {
            const files = e.target.files
            if (files?.length) void run(async () => open(await readFiles(files)))
            e.target.value = ''
          }} />
      </fieldset>
      {busy && <p role="status" className="workbench-panel px-4 py-3 text-sm text-muted-foreground">正在处理 Spine 资源……</p>}
      {message && (
        <p className={`workbench-panel break-all px-4 py-3 text-sm ${failure ? 'text-destructive' : 'select-text'}`} role={failure ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      {!doc && !busy && (
        <div className="library-empty workbench-panel">
          <Layers size={32} aria-hidden="true" />
          <h2>尚未载入骨架</h2>
          <p>从游戏载入，或打开 Spine 4.2 的 JSON、SKEL、配对的 .uasset 与 .uexp。可同时选择图集和 PNG。</p>
        </div>
      )}
      {doc && (
        <fieldset disabled={busy} className="grid min-w-0 gap-4">
          <div className="workbench-panel flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className="min-w-0 flex-1 break-all">
              <strong>{doc.name}</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                Spine {doc.model.skeleton.spine} · {doc.model.bones.length} 根骨骼
              </p>
            </div>
            <WorkbenchSelect label="动画" className="w-auto" disabled={busy}
              value={String(animations.indexOf(animation))}
              onValueChange={(index) => setAnimation(animations[Number(index)] ?? '')}
              options={[
                ['-1', '初始姿势'],
                ...animations.map((name, index) => [String(index), name] as const)
              ]} />
            <Button type="button" variant="secondary" onClick={() => atlasInput.current?.click()}>
              <FolderOpen />载入图集与贴图
            </Button>
            <input ref={atlasInput} hidden type="file" multiple accept=".atlas,.txt,.uexp,.png"
              onChange={(e) => {
                const files = e.target.files
                if (files?.length)
                  void run(async () => {
                    const next = await readTextures(await readFiles(files), textures)
                    if (!next) throw new Error('请同时选择图集描述文件。')
                    setTextures(next)
                  })
                e.target.value = ''
              }} />
          </div>
          {missing.length > 0 && <p className="workbench-panel break-all px-4 py-3 text-sm">待载入的图集贴图：{missing.join('、')}</p>}
          <div className="workbench-split">
            <SpinePreview model={doc.model} animation={animation} textures={textures} />
            <section className="workbench-panel">
              <header className="workbench-panel-heading"><h2>编辑属性</h2></header>
              <Inspector
                key={revision}
                model={doc.model}
                animation={animation}
                setAnimation={setAnimation}
                edit={edit}
                disabled={busy}
              />
            </section>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!history.length}
              onClick={() => {
                const previous = history.at(-1)!
                setDoc({ ...doc, model: previous })
                setHistory(history.slice(0, -1))
                setRevision((r) => r + 1)
                if (!Object.hasOwn(previous.animations, animation))
                  setAnimation(Object.keys(previous.animations)[0] ?? '')
              }}
            >
              撤销
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run(() => save('json'))}>
              导出 JSON
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run(() => save('skel'))}>
              导出 SKEL
            </Button>
            {doc.native && (
              <Button size="sm" onClick={() => run(() => save('native'))}>
                导出修改后的原生资源
              </Button>
            )}
          </div>
        </fieldset>
      )}
    </section>
  )
}
