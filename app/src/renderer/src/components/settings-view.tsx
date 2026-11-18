import { useEffect, useRef, useState } from 'react'
import { Folder, FolderOpen, Globe, Info, Settings, Wrench } from 'lucide-react'
import type { AppConfigData, AppConfigPatch } from '@shared/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import Switch from './ui/switch'
import Sidebar from './sidebar'
import { toast } from './toast-card'
import YoudaoSettings from './youdao-settings'
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
  { id: 'paths', label: '路径', icon: <Folder size={20} /> },
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
const parseGroups = (groupsText: string) =>
  groupsText
    .split(/[,，、\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
export default function SettingsView({ config, onSaved }: Props) {
  const [section, setSection] = useState<(typeof settingsSections)[number]['id']>('paths')
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
  const flush = () => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    const patch = pendingPatchRef.current
    if (!Object.keys(patch).length) return
    pendingPatchRef.current = {}
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const before = configRef.current
      try {
        const next = await window.api.updateConfig(patch)
        configRef.current = next
        onSaved(
          next,
          next.modsDirectory !== before.modsDirectory ||
            next.backupsDirectory !== before.backupsDirectory
        )
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
            {section === 'paths' ? '路径设置' : section === 'preferences' ? '操作偏好' : section === 'translation' ? '有道翻译' : '高级设置'}
          </h1>
        </div>
        <div className="settings-content" key={section}>
          {section === 'paths' && (
            <>
              {pathFields.map(({ key, label, help }) => (
                <div className="settings-field" key={key}>
                  <label htmlFor={key}>{label}</label>
                  <div>
                    <div className="settings-path-input">
                      <Input
                        id={key}
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
                      <Button variant="outline" onClick={() => void browse(key)}>
                        <FolderOpen />
                        浏览
                      </Button>
                    </div>
                    <p>{help}</p>
                  </div>
                </div>
              ))}
              <div className="settings-note">
                <Info size={17} />
                修改备份目录不会搬移原目录中的文件。
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
              <div className="settings-toggle settings-exempt-groups">
                <span>
                  <strong>
                    <label htmlFor="exempt-groups">独占安装豁免分组</label>
                  </strong>
                  <small id="exempt-groups-help">
                    这些分组内允许同时安装多个模组，使用逗号分隔。
                  </small>
                </span>
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
            </>
          )}
          {section === 'translation' && <YoudaoSettings />}
          {section === 'advanced' && (
            <>
              {toggle('testImagesEnabled', '使用测试背景图', '调试时使用固定的测试图片目录。')}
              {toggle('fpsCounterEnabled', '显示帧率', '仅用于性能诊断。')}
              <div className="settings-config-file">
                <span className="select-text break-all">{config.configPath}</span>
                <Button variant="outline" onClick={() => void window.api.openConfigFile()}>
                  打开配置文件
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
