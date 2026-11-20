import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, Globe, Settings, SlidersHorizontal, Trash2, Wrench } from 'lucide-react'
import type { ApplicationCacheKind, ApplicationCacheSizes, AppConfigData, AppConfigPatch, ModInfo } from '@shared/types'
import { secondaryNameForMod } from '@shared/mod-list-logic'
import { formatFileSize } from '@/lib/format'
import { Button } from './ui/button'
import { AppDialog } from './ui/dialog'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import Switch from './ui/switch'
import Sidebar from './sidebar'
import { toast } from './toast-card'
import YoudaoSettings from './youdao-settings'
import ConfigFileEditor from './config-file-editor'
interface Props {
  config: AppConfigData
  mods: ModInfo[] | null
  onSaved: (config: AppConfigData, refresh: boolean) => void
}
type ToggleKey =
  | 'autoUseLastPackagingPath'
  | 'restoreLastCategory'
  | 'testImagesEnabled'
  | 'fpsCounterEnabled'
const SAVE_DEBOUNCE_MS = 500
const settingsSections = [
  { id: 'paths', label: '通用', icon: <SlidersHorizontal size={20} /> },
  { id: 'workbench', label: '工作台', icon: <Wrench size={20} /> },
  { id: 'preferences', label: '操作偏好', icon: <Settings size={20} /> },
  { id: 'translation', label: '有道翻译', icon: <Globe size={20} /> },
  { id: 'advanced', label: '高级', icon: <Wrench size={20} /> }
] as const
const cacheItems = [
  { kind: 'runtime', label: '运行数据' },
  { kind: 'translation', label: '翻译缓存' },
  { kind: 'image', label: '图片缓存' }
] as const
const pathFields = [
  { key: 'gameDirectory', label: '游戏安装目录', help: '选择包含 Client 目录的游戏根目录。' },
  {
    key: 'backupsDirectory',
    label: '模组备份目录',
    help: '导入的模组保存在此，安装时复制到游戏目录。'
  },
  {
    key: 'backgroundImagesDirectory',
    label: '背景图片目录',
    help: '图片按数字子文件夹组织，留空不加载本地背景。'
  }
] as const
const normalizePath = (path: string) => path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
const workbenchFields = [
  { key: 'workbenchAesKey', label: 'AES 密钥', help: '用于读取游戏的加密容器。' },
  {
    key: 'workbenchMapping',
    label: '属性映射文件',
    help: '用于解析游戏资源的属性，请选择与游戏版本匹配的 .usmap 文件。'
  },
  { key: 'workbenchExportDirectory', label: '资源导出目录', help: '保存从游戏资源浏览器导出的文件。' }
] as const
export default function SettingsView({ config, mods, onSaved }: Props) {
  const [section, setSection] = useState<(typeof settingsSections)[number]['id']>('paths')
  const [cacheDialogOpen, setCacheDialogOpen] = useState(false)
  const [cacheSelection, setCacheSelection] = useState<ApplicationCacheKind[]>([])
  const [clearingCache, setClearingCache] = useState(false)
  const [cacheSizes, setCacheSizes] = useState<ApplicationCacheSizes | '读取中…' | '无法读取'>('读取中…')
  useEffect(() => {
    if (section !== 'paths' || clearingCache) return
    let cancelled = false
    setCacheSizes('读取中…')
    void window.api.getApplicationCacheSizes().then((sizes) => {
      if (!cancelled) setCacheSizes(sizes)
    }).catch(() => {
      if (!cancelled) setCacheSizes('无法读取')
    })
    return () => { cancelled = true }
  }, [section, cacheDialogOpen, clearingCache])
  const totalCacheSize = typeof cacheSizes === 'string'
    ? cacheSizes
    : formatFileSize(cacheSizes.runtime + cacheSizes.translation + cacheSizes.image)
  const [draft, setDraft] = useState(config)
  const modGroups = useMemo(() => mods && new Set(
    mods.map((mod) => secondaryNameForMod(mod, draft.categories)).filter(Boolean)
  ), [mods, draft.categories])
  const selectedExemptGroups = new Set(draft.exclusiveInstallExemptGroups.filter(
    (group) => !modGroups || modGroups.has(group)
  ))
  const draftRef = useRef(draft)
  const configRef = useRef(config)
  const saveTimeoutRef = useRef<number | null>(null)
  const pendingPatchRef = useRef<AppConfigPatch>({})
  const saveQueueRef = useRef(Promise.resolve())
  const update = <K extends keyof AppConfigData>(key: K, value: AppConfigData[K]) => {
    const next = { ...draftRef.current, [key]: value }
    draftRef.current = next
    setDraft(next)
  }
  const reportSaved = (next: AppConfigData) => {
    const before = configRef.current
    configRef.current = next
    onSaved(
      next,
      next.modsDirectory !== before.modsDirectory || next.backupsDirectory !== before.backupsDirectory
    )
  }
  const flush = () => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    const patch = pendingPatchRef.current
    if (!Object.keys(patch).length) return
    const submittedBackups = draftRef.current.backupsDirectory
    pendingPatchRef.current = {}
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        reportSaved(await window.api.updateConfig(patch))
      } catch (error) {
        if (patch.backupsDirectory !== undefined && draftRef.current.backupsDirectory === submittedBackups) {
          update('backupsDirectory', configRef.current.backupsDirectory)
        }
        toast.error('设置保存失败', {
          description: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => flushRef.current(), [])
  const saveConfigFile = (original: string, content: string) => {
    flush()
    const before = draftRef.current
    const save = saveQueueRef.current.then(async () => {
      const next = await window.api.saveConfigFile(original, content)
      if (!next) return false
      const editsSinceSave = Object.fromEntries(Object.entries(draftRef.current).filter(
        ([key, value]) => before[key as keyof AppConfigData] !== value
      ))
      const draft = { ...next, ...editsSinceSave }
      draftRef.current = draft
      setDraft(draft)
      reportSaved(next)
      return true
    })
    saveQueueRef.current = save.then(() => undefined, () => undefined)
    return save
  }
  const scheduleSave = () => {
    if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
  }
  const updateText = (key: (typeof pathFields)[number]['key'], value: string) => {
    update(key, value)
    if (key === 'backupsDirectory') return
    const path = normalizePath(value)
    if (key !== 'backgroundImagesDirectory' && !path) {
      delete pendingPatchRef.current[key]
    } else {
      pendingPatchRef.current[key] = path
    }
    scheduleSave()
  }
  const updateExemptGroups = (groups: string[]) => {
    update('exclusiveInstallExemptGroups', groups)
    pendingPatchRef.current.exclusiveInstallExemptGroups = groups
    scheduleSave()
  }
  useEffect(() => {
    if (section !== 'preferences' || !modGroups) return
    const savedGroups = draftRef.current.exclusiveInstallExemptGroups
    const remaining = savedGroups.filter((group) => modGroups.has(group))
    if (remaining.length < savedGroups.length) updateExemptGroups(remaining)
  }, [section, modGroups, draft.exclusiveInstallExemptGroups])
  const saveBackupsDirectory = (value: string) => {
    const path = value.trim().replace(/\\/g, '/')
    if (!path) {
      toast.warning('模组备份目录不能为空')
      update('backupsDirectory', configRef.current.backupsDirectory)
      return
    }
    pendingPatchRef.current.backupsDirectory = path
    flush()
  }
  const browse = async (key: (typeof pathFields)[number]['key']) => {
    try {
      const selected = await window.api.pickDirectory(draftRef.current[key] || undefined)
      if (selected) {
        updateText(key, selected)
        if (key === 'backupsDirectory') saveBackupsDirectory(selected)
        else flush()
      }
    } catch (error) {
      toast.error('无法选择目录', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }
  const clearApplicationCache = async () => {
    if (!cacheSelection.length || clearingCache) return
    setClearingCache(true)
    try {
      await window.api.clearApplicationCache(cacheSelection)
      setCacheDialogOpen(false)
      toast.success('已清理选中的缓存项目')
    } catch (error) {
      toast.error('清除应用缓存失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setClearingCache(false)
    }
  }
  const toggle = (key: ToggleKey, label: string, help: string) => (
    <label className="settings-toggle">
      <span>
        <strong>{label}</strong>
        <small>{help}</small>
      </span>
      <Switch
        aria-label={label}
        checked={draft[key]}
        onCheckedChange={(checked) => {
          update(key, checked)
          pendingPatchRef.current[key] = checked
          flush()
        }}
      />
    </label>
  )
  return (
    <section className="settings-workspace">
      <Sidebar label="设置分组" items={settingsSections} activeId={section} onSelect={setSection} />
      <div className="settings-page">
        <div className="workspace-page-heading">
          <h1>
            {settingsSections.find(item => item.id === section)?.label}
          </h1>
        </div>
        <div className="settings-content" key={section} hidden={section === 'advanced'}>
          {section === 'workbench' && workbenchFields.map(({ key, label, help }) => {
            const save = (value: string) => {
              if (key === 'workbenchAesKey' && value.trim() && !/^(?:0x)?[0-9a-f]{64}$/i.test(value.trim())) {
                toast.error('AES 密钥需要 64 位十六进制字符。')
                return
              }
              pendingPatchRef.current[key] = value.trim()
              flush()
            }
            return (
              <div className="settings-field" key={key}>
                <div>
                  <label htmlFor={key}>{label}</label>
                  <p id={`${key}-help`}>{help}</p>
                </div>
                <div className="settings-input-row">
                  <Input id={key} type="text"
                    aria-describedby={`${key}-help`}
                    placeholder={key === 'workbenchMapping' ? '留空则使用内置映射文件。' : undefined}
                    value={draft[key]} onChange={event => update(key, event.target.value)}
                    onFocus={event => { event.currentTarget.dataset.previous = event.currentTarget.value }}
                    onBlur={event => {
                      if (event.currentTarget.dataset.previous !== event.currentTarget.value) save(event.currentTarget.value)
                    }} />
                  {key !== 'workbenchAesKey' && (
                    <Button variant="secondary" onClick={async () => {
                      const selected = key === 'workbenchMapping'
                        ? await window.api.pickFile({ title: label, extensions: ['usmap'], defaultPath: draft[key] })
                        : await window.api.pickDirectory(draft[key])
                      if (selected) { update(key, selected); save(selected) }
                    }}><FolderOpen />浏览</Button>
                  )}
                </div>
              </div>
            )
          })}
          {section === 'paths' && (
            <>
              {pathFields.map(({ key, label, help }) => (
                <div className="settings-field" key={key}>
                  <div>
                    <label htmlFor={key}>{label}</label>
                    <p id={`${key}-help`}>{help}</p>
                  </div>
                  <div className="settings-input-row">
                    <Input
                      id={key}
                      aria-describedby={`${key}-help`}
                      value={draft[key]}
                      onChange={(event) => {
                        updateText(key, event.target.value)
                      }}
                      onFocus={key === 'backupsDirectory' ? (event) => {
                        event.currentTarget.dataset.previous = event.currentTarget.value
                      } : undefined}
                      onBlur={(event) => {
                        if (key === 'backupsDirectory') {
                          if (event.currentTarget.dataset.previous !== event.currentTarget.value) {
                            saveBackupsDirectory(event.currentTarget.value)
                          }
                          return
                        }
                        if (key !== 'backgroundImagesDirectory' && !normalizePath(draftRef.current[key])) {
                          toast.warning('以下设置不能为空', { description: label })
                        }
                        flush()
                      }}
                    />
                    <Button type="button" variant="secondary" onClick={() => void browse(key)}>
                      <FolderOpen />
                      浏览
                    </Button>
                  </div>
                </div>
              ))}
              <div className="settings-toggle">
                <span>
                  <strong>应用缓存</strong>
                  <small id="application-cache-size" aria-live="polite">
                    当前缓存大小：{totalCacheSize}
                  </small>
                </span>
                <Button type="button" variant="secondary" aria-describedby="application-cache-size" onClick={() => {
                  setCacheSelection(['image'])
                  setCacheDialogOpen(true)
                }}>
                  <Trash2 aria-hidden="true" />
                  清除缓存
                </Button>
              </div>
            </>
          )}
          {section === 'preferences' && (
            <>
              {toggle(
                'autoUseLastPackagingPath',
                '重新打包时使用上次的源文件夹',
                '关闭后，每次重新打包都会选择源文件夹。'
              )}
              {toggle(
                'restoreLastCategory',
                '启动时恢复上次打开的分类',
                '关闭后，启动时显示全部模组。'
              )}
              <div className="settings-field">
                <div>
                  <label id="exempt-groups-label" htmlFor="exempt-groups">独占安装豁免分组</label>
                  <p id="exempt-groups-help">
                    {modGroups ? '选中的分组允许同时安装多个模组。' : '无法读取模组分组。'}
                  </p>
                </div>
                <div className="settings-input-row">
                  <DropdownMenu onOpenChange={(open) => { if (!open) flush() }}>
                    <DropdownMenuTrigger asChild>
                      <Button id="exempt-groups" type="button" variant="secondary" className="w-full justify-between"
                        disabled={!modGroups}
                        aria-labelledby="exempt-groups-label exempt-groups-count"
                        aria-describedby="exempt-groups-help">
                        <span id="exempt-groups-count">已选 {selectedExemptGroups.size} 个分组</span>
                        <ChevronDown aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => updateExemptGroups([])}>清除</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {modGroups && [...modGroups].map((group) => (
                        <DropdownMenuCheckboxItem key={group} checked={selectedExemptGroups.has(group)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={(checked) => {
                            const groups = new Set(draftRef.current.exclusiveInstallExemptGroups)
                            if (checked) groups.add(group)
                            else groups.delete(group)
                            updateExemptGroups([...groups])
                          }}>
                          {group}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </>
          )}
          {section === 'translation' && <YoudaoSettings />}
        </div>
        <div className="settings-content" hidden={section !== 'advanced'}>
          {toggle('testImagesEnabled', '使用测试背景图', '调试时使用固定的测试图片目录。')}
          {toggle('fpsCounterEnabled', '显示帧率', '仅用于性能诊断。')}
          <ConfigFileEditor active={section === 'advanced'} config={config} onSave={saveConfigFile} />
        </div>
      </div>
      <AppDialog
        open={cacheDialogOpen}
        onOpenChange={(open) => { if (!clearingCache) setCacheDialogOpen(open) }}
        title="清除缓存"
        description="勾选需要清理的项目。"
        panelClassName="flex flex-col"
        cancelAction={{ label: '取消', disabled: clearingCache }}
        confirmAction={{
          label: clearingCache ? '正在清理…' : '清理所选项目',
          destructive: true,
          disabled: clearingCache || cacheSelection.length === 0,
          onSelect: () => void clearApplicationCache()
        }}
      >
        <div className="divide-y divide-[var(--rule)]" aria-busy={clearingCache}>
          {cacheItems.map((item) => (
            <label key={item.kind} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-0 last:pb-0">
              <input
                type="checkbox"
                checked={cacheSelection.includes(item.kind)}
                disabled={clearingCache}
                aria-labelledby={`cache-label-${item.kind}`}
                aria-describedby={`cache-size-${item.kind}`}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  setCacheSelection((selection) => checked
                    ? [...selection, item.kind]
                    : selection.filter((kind) => kind !== item.kind))
                }}
              />
              <strong id={`cache-label-${item.kind}`} className="text-sm font-medium">{item.label}</strong>
              <span id={`cache-size-${item.kind}`} className="whitespace-nowrap text-sm tabular-nums text-muted-foreground" aria-live="polite">
                {typeof cacheSizes === 'string' ? cacheSizes : formatFileSize(cacheSizes[item.kind])}
              </span>
            </label>
          ))}
        </div>
      </AppDialog>
    </section>
  )
}
