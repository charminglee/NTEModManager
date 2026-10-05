import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { AppConfigData, AppConfigPatch, LiquidGlassConfig } from '@shared/types'
import { LIQUID_GLASS_KEYS } from '@shared/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Switch from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

interface SettingsDialogProps {
  open: boolean
  config: AppConfigData
  onOpenChange: (open: boolean) => void
  /** 保存成功后回调;modsDirectoryChanged 时调用方需刷新模组列表 */
  onSaved: (config: AppConfigData, modsDirectoryChanged: boolean) => void
}

interface SettingsDraft {
  gameDirectory: string
  backupsDirectory: string
  backgroundImagesDirectory: string
  packagerDirectory: string
  autoUseLastPackagingPath: boolean
  exemptGroupsText: string
  testImagesEnabled: boolean
  fpsCounterEnabled: boolean
  liquidGlass: LiquidGlassConfig
}

function toDraft(config: AppConfigData): SettingsDraft {
  return {
    gameDirectory: config.gameDirectory,
    backupsDirectory: config.backupsDirectory,
    backgroundImagesDirectory: config.backgroundImagesDirectory,
    packagerDirectory: config.packagerDirectory,
    autoUseLastPackagingPath: config.autoUseLastPackagingPath,
    exemptGroupsText: config.exclusiveInstallExemptGroups.join(','),
    testImagesEnabled: config.testImagesEnabled,
    fpsCounterEnabled: config.fpsCounterEnabled,
    liquidGlass: { ...config.liquidGlass }
  }
}

const normPath = (value: string): string => value.trim().replace(/\\/g, '/').replace(/\/+$/, '')

const parseGroups = (text: string): string[] =>
  text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)

/** 设置对话框:点击侧边栏「设置」打开,集中编辑路径与偏好,保存后写入配置文件。 */
export default function SettingsDialog({ open, config, onOpenChange, onSaved }: SettingsDialogProps) {
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(config))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(toDraft(config))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const dirty = useMemo(() => {
    const groupsChanged =
      parseGroups(draft.exemptGroupsText).join(',') !== config.exclusiveInstallExemptGroups.join(',')
    const liquidGlassChanged = LIQUID_GLASS_KEYS.some(
      (key) => draft.liquidGlass[key] !== config.liquidGlass[key]
    )
    return (
      normPath(draft.gameDirectory) !== config.gameDirectory ||
      normPath(draft.backupsDirectory) !== config.backupsDirectory ||
      normPath(draft.backgroundImagesDirectory) !== config.backgroundImagesDirectory ||
      normPath(draft.packagerDirectory) !== config.packagerDirectory ||
      draft.autoUseLastPackagingPath !== config.autoUseLastPackagingPath ||
      draft.testImagesEnabled !== config.testImagesEnabled ||
      draft.fpsCounterEnabled !== config.fpsCounterEnabled ||
      liquidGlassChanged ||
      groupsChanged
    )
  }, [draft, config])

  const patchField = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const patchLiquidGlass = (patch: Partial<LiquidGlassConfig>) => {
    setDraft((prev) => ({ ...prev, liquidGlass: { ...prev.liquidGlass, ...patch } }))
  }

  const browseDirectory = (
    key: 'gameDirectory' | 'backupsDirectory' | 'backgroundImagesDirectory' | 'packagerDirectory'
  ) => {
    void window.api.pickDirectory(draft[key] || undefined).then((picked) => {
      if (picked) {
        patchField(key, picked)
      }
    })
  }

  const save = async () => {
    const required: [string, string][] = [
      ['游戏安装目录', draft.gameDirectory],
      ['模组备份目录', draft.backupsDirectory],
      ['打包器目录', draft.packagerDirectory]
    ]
    const missing = required.filter(([, value]) => normPath(value).length === 0).map(([label]) => label)
    if (missing.length > 0) {
      toast.warning('以下设置不能为空', { description: missing.join('、') })
      return
    }

    setSaving(true)
    try {
      const patch: AppConfigPatch = {
        gameDirectory: normPath(draft.gameDirectory),
        backupsDirectory: normPath(draft.backupsDirectory),
        backgroundImagesDirectory: normPath(draft.backgroundImagesDirectory),
        packagerDirectory: normPath(draft.packagerDirectory),
        autoUseLastPackagingPath: draft.autoUseLastPackagingPath,
        exclusiveInstallExemptGroups: parseGroups(draft.exemptGroupsText),
        testImagesEnabled: draft.testImagesEnabled,
        fpsCounterEnabled: draft.fpsCounterEnabled,
        liquidGlass: draft.liquidGlass
      }
      const next = await window.api.updateConfig(patch)
      const modsDirectoryChanged = next.modsDirectory !== config.modsDirectory
      toast.success('设置已保存')
      onSaved(next, modsDirectoryChanged)
      onOpenChange(false)
    } catch (error) {
      toast.error('设置保存失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>修改应用的路径与偏好设置，保存后立即生效。</DialogDescription>
        </DialogHeader>

        {/* 负外边距 + 内边距:给聚焦圈留出渲染空间,避免被 overflow 裁剪 */}
        <div className="-m-1.5 max-h-[65vh] space-y-6 overflow-y-auto p-1.5">
          <SettingsSection title="路径">
            <PathField
              label="游戏安装目录"
              description="模组安装到「游戏目录/Client/WindowsNoEditor/HT/Content/Paks/~mods」，启动器取「游戏目录/NTELauncher.exe」，随此目录自动更新。"
              value={draft.gameDirectory}
              onChange={(value) => patchField('gameDirectory', value)}
              onBrowse={() => browseDirectory('gameDirectory')}
            />
            <PathField
              label="模组备份目录"
              value={draft.backupsDirectory}
              onChange={(value) => patchField('backupsDirectory', value)}
              onBrowse={() => browseDirectory('backupsDirectory')}
            />
            <PathField
              label="背景图片目录"
              description="按「数字命名的子文件夹」组织图片；留空则不加载本地背景图。"
              value={draft.backgroundImagesDirectory}
              onChange={(value) => patchField('backgroundImagesDirectory', value)}
              onBrowse={() => browseDirectory('backgroundImagesDirectory')}
            />
            <PathField
              label="打包器目录"
              description="需包含「傻瓜打包器.bat」。"
              value={draft.packagerDirectory}
              onChange={(value) => patchField('packagerDirectory', value)}
              onBrowse={() => browseDirectory('packagerDirectory')}
            />
          </SettingsSection>

          <SettingsSection title="偏好">
            <SwitchRow
              label="重新打包时自动使用上次的源文件夹"
              description="关闭后，每次重新打包都会弹出文件夹选择窗口。"
              checked={draft.autoUseLastPackagingPath}
              onCheckedChange={(checked) => patchField('autoUseLastPackagingPath', checked)}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="settings-exempt-groups">独占安装豁免分组</Label>
              <Input
                id="settings-exempt-groups"
                value={draft.exemptGroupsText}
                onChange={(event) => patchField('exemptGroupsText', event.target.value)}
                placeholder="UI，其他分组名"
                spellCheck={false}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                安装模组时会卸载同分组的其他模组；逗号分隔的豁免分组内的模组不会被卸载。
              </p>
            </div>
          </SettingsSection>

          <SettingsSection title="玻璃效果">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">渲染方式</div>
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                  液态玻璃为折射实时渲染；毛玻璃为轻量高透模糊，渲染开销更低。
                </div>
              </div>
              <Select
                value={draft.liquidGlass.enabled ? 'liquid' : 'frosted'}
                onValueChange={(value) => patchLiquidGlass({ enabled: value === 'liquid' })}
              >
                <SelectTrigger className="w-28 shrink-0" aria-label="玻璃渲染方式">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="liquid">液态玻璃</SelectItem>
                  <SelectItem value="frosted">毛玻璃</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!draft.liquidGlass.enabled ? null : (
              <>
                <SwitchGroupLabel>强度</SwitchGroupLabel>
                <SliderRow
                  label="折射"
                  description="玻璃对背景图的透镜形变强度。"
                  value={draft.liquidGlass.refraction}
                  onChange={(value) => patchLiquidGlass({ refraction: value })}
                />
                <SliderRow
                  label="背景模糊"
                  description="玻璃背后的高斯模糊强度，面积越大越耗性能。"
                  value={draft.liquidGlass.blur}
                  onChange={(value) => patchLiquidGlass({ blur: value })}
                />
                <SliderRow
                  label="边缘高光"
                  description="玻璃边缘的镜面反光强度。"
                  value={draft.liquidGlass.specular}
                  onChange={(value) => patchLiquidGlass({ specular: value })}
                />
                <SliderRow
                  label="边缘色散"
                  description="折射边缘的彩虹色散强度；渲染开销成倍增加，保持 0 关闭。"
                  value={draft.liquidGlass.dispersion}
                  onChange={(value) => patchLiquidGlass({ dispersion: value })}
                />
                <SwitchGroupLabel>区域</SwitchGroupLabel>
                <SwitchRow
                  label="侧边栏"
                  checked={draft.liquidGlass.sidebar}
                  onCheckedChange={(checked) => patchLiquidGlass({ sidebar: checked })}
                />
                <SwitchRow
                  label="模组卡片"
                  checked={draft.liquidGlass.modCards}
                  onCheckedChange={(checked) => patchLiquidGlass({ modCards: checked })}
                />
                <SwitchRow
                  label="顶部工具栏"
                  checked={draft.liquidGlass.toolbar}
                  onCheckedChange={(checked) => patchLiquidGlass({ toolbar: checked })}
                />
                <SwitchRow
                  label="状态栏"
                  checked={draft.liquidGlass.statusBar}
                  onCheckedChange={(checked) => patchLiquidGlass({ statusBar: checked })}
                />
                <SwitchRow
                  label="日志面板"
                  checked={draft.liquidGlass.logPanel}
                  onCheckedChange={(checked) => patchLiquidGlass({ logPanel: checked })}
                />
              </>
            )}
          </SettingsSection>

          <SettingsSection title="高级">
            <SwitchRow
              label="使用测试背景图"
              description="调试用：启用后背景图改用固定的测试图片目录。"
              checked={draft.testImagesEnabled}
              onCheckedChange={(checked) => patchField('testImagesEnabled', checked)}
            />
            <SwitchRow
              label="显示 FPS 计数器"
              description="在底部状态栏显示当前帧率，用于性能诊断。"
              checked={draft.fpsCounterEnabled}
              onCheckedChange={(checked) => patchField('fpsCounterEnabled', checked)}
            />
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">直接编辑配置文件</div>
                <div className="text-xs text-muted-foreground">在系统默认编辑器中打开 INI 配置文件。</div>
              </div>
              <Button
                type="button"
                variant="glass"
                size="sm"
                className="shrink-0"
                onClick={() => void window.api.openConfigFile()}
              >
                打开
              </Button>
            </div>
          </SettingsSection>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function PathField({
  label,
  description,
  value,
  onChange,
  onBrowse
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  onBrowse: () => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="font-mono text-xs"
        />
        <Button type="button" variant="glass" className="w-16 shrink-0" onClick={onBrowse}>
          浏览
        </Button>
      </div>
      {description && <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  )
}

function SwitchGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </div>
  )
}

function SliderRow({
  label,
  description,
  value,
  onChange
}: {
  label: string
  description?: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <span className="text-xs tabular-nums text-muted-foreground">{value}%</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={5}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        aria-label={label}
      />
      {description && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4', disabled && 'opacity-60')}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="text-[11px] leading-relaxed text-muted-foreground">{description}</div>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  )
}
