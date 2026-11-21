import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type MouseEvent, type SVGProps } from 'react'
import {
  AudioLines, Bone, Braces, ChartSpline, ChevronRight, Clapperboard, Download, File, FileText, Film, Folder, FolderOpen,
  Image, Map as MapIcon, Package, Palette, PanelsTopLeft, PersonStanding, Sparkles, Table2, Type, Workflow, type LucideIcon
} from 'lucide-react'
import { Button } from './ui/button'
import { ContextMenu, useContextMenu } from './ui/context-menu'
import { DropdownMenuItem } from './ui/dropdown-menu'
import { isBlueprintClass, type AssetDirectory, type AssetEntry, type AssetExportKind, type AssetExportRequest,
  type AssetPreviewMode, type AssetQuery, type AssetReference } from '@shared/workbench-assets'

type TreeQuery = Omit<AssetQuery, 'directory'>
type BranchProps = {
  query: TreeQuery
  directory?: string
  selected: Set<string>
  onSelect: (entry: AssetEntry, event: { ctrlKey: boolean; shiftKey: boolean }) => void
  onPreview: (entry: AssetEntry, mode: AssetPreviewMode) => void
  onMenu: (target: MenuTarget, event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) => void
}

type MenuTarget = { folder: string } | { entry: AssetEntry }
const assetKey = ({ path, archive }: AssetReference) => JSON.stringify([path, archive])
const folderActions: [AssetExportKind, string, LucideIcon][] = [
  ['texture', '导出所有纹理', Image],
  ['model', '导出所有模型', PersonStanding],
  ['blueprint', '导出所有反编译蓝图', Workflow],
  ['animation', '导出所有动画', Clapperboard],
  ['audio', '导出所有音效', AudioLines]
]

const rowClass = 'h-7 w-full justify-start gap-1.5 border-0 px-2 text-left text-xs font-normal'
const modelIconScale = 'scale-125'

const blueprintIconColors = new Map([
  ['animblueprint', 'text-orange-700'],
  ['widgetblueprint', 'text-rose-700']
])

function PhysicsAssetIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
    strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5.5 14.5C3.3 13.8 2 12.9 2 12c0-2 4.5-3.6 10-3.6S22 10 22 12c0 .9-1.3 1.8-3.5 2.5" />
    <path d="M10 4.8C8.4 3.2 6.9 2.5 6.1 3c-1.8 1.1-.5 6 2.7 11.1s7.2 8.2 9 7.1c1.4-.9 1-4.4-.9-8.2" />
    <path d="M17.8 6.7c.4-1.9.2-3.3-.7-3.7-1.8-1.1-5.8 2-9 7.1S3.6 20.1 5.4 21.2c.9.6 2.4 0 4-1.5" />
    <circle cx={12} cy={12} r={1.4} fill="currentColor" stroke="none" />
  </svg>
}

const iconClasses: [ComponentType<SVGProps<SVGSVGElement>>, string[]][] = [
  [Image, [
    'Texture2D', 'Texture2DArray', 'Texture2DDynamic', 'TextureCube', 'TextureCubeArray', 'VolumeTexture',
    'TextureRenderTarget2D', 'TextureRenderTarget2DArray', 'TextureRenderTargetCube', 'TextureRenderTargetVolume',
    'LightMapTexture2D', 'VirtualTexture2D', 'CurveLinearColorAtlas', 'SpineAtlasAsset', 'PaperSprite'
  ]],
  [PersonStanding, ['StaticMesh', 'SkeletalMesh', 'GeometryCollection', 'GeometryCache']],
  [Bone, ['Skeleton']],
  [PhysicsAssetIcon, ['PhysicsAsset']],
  [Palette, [
    'Material', 'MaterialInstance', 'MaterialInstanceConstant', 'MaterialFunction', 'MaterialFunctionInstance',
    'MaterialParameterCollection', 'MaterialLayer', 'MaterialLayerBlend'
  ]],
  [Clapperboard, [
    'AnimSequence', 'AnimMontage', 'AnimComposite',
    'BlendSpace', 'BlendSpace1D', 'AimOffsetBlendSpace', 'AimOffsetBlendSpace1D', 'LevelSequence', 'SpineSkeletonDataAsset'
  ]],
  [PanelsTopLeft, ['UserWidget', 'SlateWidgetStyleAsset']],
  [Sparkles, ['NiagaraSystem', 'NiagaraEmitter', 'NiagaraScript', 'ParticleSystem']],
  [AudioLines, [
    'SoundWave', 'SoundCue', 'SoundClass', 'SoundMix', 'SoundAttenuation', 'SoundConcurrency',
    'MetaSoundSource', 'AkAudioEvent', 'AkAudioBank', 'AkInitBank', 'AkMediaAsset'
  ]],
  [Table2, ['DataTable', 'CompositeDataTable', 'CurveTable', 'StringTable']],
  [ChartSpline, ['CurveFloat', 'CurveVector', 'CurveLinearColor']],
  [Braces, ['DataAsset', 'PrimaryDataAsset']],
  [Type, ['Font', 'FontFace']],
  [MapIcon, ['World']]
]
const assetClassIcons = new Map(iconClasses.flatMap(([Icon, classes]) => classes.map(name => [name, Icon] as const)))

function fileIcon(name: string, assetClass?: string) {
  if (assetClass) return assetClassIcons.get(assetClass) ?? Package
  switch (name.slice(name.lastIndexOf('.')).toLowerCase()) {
    case '.uasset': return Package
    case '.umap': return MapIcon
    case '.png': case '.jpg': case '.jpeg': case '.dds': case '.svg': case '.webp': return Image
    case '.wem': case '.bnk': case '.wav': case '.ogg': case '.mp3': case '.acb': case '.awb': return AudioLines
    case '.usm': case '.bk2': case '.mp4': case '.webm': return Film
    case '.json': case '.uplugin': case '.uproject': case '.upluginmanifest': return Braces
    case '.ini': case '.txt': case '.srt': case '.locres': case '.locmeta': return FileText
    case '.ufont': case '.ttf': case '.otf': return Type
    default: return File
  }
}

function AssetFolder({ path, expand, ...props }: BranchProps & { path: string; expand: boolean }) {
  const [open, setOpen] = useState(expand)
  const name = path.slice(path.lastIndexOf('/') + 1)

  return <li>
    <Button type="button" variant="ghost" className={rowClass} aria-expanded={open}
      onClick={() => setOpen(value => !value)}
      onContextMenu={event => props.onMenu({ folder: path }, event)}
      onKeyDown={event => props.onMenu({ folder: path }, event)}>
      <ChevronRight aria-hidden="true" className={open ? 'rotate-90' : undefined} />
      {open ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
      <span>{name}</span>
    </Button>
    {open && <AssetBranch {...props} directory={path} />}
  </li>
}

function AssetBranch({ query, directory = '', ...props }: BranchProps) {
  const [result, setResult] = useState<AssetDirectory>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const expandHtContent = query.onlyHtContent && (!directory || directory.toLowerCase() === 'ht')
  const expandSearchResult = !!query.search.trim() && result?.folders.length === 1 && !result.rows.length
  const expandFolders = expandHtContent || expandSearchResult

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      window.api.workbenchAssetQuery({ ...query, directory }).then(value => {
        if (active) setResult(value)
      }).catch(reason => {
        if (active) setError(String(reason))
      }).finally(() => {
        if (active) setLoading(false)
      })
    }, !directory && query.search ? 120 : 0)
    return () => { active = false; clearTimeout(timer) }
  }, [query, directory])

  return <div aria-busy={directory ? undefined : loading}>
    {result && result.count > 0 && <ul className={directory ? 'ml-3 border-l border-border pl-1' : 'w-max min-w-full p-1'}>
      {result.folders.map(path => <AssetFolder key={JSON.stringify([path, expandFolders])} path={path} expand={expandFolders}
        query={query} {...props} />)}
      {result.rows.map(row => {
        const name = row.path.slice(row.path.lastIndexOf('/') + 1)
        const { assetClass } = row
        const blueprintColor = assetClass && isBlueprintClass(assetClass)
          ? blueprintIconColors.get(assetClass.toLowerCase().replace(/generatedclass$/, '')) ?? 'text-blue-700'
          : undefined
        const Icon = blueprintColor ? Workflow : fileIcon(name, assetClass)
        const key = assetKey(row)
        return <li key={key}>
          <Button type="button" variant="ghost"
            data-asset-key={key} aria-pressed={props.selected.has(key)}
            className={`${rowClass} pl-7 aria-pressed:bg-accent aria-pressed:text-accent-foreground`}
            onClick={event => {
              props.onSelect(row, event)
              if (!event.ctrlKey && !event.shiftKey) props.onPreview(row, 'auto')
            }}
            onContextMenu={event => props.onMenu({ entry: row }, event)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.repeat) {
                event.preventDefault()
                props.onSelect(row, event)
                props.onPreview(row, 'auto')
              }
              props.onMenu({ entry: row }, event)
            }}>
            <Icon aria-hidden="true" className={Icon === PersonStanding ? modelIconScale : blueprintColor} />
            <span>{name}</span>
          </Button>
        </li>
      })}
    </ul>}
    {result?.count === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">没有匹配的资源。</p>}
    {error && <p role="alert" className="break-all px-3 py-2 text-xs text-destructive">{error}</p>}
  </div>
}

export default function WorkbenchAssetTree({ query, onPreview, onExport }: Pick<BranchProps, 'query' | 'onPreview'> & {
  onExport: (request: AssetExportRequest) => void
}) {
  const tree = useRef<HTMLDivElement>(null)
  const anchor = useRef<string>(undefined)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [target, setTarget] = useState<MenuTarget>()
  const menu = useContextMenu(true)
  const multiExport = target && 'entry' in target && selected.size > 1

  return <div ref={tree}>
    <AssetBranch query={query} selected={selected} onPreview={onPreview}
      onSelect={(entry, event) => {
        const key = assetKey(entry)
        if (event.shiftKey && anchor.current) {
          const visible = Array.from(tree.current!.querySelectorAll<HTMLElement>('[data-asset-key]'), row => row.dataset.assetKey!)
          const start = visible.indexOf(anchor.current)
          const end = visible.indexOf(key)
          if (start !== -1 && end !== -1) {
            const range = visible.slice(Math.min(start, end), Math.max(start, end) + 1)
            setSelected(previous => event.ctrlKey ? new Set([...previous, ...range]) : new Set(range))
            return
          }
        }
        anchor.current = key
        setSelected(previous => {
          if (!event.ctrlKey) return new Set([key])
          const next = new Set(previous)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }}
      onMenu={(item, event) => {
        if (event.type === 'keydown') {
          const keyEvent = event as KeyboardEvent<HTMLButtonElement>
          if (keyEvent.key !== 'ContextMenu' && !(keyEvent.shiftKey && keyEvent.key === 'F10')) return
          menu.onKeyDown(keyEvent)
        } else menu.onContextMenu(event as MouseEvent<HTMLButtonElement>)
        setTarget(item)
        if ('entry' in item) {
          const key = assetKey(item.entry)
          if (!selected.has(key)) {
            setSelected(new Set([key]))
            anchor.current = key
          }
        }
      }} />
    {target && menu.position && <ContextMenu label={'folder' in target ? '文件夹操作' : '资源操作'}
      position={menu.position} onClose={menu.close}>
      {'folder' in target ? folderActions.map(([kind, label, Icon]) => (
        <DropdownMenuItem key={kind} onSelect={() => onExport({
          folder: { ...query, directory: target.folder, search: '' }, kind
        })}>
          <Icon aria-hidden="true" className={Icon === PersonStanding ? modelIconScale : undefined} />
          {label}
        </DropdownMenuItem>
      )) : <>
        <DropdownMenuItem onSelect={() => onPreview(target.entry, 'json')}>
          <FileText aria-hidden="true" />
          查看元数据
        </DropdownMenuItem>
        {isBlueprintClass(target.entry.assetClass) && <DropdownMenuItem onSelect={() => onPreview(target.entry, 'blueprint')}>
          <Workflow aria-hidden="true" />
          反编译蓝图
        </DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => onExport({ entries: [...selected].map(key => {
          const [path, archive] = JSON.parse(key) as [string, string]
          return { path, archive }
        }) })}>
          <Download aria-hidden="true" />
          {multiExport ? `导出所选资源（${selected.size}）` : '导出'}
        </DropdownMenuItem>
      </>}
    </ContextMenu>}
  </div>
}
