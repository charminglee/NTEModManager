import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from '@/components/toast-card'
import type { AppConfigData, AppConfigPatch, LiquidGlassConfig } from '@shared/types'
import { LIQUID_GLASS_KEYS, UI_CORNER_RADIUS_MAX, UI_CORNER_RADIUS_MIN } from '@shared/types'
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
  /** 对话框打开期间把草稿里可实时预览的部分(圆角 + 玻璃效果)推给应用;关闭时传 null 回落到已保存值 */
  onPreview: (preview: { uiCornerRadius: number; liquidGlass: LiquidGlassConfig } | null) => void
}

interface SettingsDraft {
  gameDirectory: string
  backupsDirectory: string
  backgroundImagesDirectory: string
  packagerDirectory: string
  autoUseLastPackagingPath: boolean
  exemptGroupsText: string
  restoreLastCategory: boolean
  testImagesEnabled: boolean
  fpsCounterEnabled: boolean
  uiCornerRadius: number
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
    restoreLastCategory: config.restoreLastCategory,
    testImagesEnabled: config.testImagesEnabled,
    fpsCounterEnabled: config.fpsCounterEnabled,
    uiCornerRadius: config.uiCornerRadius,
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
export default function SettingsDialog({
  open,
  config,
  onOpenChange,
  onSaved,
  onPreview
}: SettingsDialogProps) {
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(config))
  const [saving, setSaving] = useState(false)
  /** 正在拖动隔离预览的滑块 id(null=无):按下滑块隐藏整个对话框只留滑块,松开恢复 */
  const [isolatedSlider, setIsolatedSlider] = useState<string | null>(null)
  /** 高级选项折叠状态:默认收起,每次打开对话框重置 */
  const [advancedOpen, setAdvancedOpen] = useState(false)
  /** 设置内容区滚动容器:展开「高级」时钉住底部滚动 */
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 高级展开期间的底部追踪 rAF id(高度过渡时逐帧跟随,null=未在追踪) */
  const advancedTrackId = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(toDraft(config))
      setIsolatedSlider(null)
      setAdvancedOpen(false)
    }
    stopAdvancedTracking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 打开期间随草稿实时预览可即时生效的部分:圆角(滑块/输入立即改 UI)与玻璃效果
  // (滑块一拖,拖动隔离又恰好让对话框隐去,直接看到实际界面的玻璃实时变化);关闭回落
  useEffect(() => {
    onPreview(open ? { uiCornerRadius: draft.uiCornerRadius, liquidGlass: draft.liquidGlass } : null)
  }, [open, draft.uiCornerRadius, draft.liquidGlass, onPreview])

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
      draft.restoreLastCategory !== config.restoreLastCategory ||
      draft.testImagesEnabled !== config.testImagesEnabled ||
      draft.fpsCounterEnabled !== config.fpsCounterEnabled ||
      draft.uiCornerRadius !== config.uiCornerRadius ||
      liquidGlassChanged ||
      groupsChanged
    )
  }, [draft, config])

  const stopAdvancedTracking = () => {
    if (advancedTrackId.current !== null) {
      cancelAnimationFrame(advancedTrackId.current)
      advancedTrackId.current = null
    }
  }

  /** 切换「高级」展开/收起。展开时高度过渡(200ms)期间逐帧把滚动容器钉在底部:
   *  滚动与展开同步连续平滑,结束时正好停在展开内容的底部(高度还在增长时直接
   *  scrollTo({behavior:'smooth'}) 会被当时的 scrollHeight 截住,收敛在中途)。 */
  const toggleAdvanced = () => {
    const next = !advancedOpen
    setAdvancedOpen(next)
    stopAdvancedTracking()
    if (!next) return
    const scroller = scrollRef.current
    if (!scroller) return
    const start = performance.now()
    const track = (now: number) => {
      advancedTrackId.current = null
      // 对话框可能在追踪期间被关闭(Radix 卸载内容),容器已不在文档里就收手
      if (!scroller.isConnected) return
      scroller.scrollTop = scroller.scrollHeight
      // 260ms = 200ms 高度过渡 + 余量收尾帧,确保追到定型后的最终底部
      if (now - start < 260) {
        advancedTrackId.current = requestAnimationFrame(track)
      }
    }
    advancedTrackId.current = requestAnimationFrame(track)
    // 兜底:渲染帧暂停(窗口失焦/最小化)时 rAF 链会被丢弃,过渡在恢复渲染时瞬间完成,
    // 补一次 smooth 滚动;正常路径此时已钉在底部,同一目标的 smooth 滚动等于空操作
    window.setTimeout(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    }, 300)
  }

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
        restoreLastCategory: draft.restoreLastCategory,
        testImagesEnabled: draft.testImagesEnabled,
        fpsCounterEnabled: draft.fpsCounterEnabled,
        uiCornerRadius: draft.uiCornerRadius,
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
      {/* 滑块拖动隔离(index.css 的 data-slider-isolated 规则):滑块值变化后隐藏遮罩
          与面板、只留当前滑块,预览时看到的就是无遮拦的实际界面效果 */}
      <DialogContent
        className="max-w-xl"
        data-slider-isolated={isolatedSlider !== null || undefined}
      >
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>修改应用的路径与偏好设置，保存后立即生效。</DialogDescription>
        </DialogHeader>

        {/* 负外边距 + 内边距:给聚焦圈留出渲染空间,避免被 overflow 裁剪 */}
        <div
          ref={scrollRef}
          className="-m-1.5 max-h-[65vh] space-y-6 overflow-y-auto p-1.5"
        >
          <SettingsSection title="路径">
            <PathField
              label="游戏安装目录"
              description="模组安装将到「游戏目录/Client/WindowsNoEditor/HT/Content/Paks/~mods」。"
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
            <SwitchRow
              label="启动时恢复上次打开的分类"
              description="启动后自动选中上次退出时正在浏览的分类。"
              checked={draft.restoreLastCategory}
              onCheckedChange={(checked) => patchField('restoreLastCategory', checked)}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="settings-exempt-groups">独占安装豁免分组</Label>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                安装模组时会卸载同分组的其他模组；逗号分隔的豁免分组内的模组不会被卸载。
              </p>
              <Input
                id="settings-exempt-groups"
                value={draft.exemptGroupsText}
                onChange={(event) => patchField('exemptGroupsText', event.target.value)}
                placeholder="UI，其他分组名"
                spellCheck={false}
                className="border-transparent hover:bg-foreground/[0.06]"
              />
            </div>
            <SliderRow
              label="全局圆角"
              description={`所有界面控件（含玻璃面板）统一的圆角半径（${UI_CORNER_RADIUS_MIN}–${UI_CORNER_RADIUS_MAX}）。`}
              value={draft.uiCornerRadius}
              onChange={(value) => patchField('uiCornerRadius', value)}
              min={UI_CORNER_RADIUS_MIN}
              max={UI_CORNER_RADIUS_MAX}
              step={1}
              unit="px"
              sliderId="uiCornerRadius"
              activeSliderId={isolatedSlider}
              onActiveSliderChange={setIsolatedSlider}
            />
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
                <SelectTrigger
                  className="w-28 shrink-0 border-transparent bg-transparent hover:bg-foreground/[0.06]"
                  aria-label="玻璃渲染方式"
                >
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
                  sliderId="refraction"
                  activeSliderId={isolatedSlider}
                  onActiveSliderChange={setIsolatedSlider}
                />
                <SliderRow
                  label="背景模糊"
                  description="玻璃背后的高斯模糊强度，面积越大越耗性能。"
                  value={draft.liquidGlass.blur}
                  onChange={(value) => patchLiquidGlass({ blur: value })}
                  sliderId="blur"
                  activeSliderId={isolatedSlider}
                  onActiveSliderChange={setIsolatedSlider}
                />
                <SliderRow
                  label="边缘高光"
                  description="玻璃边缘的镜面反光强度。"
                  value={draft.liquidGlass.specular}
                  onChange={(value) => patchLiquidGlass({ specular: value })}
                  sliderId="specular"
                  activeSliderId={isolatedSlider}
                  onActiveSliderChange={setIsolatedSlider}
                />
                <SliderRow
                  label="边缘色散"
                  description="折射边缘的彩虹色散强度；仅作用于侧边栏。"
                  value={draft.liquidGlass.dispersion}
                  onChange={(value) => patchLiquidGlass({ dispersion: value })}
                  sliderId="dispersion"
                  activeSliderId={isolatedSlider}
                  onActiveSliderChange={setIsolatedSlider}
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
                  label="日志面板"
                  checked={draft.liquidGlass.logPanel}
                  onCheckedChange={(checked) => patchLiquidGlass({ logPanel: checked })}
                />
                <SwitchRow
                  label="按钮"
                  description="玻璃样式按钮(工具栏、浏览、打开等)的液态玻璃渲染。"
                  checked={draft.liquidGlass.buttons}
                  onCheckedChange={(checked) => patchLiquidGlass({ buttons: checked })}
                />
                <SwitchRow
                  label="输入框"
                  description="搜索框、路径输入、重命名输入等文本框的液态玻璃渲染。"
                  checked={draft.liquidGlass.inputs}
                  onCheckedChange={(checked) => patchLiquidGlass({ inputs: checked })}
                />
                <SwitchRow
                  label="浮层"
                  description="对话框、下拉菜单、选择器、右下角通知等悬浮面板的液态玻璃渲染。"
                  checked={draft.liquidGlass.overlays}
                  onCheckedChange={(checked) => patchLiquidGlass({ overlays: checked })}
                />
              </>
            )}
          </SettingsSection>

          {/* 高级选项:默认收起,标题整行可点。grid-rows 0fr/1fr 过渡做高度折叠动画
              (overflow-hidden 的网格项自动 min-height:0,0fr 才压得平) */}
          <section>
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={toggleAdvanced}
              className="-ml-1 flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              高级
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                  !advancedOpen && '-rotate-90'
                )}
              />
            </button>
            <div
              className={cn(
                // visibility 参与过渡:收起过程中内容保持可见至高度归零后再隐藏,
                // 展开时立即可见;hidden 状态同时把内容移出 Tab 焦点序与无障碍树
                'grid transition-[grid-template-rows,visibility] duration-200 ease-out',
                advancedOpen ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]'
              )}
            >
              <div className="overflow-hidden">
                <div className="space-y-4 pt-3 pb-1">
                  <SwitchRow
                    label="使用测试背景图"
                    description="调试用：启用后背景图改用固定的测试图片目录。"
                    checked={draft.testImagesEnabled}
                    onCheckedChange={(checked) => patchField('testImagesEnabled', checked)}
                  />
                  <SwitchRow
                    label="显示 FPS 计数器"
                    description="在窗口左下角显示当前帧率，用于性能诊断。"
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
                      className="w-16 shrink-0"
                      onClick={() => void window.api.openConfigFile()}
                    >
                      打开
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>
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
      {description && <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>}
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="border-transparent font-mono text-xs hover:bg-foreground/[0.06]"
        />
        <Button type="button" variant="glass" className="w-16 shrink-0" onClick={onBrowse}>
          浏览
        </Button>
      </div>
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
  onChange,
  min = 0,
  max = 100,
  step = 5,
  unit = '%',
  sliderId,
  activeSliderId,
  onActiveSliderChange
}: {
  label: string
  description?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** 数值后缀:玻璃强度为百分比,全局圆角为像素 */
  unit?: string
  /** 拖动隔离:滑块值变化时上报自身 id、松开/按键抬起置回 null(dialog 根上据此挂 data-slider-isolated) */
  sliderId: string
  activeSliderId: string | null
  onActiveSliderChange: (id: string | null) => void
}) {
  const isolated = activeSliderId === sliderId

  // 滑出滑块外松开、pointercancel(切窗口等)都要恢复对话框;键盘方向键调值没有指针事件,
  // 用 keyup 兜底,监听放 window 才兜得住
  useEffect(() => {
    if (!isolated) return
    const release = () => onActiveSliderChange(null)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('keyup', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('keyup', release)
    }
  }, [isolated, onActiveSliderChange])

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value}
          {unit}
        </span>
      </div>
      {description && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => {
          // 值真正变化才开始隔离:单纯按下(未拖动)不隐藏对话框
          if (next !== value) onActiveSliderChange(sliderId)
          onChange(next)
        }}
        aria-label={label}
        data-slider-isolate-keep={isolated || undefined}
      />
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
