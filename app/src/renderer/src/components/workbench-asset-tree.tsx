import { useEffect, useState } from 'react'
import {
  AudioLines, Bone, Braces, ChevronRight, Clapperboard, File, FileText, Film, Folder, FolderOpen,
  Image, Map as MapIcon, Package, Palette, PanelsTopLeft, PersonStanding, Shapes, Sparkles, Table2, Type, Workflow, type LucideIcon
} from 'lucide-react'
import { Button } from './ui/button'
import type { AssetDirectory, AssetEntry, AssetQuery } from '@shared/workbench-assets'

type TreeQuery = Omit<AssetQuery, 'directory'>
type BranchProps = {
  query: TreeQuery
  directory?: string
  selected?: AssetEntry
  onSelect: (entry: AssetEntry) => void
}

const rowClass = 'h-7 w-full justify-start gap-1.5 border-0 px-2 text-left text-xs font-normal focus-visible:outline-offset-[-2px]'

const iconClasses: [LucideIcon, string[]][] = [
  [Image, [
    'Texture2D', 'Texture2DArray', 'Texture2DDynamic', 'TextureCube', 'TextureCubeArray', 'VolumeTexture',
    'TextureRenderTarget2D', 'TextureRenderTarget2DArray', 'TextureRenderTargetCube', 'TextureRenderTargetVolume',
    'LightMapTexture2D', 'VirtualTexture2D', 'CurveLinearColorAtlas', 'SpineAtlasAsset', 'PaperSprite'
  ]],
  [PersonStanding, ['StaticMesh', 'SkeletalMesh', 'GeometryCollection', 'GeometryCache']],
  [Bone, ['Skeleton']],
  [Shapes, ['PhysicsAsset']],
  [Palette, [
    'Material', 'MaterialInstance', 'MaterialInstanceConstant', 'MaterialFunction', 'MaterialFunctionInstance',
    'MaterialParameterCollection', 'MaterialLayer', 'MaterialLayerBlend'
  ]],
  [Clapperboard, [
    'AnimSequence', 'AnimMontage', 'AnimComposite', 'AnimBlueprint', 'AnimBlueprintGeneratedClass',
    'BlendSpace', 'BlendSpace1D', 'AimOffsetBlendSpace', 'AimOffsetBlendSpace1D', 'LevelSequence', 'SpineSkeletonDataAsset'
  ]],
  [PanelsTopLeft, ['WidgetBlueprint', 'WidgetBlueprintGeneratedClass', 'UserWidget', 'SlateWidgetStyleAsset']],
  [Workflow, ['Blueprint', 'BlueprintGeneratedClass', 'BlueprintFunctionLibrary']],
  [Sparkles, ['NiagaraSystem', 'NiagaraEmitter', 'NiagaraScript', 'ParticleSystem']],
  [AudioLines, [
    'SoundWave', 'SoundCue', 'SoundClass', 'SoundMix', 'SoundAttenuation', 'SoundConcurrency',
    'MetaSoundSource', 'AkAudioEvent', 'AkAudioBank', 'AkInitBank', 'AkMediaAsset'
  ]],
  [Table2, ['DataTable', 'CompositeDataTable', 'CurveTable', 'StringTable']],
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
    <Button type="button" variant="ghost" className={rowClass} title={path} aria-expanded={open}
      onClick={() => setOpen(value => !value)}>
      <ChevronRight aria-hidden="true" className={open ? 'rotate-90' : undefined} />
      {open ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
      <span className="truncate">{name}</span>
    </Button>
    {open && <WorkbenchAssetTree {...props} directory={path} />}
  </li>
}

export default function WorkbenchAssetTree({ query, directory = '', selected, onSelect }: BranchProps) {
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
    {result && result.count > 0 && <ul className={directory ? 'ml-3 border-l border-border pl-1' : 'p-1'}>
      {result.folders.map(path => <AssetFolder key={JSON.stringify([path, expandFolders])} path={path} expand={expandFolders}
        query={query} selected={selected} onSelect={onSelect} />)}
      {result.rows.map(row => {
        const name = row.path.slice(row.path.lastIndexOf('/') + 1)
        const Icon = fileIcon(name, row.assetClass)
        return <li key={JSON.stringify([row.path, row.archive])}>
          <Button type="button" variant="ghost" title={`${row.path}\n${row.archive}${row.assetClass ? `\n${row.assetClass}` : ''}`}
            aria-pressed={row.path === selected?.path && row.archive === selected.archive}
            className={`${rowClass} pl-7 aria-pressed:bg-accent aria-pressed:text-accent-foreground`}
            onClick={() => onSelect(row)}>
            <Icon aria-hidden="true" className={Icon === PersonStanding ? 'scale-125' : undefined} />
            <span className="truncate">{name}</span>
          </Button>
        </li>
      })}
    </ul>}
    {result?.count === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">没有匹配的资源。</p>}
    {error && <p role="alert" className="break-all px-3 py-2 text-xs text-destructive">{error}</p>}
  </div>
}
