import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Globe, Info, Settings, SlidersHorizontal, Trash2, Wrench } from 'lucide-react'
import type { AppConfigData, AppConfigPatch } from '@shared/types'
import { formatFileSize } from '@/lib/format'
import { Button } from './ui/button'
import { Input } from './ui/input'
import Switch from './ui/switch'
import Sidebar from './sidebar'
import { toast } from './toast-card'
import YoudaoSettings from './youdao-settings'
import ConfigFileEditor from './config-file-editor'
interface Props {
  config: AppConfigData
  onSaved: (config: AppConfigData, refresh: boolean) => void
}
type SettingsDraft = AppConfigData & { groupsText: string }
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
const parseGroups = (groupsText: string) =>
  groupsText
    .split(/[,，、\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
export default function SettingsView({ config, onSaved }: Props) {
  const [section, setSection] = useState<(typeof settingsSections)[number]['id']>('paths')
  const [clearingCache, setClearingCache] = useState(false)
  const [cacheSize, setCacheSize] = useState<number | '读取中…' | '无法读取'>('读取中…')
  useEffect(() => {
    if (section !== 'paths' || clearingCache) return
    let cancelled = false
    setCacheSize('读取中…')
    void window.api.getGameBananaTranslationCacheSize().then((size) => {
      if (!cancelled) setCacheSize(size)
    }).catch(() => {
      if (!cancelled) setCacheSize('无法读取')
    })
    return () => { cancelled = true }
  }, [section, clearingCache])
  const [draft, setDraft] = useState<SettingsDraft>(() => ({
    ...config,
    groupsText: config.exclusiveInstallExemptGroups.join('，')
  }))
  const draftRef = useRef(draft)
  const configRef = useRef(config)
  const saveTimeoutRef = useRef<number | null>(null)
  const pendingPatchRef = useRef<AppConfigPatch>({})
  const saveQueueRef = useRef(Promise.resolve())
  const update = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
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
    pendingPatchRef.current = {}
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        reportSaved(await window.api.updateConfig(patch))
      } catch (error) {
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
        ([key, value]) => before[key as keyof SettingsDraft] !== value
      ))
      const draft = { ...next, groupsText: next.exclusiveInstallExemptGroups.join('，'), ...editsSinceSave }
      draftRef.current = draft
      setDraft(draft)
      reportSaved(next)
      return true
    })
    saveQueueRef.current = save.then(() => undefined, () => undefined)
    return save
  }
  const updateText = (key: (typeof pathFields)[number]['key'] | 'groupsText', value: string) => {
    update(key, value)
    if (key === 'groupsText') {
      pendingPatchRef.current.exclusiveInstallExemptGroups = parseGroups(value)
    } else {
      const path = normalizePath(value)
      if (key !== 'backgroundImagesDirectory' && !path) {
        delete pendingPatchRef.current[key]
      } else {
        pendingPatchRef.current[key] = path
      }
    }
    if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
  }
  const browse = async (key: (typeof pathFields)[number]['key']) => {
    try {
      const selected = await window.api.pickDirectory(draftRef.current[key] || undefined)
      if (selected) {
        updateText(key, selected)
        flush()
      }
    } catch (error) {
      toast.error('无法选择目录', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }
  const clearTranslationCache = async () => {
    setClearingCache(true)
    try {
      await window.api.clearGameBananaTranslationCache()
      toast.success('已清除 GameBanana 翻译缓存')
    } catch (error) {
      toast.error('清除翻译缓存失败', {
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
                  <Input id={key} type={key === 'workbenchAesKey' ? 'password' : 'text'}
                    aria-describedby={`${key}-help`}
                    placeholder={key === 'workbenchMapping' ? '留空则使用内置映射文件。' : undefined}
                    value={draft[key]} onChange={event => update(key, event.target.value)}
                    onFocus={event => { event.currentTarget.dataset.previous = event.currentTarget.value }}
                    onBlur={event => {
                      if (event.currentTarget.dataset.previous !== event.currentTarget.value) save(event.currentTarget.value)
                    }} />
                  {key !== 'workbenchAesKey' && (
                    <Button variant="outline" onClick={async () => {
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
                      onBlur={() => {
                        if (key !== 'backgroundImagesDirectory' && !normalizePath(draftRef.current[key])) {
                          toast.warning('以下设置不能为空', { description: label })
                        }
                        flush()
                      }}
                    />
                    <Button type="button" variant="outline" onClick={() => void browse(key)}>
                      <FolderOpen />
                      浏览
                    </Button>
                  </div>
                </div>
              ))}
              <div className="settings-note">
                <Info size={17} />
                修改备份目录不会搬移原目录中的文件。
              </div>
              <div className="settings-toggle">
                <span>
                  <strong>应用缓存</strong>
                  <small id="application-cache-size" aria-live="polite">
                    当前缓存大小：{typeof cacheSize === 'number' ? formatFileSize(cacheSize) : cacheSize}
                  </small>
                </span>
                <Button type="button" variant="outline" aria-describedby="application-cache-size" onClick={() => void clearTranslationCache()} disabled={clearingCache}>
                  <Trash2 aria-hidden="true" />
                  {clearingCache ? '正在清除…' : '清除缓存'}
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
                  <label htmlFor="exempt-groups">独占安装豁免分组</label>
                  <p id="exempt-groups-help">
                    这些分组内允许同时安装多个模组，使用逗号分隔。
                  </p>
                </div>
                <div className="settings-input-row">
                  <Input
                    id="exempt-groups"
                    aria-describedby="exempt-groups-help"
                    value={draft.groupsText}
                    onChange={(event) => {
                      updateText('groupsText', event.target.value)
                    }}
                    onBlur={flush}
                    placeholder="例如：UI，特效"
                  />
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
    </section>
  )
}
