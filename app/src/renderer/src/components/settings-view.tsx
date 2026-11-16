import { useEffect, useMemo, useState } from 'react'
import { Folder, FolderOpen, Info, Settings, Wrench } from 'lucide-react'
import type { AppConfigData, AppConfigPatch } from '@shared/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import Switch from './ui/switch'
import { toast } from './toast-card'
interface Props {
  config: AppConfigData
  onSaved: (config: AppConfigData, refresh: boolean) => void
  onDirtyChange: (dirty: boolean) => void
  onCancel: () => void
}
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
  },
  { key: 'packagerDirectory', label: '打包器目录', help: '选择包含「傻瓜打包器.bat」的文件夹。' }
] as const
const normalizePath = (path: string) => path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
export default function SettingsView({ config, onSaved, onDirtyChange, onCancel }: Props) {
  const [section, setSection] = useState<'paths' | 'preferences' | 'advanced'>('paths')
  const [draft, setDraft] = useState(() => ({
    ...config,
    groupsText: config.exclusiveInstallExemptGroups.join('，')
  }))
  const [saving, setSaving] = useState(false)
  const groups = useMemo(
    () =>
      draft.groupsText
        .split(/[,，、\n]/)
        .map((v) => v.trim())
        .filter(Boolean),
    [draft.groupsText]
  )
  const dirty =
    pathFields.some(({ key }) => normalizePath(draft[key]) !== normalizePath(config[key])) ||
    [
      'autoUseLastPackagingPath',
      'restoreLastCategory',
      'testImagesEnabled',
      'fpsCounterEnabled'
    ].some((key) => draft[key as keyof typeof draft] !== config[key as keyof AppConfigData]) ||
    groups.join(',') !== config.exclusiveInstallExemptGroups.join(',')
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])
  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }))
  const browse = async (key: (typeof pathFields)[number]['key']) => {
    try {
      const selected = await window.api.pickDirectory(draft[key] || undefined)
      if (selected) update(key, selected)
    } catch (error) {
      toast.error('无法选择目录', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }
  const save = async () => {
    const missing = pathFields
      .filter(({ key }) => key !== 'backgroundImagesDirectory' && !normalizePath(draft[key]))
      .map((field) => field.label)
    if (missing.length) {
      toast.warning('以下设置不能为空', { description: missing.join('、') })
      return
    }
    setSaving(true)
    try {
      const patch: AppConfigPatch = {
        ...Object.fromEntries(pathFields.map(({ key }) => [key, normalizePath(draft[key])])),
        autoUseLastPackagingPath: draft.autoUseLastPackagingPath,
        exclusiveInstallExemptGroups: groups,
        restoreLastCategory: draft.restoreLastCategory,
        testImagesEnabled: draft.testImagesEnabled,
        fpsCounterEnabled: draft.fpsCounterEnabled
      }
      const next = await window.api.updateConfig(patch)
      setDraft({ ...next, groupsText: next.exclusiveInstallExemptGroups.join('，') })
      onDirtyChange(false)
      onSaved(
        next,
        next.modsDirectory !== config.modsDirectory ||
          next.backupsDirectory !== config.backupsDirectory
      )
      toast.success('设置已保存')
    } catch (error) {
      toast.error('设置保存失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSaving(false)
    }
  }
  const toggle = (
    key:
      | 'autoUseLastPackagingPath'
      | 'restoreLastCategory'
      | 'testImagesEnabled'
      | 'fpsCounterEnabled',
    label: string,
    help: string
  ) => (
    <label className="settings-toggle">
      <span>
        <strong>{label}</strong>
        <small>{help}</small>
      </span>
      <Switch
        aria-label={label}
        checked={draft[key]}
        disabled={saving}
        onCheckedChange={(checked) => update(key, checked)}
      />
    </label>
  )
  return (
    <section className="settings-workspace">
      <nav className="settings-navigation ink-panel" aria-label="设置分组">
        {(
          [
            { id: 'paths', label: '路径', Icon: Folder },
            { id: 'preferences', label: '操作偏好', Icon: Settings },
            { id: 'advanced', label: '高级', Icon: Wrench }
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-page">
        <div className="workspace-page-heading">
          <h1>
            {section === 'paths' ? '路径设置' : section === 'preferences' ? '操作偏好' : '高级设置'}
          </h1>
          <p>
            {section === 'paths'
              ? '配置游戏与模组的存放位置。'
              : section === 'preferences'
                ? '调整模组操作与启动习惯。'
                : '调试选项与配置文件。'}
          </p>
          <span className="hazard-mark" aria-hidden />
        </div>
        <div className="settings-content">
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
                        disabled={saving}
                        onChange={(e) => update(key, e.target.value)}
                      />
                      <Button variant="outline" disabled={saving} onClick={() => void browse(key)}>
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
                保存后生效。修改备份目录不会搬移原目录中的文件。
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
                <label htmlFor="exempt-groups">独占安装豁免分组</label>
                <div>
                  <Input
                    id="exempt-groups"
                    value={draft.groupsText}
                    disabled={saving}
                    onChange={(e) => update('groupsText', e.target.value)}
                    placeholder="例如：UI，特效"
                  />
                  <p>这些分组内允许同时安装多个模组，使用逗号分隔。</p>
                </div>
              </div>
            </>
          )}
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
        <div className="settings-footer">
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            取消
          </Button>
          <Button disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? '正在保存…' : '保存设置'}
          </Button>
        </div>
      </div>
    </section>
  )
}
