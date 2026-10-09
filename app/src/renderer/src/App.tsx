import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/toast-card'
import { Blocks, LoaderCircle } from 'lucide-react'
import {
  ALL_CATEGORY,
  OTHER_CATEGORY,
  type AppConfigData,
  type BatchModAction,
  type LiquidGlassConfig,
  type ModInfo,
  type OperationResult,
  SortOrder,
  UI_CORNER_RADIUS_DEFAULT
} from '@shared/types'
import {
  countByCategory,
  filterAndSort,
  groupBySecondaryName,
  normalizeCategories,
  orderedCategories
} from '@shared/mod-list-logic'
import { basenameWithoutExtension, joinPath } from '@/lib/format'
import BackgroundLayer from '@/components/background-layer'
import { LiquidGlass, LiquidGlassConfigProvider } from '@/components/liquid-glass'
import Sidebar from '@/components/sidebar'
import ModListHeader from '@/components/mod-list-header'
import ModCard, { type ModCardActions } from '@/components/mod-card'
import BatchActionBar from '@/components/batch-action-bar'
import LogView from '@/components/log-view'
import FpsCounter from '@/components/fps-counter'
import PromptDialog from '@/components/prompt-dialog'
import SettingsDialog from '@/components/settings-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

type PendingConfirm =
  | { kind: 'delete'; modName: string }
  | { kind: 'install-invalid'; modName: string }
  | { kind: 'reinstall-invalid'; modName: string }
  | { kind: 'install-all-invalid'; modNames: string[] }
  | { kind: 'batch-delete'; modNames: string[] }
  | {
      kind: 'batch-invalid'
      /** 确认后要执行的批量动作 */
      action: 'install' | 'reinstall'
      /** 实际要批量执行的完整名单 */
      modNames: string[]
      /** 其中带失效标记的子集(提示用) */
      invalidNames: string[]
    }
  | null

interface RenameQueueItem {
  modName: string
  defaultName: string
}

export default function App() {
  const [config, setConfig] = useState<AppConfigData | null>(null)
  const [mods, setMods] = useState<ModInfo[]>([])
  const [currentCategory, setCurrentCategory] = useState<string>(ALL_CATEGORY)
  const [view, setView] = useState<'mods' | 'logs'>('mods')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [chromeHidden, setChromeHidden] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 设置对话框打开期间的实时预览草稿(圆角 + 玻璃效果,滑动/切换立即生效);null 表示用已保存值 */
  const [settingsPreview, setSettingsPreview] = useState<{
    uiCornerRadius: number
    liquidGlass: LiquidGlassConfig
  } | null>(null)

  const [categoryImages, setCategoryImages] = useState<Map<string, string | null>>(new Map())
  const [appIcon, setAppIcon] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<{
    title: string
    description?: string
    label: string
    initialValue: string
    onConfirm: (value: string) => void
  } | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null)
  const [renameQueue, setRenameQueue] = useState<RenameQueueItem[]>([])

  // ============ 多选(批量操作) ============
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  /** Shift 范围选择的锚点(卡片名) */
  const selectionAnchorRef = useRef<string | null>(null)
  // 镜像最新值供稳定引用的回调读取:选择相关回调若依赖 visibleMods/mods,
  // 每次搜索输入都会换引用,上百张 memo 化卡片会跟着全部重渲染
  const displayOrderRef = useRef<string[]>([])
  const modsRef = useRef(mods)
  /** 有对话框/确认弹层打开时为 true:多选快捷键(Ctrl+A/Esc)让位给弹层 */
  const modalOpenRef = useRef(false)

  const busyRef = useRef(false)
  const dragDepthRef = useRef(0)

  const refreshMods = useCallback(async (): Promise<ModInfo[]> => {
    const scanned = await window.api.scanMods()
    setMods(scanned)
    return scanned
  }, [])

  const withBusy = useCallback(
    async <T,>(_activity: string, operation: () => Promise<T>): Promise<T | null> => {
      if (busyRef.current) {
        toast.warning('已有操作正在进行中，请稍候')
        return null
      }
      busyRef.current = true
      setBusy(true)
      try {
        return await operation()
      } catch (error) {
        toast.error('操作未完成', {
          description: error instanceof Error ? error.message : String(error)
        })
        return null
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    []
  )

  const reportResult = useCallback((result: OperationResult, options?: { silentSuccess?: boolean }) => {
    if (result.cancelled) {
      toast.info('已取消操作')
      return
    }
    if (result.success) {
      if (!options?.silentSuccess && result.message) {
        toast.success(result.message)
      }
    } else {
      toast.error('操作未完成', { description: result.message })
    }
  }, [])

  const runOperation = useCallback(
    async (
      activity: string,
      operation: () => Promise<OperationResult | { result: OperationResult }>,
      options?: { silentSuccess?: boolean }
    ): Promise<OperationResult | null> => {
      const value = await withBusy(activity, operation)
      if (value === null) {
        return null
      }
      const result = 'result' in value ? value.result : value
      reportResult(result, options)
      return result
    },
    [withBusy, reportResult]
  )

  // ============ 初始化 ============
  useEffect(() => {
    void (async () => {
      const bootstrap = await window.api.bootstrap()
      setConfig(bootstrap.config)
      setMods(bootstrap.mods)
      // 日志不再进 App state(见 LogView):推送频繁,存这里会带动整个界面重渲染
      // 「启动时恢复上次打开的分类」:记录的分类已不存在(被删/改名)时留在「全部」
      const last = bootstrap.lastCategory
      if (last) {
        const known =
          last === ALL_CATEGORY ||
          last === OTHER_CATEGORY ||
          normalizeCategories(bootstrap.config.categories).includes(last)
        if (known) {
          setCurrentCategory(last)
        }
      }
      if (bootstrap.autoOpenSettings) {
        setSettingsOpen(true)
      }
      if (!bootstrap.initialization.success) {
        toast.error('模组仓库初始化失败', { description: bootstrap.initialization.message })
      }
    })()
  }, [])

  // ============ 分类与计数 ============
  const categories = useMemo(
    () => (config ? normalizeCategories(config.categories) : []),
    [config]
  )
  const orderedNormalCategories = useMemo(
    () => (config ? orderedCategories(categories, config.categoryOrder) : []),
    [config, categories]
  )
  const displayCategories = useMemo(
    () => [ALL_CATEGORY, ...orderedNormalCategories, OTHER_CATEGORY],
    [orderedNormalCategories]
  )
  const counts = useMemo(() => countByCategory(mods, categories), [mods, categories])

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        displayCategories.map(async (category) => {
          if (category === ALL_CATEGORY || category === OTHER_CATEGORY) {
            return [category, null] as const
          }
          return [category, await window.api.getCategoryImage(category)] as const
        })
      )
      setCategoryImages(new Map(entries.map(([category, image]) => [category, image])))
    })()
    void window.api.getAppIcon().then(setAppIcon)
  }, [displayCategories])

  // 分类拖拽排序暂时关闭:侧边栏选中框占用了「按住 + 移动」手势,两者冲突。
  // categoryOrder 数据模型与 setCategoryOrder API 原样保留,恢复排序时重新接线即可
  // (SidebarProps 已无 onReorderCategories)。

  // ============ 模组列表 ============
  const visibleMods = useMemo(() => {
    if (!config) {
      return []
    }
    const filtered = filterAndSort(mods, currentCategory, categories, config.sortOrder)
    if (search.trim().length === 0) {
      return filtered
    }
    const keyword = search.trim().toLowerCase()
    return filtered.filter((mod) => mod.name.toLowerCase().includes(keyword))
  }, [config, mods, currentCategory, categories, search])

  const groupedMods = useMemo(() => {
    if (!config) {
      return []
    }
    const groupable =
      config.sortOrder === 0 || config.sortOrder === 1 || config.sortOrder === 2
    if (!groupable) {
      return null
    }
    return groupBySecondaryName(visibleMods, categories)
  }, [config, visibleMods, categories])

  const installedCount = useMemo(() => mods.filter((mod) => mod.installed).length, [mods])

  // ============ 多选状态维护 ============
  // 镜像「屏幕顺序」:分组模式下屏幕顺序是各组按首现位置拼接(组内保序),
  // 与 visibleMods 的扁平顺序不同;Shift 范围选择和全选必须按屏幕顺序,
  // 否则会选中/漏掉视觉上位于范围之外的卡片
  useEffect(() => {
    displayOrderRef.current = groupedMods
      ? groupedMods.flatMap((group) => group.mods.map((mod) => mod.name))
      : visibleMods.map((mod) => mod.name)
  }, [groupedMods, visibleMods])

  useEffect(() => {
    modsRef.current = mods
  }, [mods])

  // 列表刷新后修剪已不存在的选中项(删除/重命名后选中态自动收敛)
  useEffect(() => {
    setSelectedNames((prev) => {
      if (prev.size === 0) {
        return prev
      }
      const existing = new Set(mods.map((mod) => mod.name))
      const next = new Set([...prev].filter((name) => existing.has(name)))
      return next.size === prev.size ? prev : next
    })
  }, [mods])

  const selectedMods = useMemo(
    () => mods.filter((mod) => selectedNames.has(mod.name)),
    [mods, selectedNames]
  )
  const allVisibleSelected = useMemo(
    () => visibleMods.length > 0 && visibleMods.every((mod) => selectedNames.has(mod.name)),
    [visibleMods, selectedNames]
  )
  const canInstallSelected = selectedMods.some((mod) => !mod.installed)
  const canUninstallSelected = selectedMods.some((mod) => mod.installed)

  // ============ 操作 ============
  const requireConfig = useCallback((): AppConfigData => {
    if (!config) {
      throw new Error('配置尚未加载')
    }
    return config
  }, [config])

  // 传给 memo 化子组件的回调需保持引用稳定
  const handleLaunchGame = useCallback(() => {
    void runOperation('正在启动游戏...', () => window.api.launchGame(), {
      silentSuccess: true
    })
  }, [runOperation])

  const handleToggleLogsView = useCallback(() => {
    setView((prev) => (prev === 'logs' ? 'mods' : 'logs'))
  }, [])

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), [])

  const handleSelectCategory = useCallback((category: string) => {
    setCurrentCategory(category)
    setView('mods')
    setSearch('')
    // 选中集跟随分类视图:切换分类即清空,避免批量操作作用到看不见的模组上
    setSelectedNames(new Set())
    selectionAnchorRef.current = null
    // 记录上次打开的分类,供「启动时恢复」使用(与设置开关无关,始终记录)
    void window.api.setLastCategory(category)
  }, [])

  const handleSortOrderChange = useCallback(
    (sortOrder: SortOrder) => {
      setConfig((prev) => (prev ? { ...prev, sortOrder } : prev))
      void window.api.setSortOrder(sortOrder)
    },
    []
  )

  const handleImportArchives = useCallback(
    async (archivePaths: string[]) => {
      if (archivePaths.length === 0) {
        return
      }
      const results = await withBusy(`正在导入 ${archivePaths.length} 个压缩包...`, () =>
        window.api.importArchives(archivePaths)
      )
      if (!results) {
        return
      }
      await refreshMods()

      const imported = results.filter(
        (item): item is typeof item & { importedName: string } =>
          item.result.success && item.importedName !== undefined
      )
      if (imported.length > 0) {
        setRenameQueue(
          imported.map((item) => ({
            modName: item.importedName,
            defaultName: basenameWithoutExtension(item.archive)
          }))
        )
      }
      const failures = results.filter((item) => !item.result.success)
      if (failures.length > 0) {
        toast.error(`${failures.length} 个压缩包未能导入`, {
          description: failures
            .map((item) => `${basenameWithoutExtension(item.archive)}:${item.result.message}`)
            .join('\n')
        })
      } else {
        reportResult({ success: true, message: `已导入 ${imported.length} 个压缩包` })
      }
    },
    [withBusy, reportResult, refreshMods]
  )

  const handleImportClick = useCallback(async () => {
    const archivePath = await window.api.pickArchive()
    if (archivePath) {
      await handleImportArchives([archivePath])
    }
  }, [handleImportArchives])

  const handleToggleInstall = useCallback(
    (mod: ModInfo) => {
      if (mod.installed) {
        void runOperation(`正在卸载 ${mod.name}...`, () => window.api.uninstallMod(mod.name)).then(
          (result) => {
            if (result) {
              void refreshMods()
            }
          }
        )
        return
      }
      if (mod.invalid) {
        setPendingConfirm({ kind: 'install-invalid', modName: mod.name })
        return
      }
      void runOperation(`正在安装 ${mod.name}...`, () => window.api.installMod(mod.name)).then(
        (result) => {
          if (result) {
            void refreshMods()
          }
        }
      )
    },
    [runOperation, refreshMods]
  )

  const reinstallByName = useCallback(
    (name: string) =>
      runOperation(`正在重装 ${name}...`, async () => {
        const uninstalled = await window.api.uninstallMod(name)
        if (!uninstalled.success) {
          return uninstalled
        }
        return window.api.installMod(name)
      }),
    [runOperation]
  )

  const handleReinstall = useCallback(
    (mod: ModInfo) => {
      if (mod.invalid) {
        setPendingConfirm({ kind: 'reinstall-invalid', modName: mod.name })
        return
      }
      void reinstallByName(mod.name).then((result) => {
        if (result) {
          void refreshMods()
        }
      })
    },
    [reinstallByName, refreshMods]
  )

  const handleInstallAll = useCallback(async () => {
    const list = visibleMods.filter((mod) => !mod.installed && mod.invalid)
    if (list.length > 0) {
      setPendingConfirm({ kind: 'install-all-invalid', modNames: list.map((mod) => mod.name) })
      return
    }
    const result = await runOperation('正在批量安装模组...', () =>
      window.api.installAll(currentCategory)
    )
    if (result) {
      await refreshMods()
    }
  }, [visibleMods, currentCategory, runOperation, refreshMods])

  const handleUninstallAll = useCallback(async () => {
    const result = await runOperation('正在批量卸载模组...', () =>
      window.api.uninstallAll(currentCategory)
    )
    if (result) {
      await refreshMods()
    }
  }, [currentCategory, runOperation, refreshMods])

  // ============ 多选与批量操作 ============
  /** 切换一张卡的选中态;Shift 时从锚点到该卡范围选中(替换现有选中) */
  const handleToggleSelect = useCallback((mod: ModInfo, modifiers: { shiftKey: boolean }) => {
    const names = displayOrderRef.current
    const anchor = selectionAnchorRef.current
    if (modifiers.shiftKey && anchor) {
      const from = names.indexOf(anchor)
      const to = names.indexOf(mod.name)
      if (from >= 0 && to >= 0) {
        setSelectedNames(new Set(names.slice(Math.min(from, to), Math.max(from, to) + 1)))
        return
      }
    }
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(mod.name)) {
        next.delete(mod.name)
      } else {
        next.add(mod.name)
      }
      return next
    })
    selectionAnchorRef.current = mod.name
  }, [])

  const handleSelectAllVisible = useCallback(() => {
    setSelectedNames(new Set(displayOrderRef.current))
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedNames(new Set())
    selectionAnchorRef.current = null
  }, [])

  const runBatch = useCallback(
    async (activity: string, action: BatchModAction, names: string[]) => {
      const result = await runOperation(activity, () => window.api.batchModAction(action, names))
      if (result) {
        await refreshMods()
      }
    },
    [runOperation, refreshMods]
  )

  /** 批量安装/重装:目标含失效模组时先经确认对话框(与「全部安装」同一交互) */
  const handleBatchInstallLike = useCallback(
    (action: 'install' | 'reinstall', names: string[]) => {
      if (names.length === 0) {
        return
      }
      const invalidNames = modsRef.current
        .filter((mod) => names.includes(mod.name) && mod.invalid)
        .map((mod) => mod.name)
      if (invalidNames.length > 0) {
        setPendingConfirm({ kind: 'batch-invalid', action, modNames: names, invalidNames })
        return
      }
      const verb = action === 'reinstall' ? '重新安装' : '安装'
      void runBatch(`正在批量${verb} ${names.length} 个模组...`, action, names)
    },
    [runBatch]
  )

  const handleBatchInstallAction = useCallback(
    () => handleBatchInstallLike('install', [...selectedNames]),
    [handleBatchInstallLike, selectedNames]
  )

  const handleBatchUninstallAction = useCallback(
    () => runBatch(`正在批量卸载 ${selectedNames.size} 个模组...`, 'uninstall', [...selectedNames]),
    [runBatch, selectedNames]
  )

  /** 批量重装只作用于已安装的选中项(与卡片菜单「重新安装」的可用范围一致) */
  const handleBatchReinstallAction = useCallback(() => {
    const names = [...selectedNames].filter(
      (name) => modsRef.current.find((mod) => mod.name === name)?.installed
    )
    handleBatchInstallLike('reinstall', names)
  }, [handleBatchInstallLike, selectedNames])

  const handleBatchRepackageAction = useCallback(
    () => runBatch(`正在批量重新打包 ${selectedNames.size} 个模组...`, 'repackage', [...selectedNames]),
    [runBatch, selectedNames]
  )

  const handleBatchDeleteAction = useCallback(
    () => setPendingConfirm({ kind: 'batch-delete', modNames: [...selectedNames] }),
    [selectedNames]
  )

  const handlePackageMod = useCallback(async () => {
    const result = await runOperation('正在打包模组...', () => window.api.runPackager())
    if (!result) {
      return
    }
    if (!result.success) {
      return
    }
    setPrompt({
      title: '导入已打包模组',
      description: '打包完成。请输入新模组的名称。',
      label: '模组名称：',
      initialValue: '',
      onConfirm: (name) => {
        setPrompt(null)
        if (name.length === 0) {
          toast.info('已取消导入打包模组')
          return
        }
        void runOperation(`正在导入打包模组 ${name}...`, () =>
          window.api.importPackagedMod(name)
        ).then((importResult) => {
          if (importResult) {
            void refreshMods()
          }
        })
      }
    })
  }, [runOperation, refreshMods])

  // 传给 memo 化的 ModListHeader 的稳定回调
  const handleInstallAllAction = useCallback(() => {
    void handleInstallAll()
  }, [handleInstallAll])

  const handleUninstallAllAction = useCallback(() => {
    void handleUninstallAll()
  }, [handleUninstallAll])

  const handleRefreshMods = useCallback(() => {
    void runOperation(
      '正在刷新模组列表...',
      () => refreshMods().then(() => ({ success: true, message: '模组列表已刷新' }))
    )
  }, [runOperation, refreshMods])

  const handleImportAction = useCallback(() => {
    void handleImportClick()
  }, [handleImportClick])

  const handlePackageModAction = useCallback(() => {
    void handlePackageMod()
  }, [handlePackageMod])

  const handleRepackage = useCallback(
    async (mod: ModInfo) => {
      const result = await runOperation(`正在重新打包 ${mod.name}...`, () =>
        window.api.repackageMod(mod.name)
      )
      if (result) {
        await refreshMods()
      }
    },
    [runOperation, refreshMods]
  )

  const modCardActions = useMemo<ModCardActions>(
    () => ({
      onToggleInstall: handleToggleInstall,
      onReinstall: handleReinstall,
      onRename: (mod) => {
        setPrompt({
          title: '重命名模组',
          label: '模组名称：',
          initialValue: mod.name,
          onConfirm: (newName) => {
            setPrompt(null)
            void runOperation(`正在重命名 ${mod.name}...`, () =>
              window.api.renameMod(mod.name, newName)
            ).then((result) => {
              if (result) {
                void refreshMods()
              }
            })
          }
        })
      },
      onRepackage: (mod) => void handleRepackage(mod),
      onAddArchive: (mod) => {
        void (async () => {
          const archivePath = await window.api.pickArchive()
          if (!archivePath) {
            return
          }
          const result = await runOperation(`正在向 ${mod.name} 添加文件...`, () =>
            window.api.addModArchive(mod.name, archivePath)
          )
          if (result) {
            await refreshMods()
          }
        })()
      },
      onReplaceArchive: (mod) => {
        void (async () => {
          const archivePath = await window.api.pickArchive()
          if (!archivePath) {
            return
          }
          const result = await runOperation(`正在更新 ${mod.name}...`, () =>
            window.api.replaceModArchive(mod.name, archivePath)
          )
          if (result) {
            await refreshMods()
          }
        })()
      },
      onToggleInvalid: (mod) => {
        void runOperation(
          mod.invalid ? `正在取消 ${mod.name} 的失效标记...` : `正在标记 ${mod.name} 为失效...`,
          () => window.api.setModInvalid(mod.name, !mod.invalid)
        ).then((result) => {
          if (result) {
            void refreshMods()
          }
        })
      },
      onDelete: (mod) => setPendingConfirm({ kind: 'delete', modName: mod.name }),
      onOpenSource: (mod) => {
        void window.api.openPath(mod.sourcePath)
      },
      onOpenInstall: (mod) => {
        const cfg = requireConfig()
        void window.api.openPath(joinPath(cfg.modsDirectory, mod.name))
      },
      onRenameFile: (mod, relativePath, newFileName) => {
        void runOperation(`正在重命名 ${newFileName}...`, () =>
          window.api.renameModFile(mod.name, relativePath, newFileName)
        ).then(async (result) => {
          if (result) {
            await refreshMods()
          }
        })
      },
      onToggleSelect: handleToggleSelect
    }),
    [handleToggleInstall, handleReinstall, handleRepackage, handleToggleSelect, runOperation, refreshMods, requireConfig]
  )

  // ============ 导入后重命名队列 ============
  const currentRename = renameQueue.length > 0 ? renameQueue[0] : null

  // 多选快捷键让位弹层:任一对话框/确认层打开时不抢 Ctrl+A / Esc
  useEffect(() => {
    modalOpenRef.current =
      settingsOpen || prompt !== null || pendingConfirm !== null || renameQueue.length > 0
  }, [settingsOpen, prompt, pendingConfirm, renameQueue])

  // ============ 多选快捷键 ============
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const inEditable =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (inEditable || modalOpenRef.current) {
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        if (view !== 'mods') {
          return
        }
        event.preventDefault()
        handleSelectAllVisible()
        return
      }
      if (event.key === 'Escape') {
        handleClearSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view, handleSelectAllVisible, handleClearSelection])

  // ============ 快捷键 ============
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const inEditable =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (event.key === 'F11') {
        event.preventDefault()
        setChromeHidden((value) => !value)
        return
      }
      if (event.key === 'ArrowDown' && !inEditable && event.altKey === false && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault()
        void window.api.nextBackground()
        return
      }
      if (event.key === 'F12') {
        event.preventDefault()
        void window.api.toggleBackgroundDebugMode()
        return
      }
      if (event.key === 'F10') {
        event.preventDefault()
        void (async () => {
          const backgroundPath = await window.api.getCurrentBackgroundPath()
          if (!backgroundPath) {
            toast.info('当前没有可打开的背景图')
            return
          }
          await window.api.openPath(backgroundPath)
        })()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ============ 拖放导入 ============
  const isArchiveFile = useCallback((filePath: string) => {
    return /\.(zip|rar|7z)$/i.test(filePath)
  }, [])

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) {
        return
      }
      dragDepthRef.current += 1
      setDragOver(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
      }
    }
    const onDragLeave = () => {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) {
        setDragOver(false)
      }
    }
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      dragDepthRef.current = 0
      setDragOver(false)
      if (busyRef.current) {
        toast.warning('已有操作正在进行中，请稍候')
        return
      }
      const files = Array.from(event.dataTransfer?.files ?? [])
      const archivePaths = files
        .map((file) => window.api.getPathForFile(file))
        .filter((path) => isArchiveFile(path))
      if (archivePaths.length === 0) {
        toast.warning('请拖入 .zip、.rar 或 .7z 压缩包')
        return
      }
      void handleImportArchives(archivePaths)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [busy, handleImportArchives, isArchiveFile])

  // 全局圆角:写入 :root 的 --radius,所有圆角刻度(rounded-* 工具类/滚动条/toast)由它单点派生;
  // 液态玻璃的折射贴图半径经 UICornerRadiusProvider 同步给 vaso(见 liquid-glass.tsx)
  const cornerRadius = settingsPreview?.uiCornerRadius ?? config?.uiCornerRadius ?? UI_CORNER_RADIUS_DEFAULT
  useEffect(() => {
    document.documentElement.style.setProperty('--radius', `${cornerRadius}px`)
  }, [cornerRadius])

  // ============ 渲染 ============
  if (!config) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" aria-label="加载中" />
      </div>
    )
  }

  return (
    <LiquidGlassConfigProvider
      config={settingsPreview?.liquidGlass ?? config.liquidGlass}
      cornerRadius={cornerRadius}
    >
      <TooltipProvider delayDuration={400}>
        <div className="flex h-full">
          <BackgroundLayer masked={!chromeHidden} />
          <GlassWarmup />

          <div
            className={cn(
              'flex h-full min-w-0 flex-1',
              chromeHidden && 'pointer-events-none'
            )}
          >
            <Sidebar
              appIcon={appIcon}
              displayCategories={displayCategories}
              counts={counts}
              currentCategory={currentCategory}
              categoryImages={categoryImages}
              busy={busy}
              view={view}
              uiHidden={chromeHidden}
              onSelectCategory={handleSelectCategory}
              onLaunchGame={handleLaunchGame}
              onOpenLogs={handleToggleLogsView}
              onOpenSettings={handleOpenSettings}
            />

            <main className="relative flex min-w-0 flex-1 flex-col">
              {view === 'mods' ? (
                <>
                  <ModListHeader
                    category={currentCategory}
                    count={visibleMods.length}
                    installedCount={installedCount}
                    search={search}
                    sortOrder={config.sortOrder}
                    busy={busy}
                    uiHidden={chromeHidden}
                    onSearchChange={setSearch}
                    onSortOrderChange={handleSortOrderChange}
                    onInstallAll={handleInstallAllAction}
                    onUninstallAll={handleUninstallAllAction}
                    onRefresh={handleRefreshMods}
                    onImport={handleImportAction}
                    onPackageMod={handlePackageModAction}
                  />

                  {/* key 按视图+分类:卡片列表每次重新出现(启动、切换分类、从日志视图返回)都整体重挂载,
                      卡片的推入入场动画随挂载自然重放;顺带把滚动位置重置回顶部 */}
                  <div
                    key={`cards-${view}:${currentCategory}`}
                    className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden pl-4 pr-1.5 pb-4 [scrollbar-gutter:stable]"
                  >
                    {visibleMods.length === 0 ? (
                      <div
                        className={cn(
                          'flex h-full min-h-40 flex-col items-center justify-center gap-3 text-center transition-opacity duration-300',
                          chromeHidden && 'opacity-0'
                        )}
                      >
                        <LiquidGlass
                          className="glass h-16 w-16 rounded-2xl"
                          contentClassName="flex h-full items-center justify-center"
                          depth={1.5}
                          blur={0.4}
                        >
                          <Blocks className="h-7 w-7 text-muted-foreground" />
                        </LiquidGlass>
                        <div className="text-lg font-medium text-foreground/85">该分类还没有导入模组</div>
                        <div className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                          将 .zip / .rar / .7z 压缩包拖放到窗口的任意位置，或点击右上角「导入」按钮。
                          <br />
                          模组名称需符合「角色名-二级名称」格式才能自动归类。
                        </div>
                      </div>
                    ) : groupedMods ? (
                      groupedMods.map((group) => (
                        <div key={group.secondary} className="space-y-2">
                          <div
                            className={cn(
                              'px-1 pb-1 pt-2 text-sm font-semibold text-foreground/85 text-shadow-soft transition-opacity duration-300',
                              chromeHidden && 'opacity-0'
                            )}
                          >
                            {group.secondary}
                          </div>
                          {group.mods.map((mod) => (
                            <ModCard
                              key={mod.name}
                              mod={mod}
                              actions={modCardActions}
                              disabled={busy}
                              selected={selectedNames.has(mod.name)}
                              selectionActive={selectedNames.size > 0}
                              uiHidden={chromeHidden}
                            />
                          ))}
                        </div>
                      ))
                    ) : (
                      visibleMods.map((mod) => (
                        <ModCard
                          key={mod.name}
                          mod={mod}
                          actions={modCardActions}
                          disabled={busy}
                          selected={selectedNames.has(mod.name)}
                          selectionActive={selectedNames.size > 0}
                          uiHidden={chromeHidden}
                        />
                      ))
                    )}
                  </div>

                  {/* 多选批量操作栏(有选中项时从窗口底边滑出) */}
                  {selectedNames.size > 0 && (
                    <BatchActionBar
                      count={selectedNames.size}
                      allSelected={allVisibleSelected}
                      canInstall={canInstallSelected}
                      canUninstall={canUninstallSelected}
                      busy={busy}
                      uiHidden={chromeHidden}
                      onSelectAll={handleSelectAllVisible}
                      onClear={handleClearSelection}
                      onInstall={handleBatchInstallAction}
                      onUninstall={handleBatchUninstallAction}
                      onReinstall={handleBatchReinstallAction}
                      onRepackage={handleBatchRepackageAction}
                      onDelete={handleBatchDeleteAction}
                    />
                  )}
                </>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-6">
                  {/* 日志数据由 LogView 自管理(拉取/订阅/刷新),不经过 App state */}
                  <LogView uiHidden={chromeHidden} />
                </div>
              )}
            </main>
          </div>

          {/* FPS 计数悬浮(性能诊断):状态栏已移除,改为独立悬浮角标,UI 隐藏时保持可见以便测量 */}
          {config.fpsCounterEnabled && (
            <div className="fixed top-0 left-0 z-30">
              <div className="glass frosted rounded-md px-2 py-1 text-xs select-none tabular-nums text-foreground">
                <FpsCounter />
              </div>
            </div>
          )}

          {/* 拖放导入遮罩:visibility 随 opacity 一起过渡——淡出动画播完才真正隐藏,
              隐藏后 Chromium 跳过整棵渲染,内部的 vaso 玻璃层不再常驻 backdrop-filter 开销 */}
          <div
            className={cn(
              'pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-primary/10 transition-[opacity,visibility] duration-200',
              dragOver && !busy ? 'visible opacity-100' : 'invisible opacity-0'
            )}
          >
            <LiquidGlass
              className="glass-dialog rounded-2xl"
              contentClassName="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 px-16 py-12"
              depth={1.5}
              blur={2.5}
            >
              <Blocks className="h-10 w-10 text-primary" />
              <div className="text-lg font-semibold text-foreground">松开以导入模组</div>
              <div className="text-xs text-muted-foreground">支持 .zip / .rar / .7z 压缩包</div>
            </LiquidGlass>
          </div>

          {/* 双击背景恢复 UI */}
          {chromeHidden && (
            <div
              className="fixed inset-0 z-0"
              onDoubleClick={() => setChromeHidden(false)}
              title="双击恢复界面"
            />
          )}

          {/* 设置对话框 */}
          <SettingsDialog
            open={settingsOpen}
            config={config}
            onOpenChange={setSettingsOpen}
            onPreview={setSettingsPreview}
            onSaved={(next, modsDirectoryChanged) => {
              setConfig(next)
              if (modsDirectoryChanged) {
                void refreshMods()
              }
            }}
          />

          {/* 通用输入对话框(重命名/打包命名) */}
          <PromptDialog
            open={prompt !== null}
            title={prompt?.title ?? ''}
            description={prompt?.description}
            label={prompt?.label ?? ''}
            initialValue={prompt?.initialValue ?? ''}
            onCancel={() => setPrompt(null)}
            onConfirm={(value) => prompt?.onConfirm(value)}
          />

          {/* 导入后逐个重命名 */}
          <PromptDialog
            open={currentRename !== null}
            title="重命名模组"
            description="模组名称需符合「角色名-二级名称」格式才能自动归类到对应分类。"
            label="模组名称："
            initialValue={currentRename?.defaultName ?? ''}
            onCancel={() => setRenameQueue((prev) => prev.slice(1))}
            onConfirm={(newName) => {
              const item = currentRename
              setRenameQueue((prev) => prev.slice(1))
              if (!item) {
                return
              }
              if (newName.length === 0 || newName === item.modName) {
                return
              }
              void runOperation(`正在重命名 ${item.modName}...`, () =>
                window.api.renameMod(item.modName, newName)
              ).then((result) => {
                if (result) {
                  void refreshMods()
                }
              })
            }}
          />

          {/* 确认对话框 */}
          <AlertDialog open={pendingConfirm !== null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
            <AlertDialogContent>
              {pendingConfirm?.kind === 'delete' && (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>删除模组</AlertDialogTitle>
                    <AlertDialogDescription>{`将永久删除“${pendingConfirm.modName}”的备份文件及已安装的模组文件。此操作无法撤销。`}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => {
                        const modName = pendingConfirm.modName
                        setPendingConfirm(null)
                        void runOperation(`正在删除 ${modName}...`, () =>
                          window.api.removeMod(modName)
                        ).then((result) => {
                          if (result) {
                            void refreshMods()
                          }
                        })
                      }}
                    >
                      删除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              )}
              {(pendingConfirm?.kind === 'install-invalid' || pendingConfirm?.kind === 'reinstall-invalid') && (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{pendingConfirm.kind === 'reinstall-invalid' ? '重装失效模组' : '安装失效模组'}</AlertDialogTitle>
                    <AlertDialogDescription>{`“${pendingConfirm.modName}”已标记为失效，可能无法正常工作。是否仍要${pendingConfirm.kind === 'reinstall-invalid' ? '重装' : '安装'}？`}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        const modName = pendingConfirm.modName
                        const reinstall = pendingConfirm.kind === 'reinstall-invalid'
                        setPendingConfirm(null)
                        void (reinstall ? reinstallByName(modName) : runOperation(`正在安装 ${modName}...`, () => window.api.installMod(modName))).then(
                          (result) => {
                            if (result) {
                              void refreshMods()
                            }
                          }
                        )
                      }}
                    >
                      {pendingConfirm.kind === 'reinstall-invalid' ? '仍要重装' : '仍要安装'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              )}
              {pendingConfirm?.kind === 'install-all-invalid' && (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>安装失效模组</AlertDialogTitle>
                    <AlertDialogDescription>{`当前操作包含 ${pendingConfirm.modNames.length} 个已标记为失效的模组：\n${pendingConfirm.modNames.join('\n')}\n可能无法正常工作，是否仍要继续？`}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setPendingConfirm(null)
                        void runOperation('正在批量安装模组...', () =>
                          window.api.installAll(currentCategory)
                        ).then((result) => {
                          if (result) {
                            void refreshMods()
                          }
                        })
                      }}
                    >
                      仍要继续
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              )}
              {pendingConfirm?.kind === 'batch-delete' && (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>删除模组</AlertDialogTitle>
                    <AlertDialogDescription>{`将永久删除选中的 ${pendingConfirm.modNames.length} 个模组的备份文件及已安装的模组文件：\n${pendingConfirm.modNames.join('\n')}\n此操作无法撤销。`}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => {
                        const modNames = pendingConfirm.modNames
                        setPendingConfirm(null)
                        void runBatch(`正在批量删除 ${modNames.length} 个模组...`, 'remove', modNames)
                      }}
                    >
                      删除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              )}
              {pendingConfirm?.kind === 'batch-invalid' && (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {pendingConfirm.action === 'reinstall' ? '重装失效模组' : '安装失效模组'}
                    </AlertDialogTitle>
                    <AlertDialogDescription>{`当前操作包含 ${pendingConfirm.invalidNames.length} 个已标记为失效的模组：\n${pendingConfirm.invalidNames.join('\n')}\n可能无法正常工作，是否仍要继续？`}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        const { action, modNames } = pendingConfirm
                        setPendingConfirm(null)
                        const verb = action === 'reinstall' ? '重新安装' : '安装'
                        void runBatch(`正在批量${verb} ${modNames.length} 个模组...`, action, modNames)
                      }}
                    >
                      仍要继续
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              )}
            </AlertDialogContent>
          </AlertDialog>

          <Toaster />
        </div>
      </TooltipProvider>
    </LiquidGlassConfigProvider>
  )
}

/**
 * 启动空闲期空跑一次玻璃渲染管线。前几次打开菜单/对话框的明显卡顿来自
 * backdrop 滤镜管线编译、大尺寸 backdrop 纹理分配,以及 vaso 位移图首次生成
 * (canvas 绘制 + data URL 解码进 SVG 滤镜);这里用几乎不可见的同款面板把
 * 成本提前挪到启动空闲期。预热要完整走一遍「打开 → 关闭」周期:
 * 关闭时的 backdrop-filter 半径过渡是逐帧重新过滤,首跑编译最贵。
 */
function GlassWarmup() {
  const [phase, setPhase] = useState<'waiting' | 'warming' | 'closing' | 'done'>('waiting')

  useEffect(() => {
    let closeTimer: number | undefined
    let doneTimer: number | undefined
    const idleId = window.requestIdleCallback(
      () => {
        setPhase('warming')
        closeTimer = window.setTimeout(() => setPhase('closing'), 150)
        doneTimer = window.setTimeout(() => setPhase('done'), 550)
      },
      { timeout: 4000 }
    )
    return () => {
      window.cancelIdleCallback(idleId)
      window.clearTimeout(closeTimer)
      window.clearTimeout(doneTimer)
    }
  }, [])

  if (phase === 'done') {
    return null
  }
  return (
    <div
      aria-hidden
      data-state={phase === 'closing' ? 'closed' : 'open'}
      className="pointer-events-none fixed inset-0 z-[-5] opacity-[0.02]"
    >
      {/* 对话框同款毛玻璃面板,按真实对话框尺寸预热大纹理路径(弹出菜单也是同款面板) */}
      <div className="glass-dialog frosted ui-fade-popover shadow-card absolute left-8 top-8 h-[24rem] w-[36rem] rounded-xl">
        <div className="p-6">
          <span className="text-xs">warmup</span>
        </div>
      </div>
      {/* 拖放遮罩同款液态玻璃 */}
      <LiquidGlass
        depth={1.5}
        blur={2.5}
        className="glass-dialog ui-fade-popover absolute left-8 top-[28rem] h-32 w-64 rounded-2xl"
        contentClassName="p-1"
      >
        <span className="text-xs">warmup</span>
      </LiquidGlass>
    </div>
  )
}
