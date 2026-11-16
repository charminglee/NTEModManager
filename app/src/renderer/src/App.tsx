import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/toast-card'
import { Blocks, LoaderCircle, Package } from 'lucide-react'
import {
  ALL_CATEGORY,
  OTHER_CATEGORY,
  type AppConfigData,
  type BatchModAction,
  type ModInfo,
  type OperationResult,
  SortOrder
} from '@shared/types'
import {
  categoryForMod,
  countByCategory,
  filterAndSort,
  groupBySecondaryName,
  normalizeCategories,
  orderedCategories
} from '@shared/mod-list-logic'
import { basenameWithoutExtension, joinPath } from '@/lib/format'
import BackgroundLayer from '@/components/background-layer'
import MotionPresence from '@/components/motion-presence'
import { useModListMotion } from '@/hooks/use-mod-list-motion'
import Sidebar from '@/components/sidebar'
import ModListHeader, { type StatusFilter } from '@/components/mod-list-header'
import AppHeader, { type AppView } from '@/components/app-header'
import WindowControls from '@/components/window-controls'
import ModDetail from '@/components/mod-detail'
import { Button } from '@/components/ui/button'
import ModCard, { type ModCardActions } from '@/components/mod-card'
import BatchActionBar from '@/components/batch-action-bar'
import LogView from '@/components/log-view'
import FpsCounter from '@/components/fps-counter'
import PromptDialog from '@/components/prompt-dialog'
import ImportDialog, { type ImportSession } from '@/components/import-dialog'
import SettingsView from '@/components/settings-view'
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
  const [view, setView] = useState<AppView>('mods')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [chromeHidden, setChromeHidden] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [pendingView, setPendingView] = useState<AppView | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [focusedName, setFocusedName] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [activity, setActivity] = useState('')
  const [importSession, setImportSession] = useState<ImportSession | null>(null)
  const [categoryImages, setCategoryImages] = useState<Map<string, string | null>>(new Map())
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
  const modListRef = useRef<HTMLDivElement>(null)
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
      setActivity(_activity)
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
        setActivity('')
      }
    },
    []
  )

  const reportResult = useCallback(
    (result: OperationResult, options?: { silentSuccess?: boolean }) => {
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
    },
    []
  )

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
        setView('settings')
      }
      if (!bootstrap.initialization.success) {
        toast.error('模组仓库初始化失败', { description: bootstrap.initialization.message })
      }
    })()
  }, [])

  // ============ 分类与计数 ============
  const categories = useMemo(() => (config ? normalizeCategories(config.categories) : []), [config])
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
  }, [displayCategories])

  // ============ 模组列表 ============
  const matchingMods = useMemo(() => {
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

  const statusCounts = useMemo(
    () => ({
      all: matchingMods.length,
      installed: matchingMods.filter((mod) => mod.installed).length,
      uninstalled: matchingMods.filter((mod) => !mod.installed && !mod.invalid).length,
      invalid: matchingMods.filter((mod) => mod.invalid).length
    }),
    [matchingMods]
  )
  const visibleMods = useMemo(
    () =>
      matchingMods.filter(
        (mod) =>
          statusFilter === 'all' ||
          (statusFilter === 'installed' && mod.installed) ||
          (statusFilter === 'uninstalled' && !mod.installed && !mod.invalid) ||
          (statusFilter === 'invalid' && mod.invalid)
      ),
    [matchingMods, statusFilter]
  )
  useModListMotion(modListRef, visibleMods, currentCategory, view)
  const focusedMod = detailsOpen
    ? (visibleMods.find((mod) => mod.name === focusedName) ?? visibleMods[0] ?? null)
    : null
  const activateMod = useCallback((name: string) => {
    setFocusedName(name)
    setDetailsOpen(true)
  }, [])
  const requestView = useCallback(
    (next: AppView) => {
      if (view === 'settings' && settingsDirty && next !== view) setPendingView(next)
      else setView(next)
    },
    [view, settingsDirty]
  )
  useEffect(() => window.api.onProgress(setActivity), [])

  const groupedMods = useMemo(() => {
    if (!config) {
      return []
    }
    const groupable = config.sortOrder === 0 || config.sortOrder === 1 || config.sortOrder === 2
    if (!groupable) {
      return null
    }
    return groupBySecondaryName(visibleMods, categories)
  }, [config, visibleMods, categories])

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

  const handleSelectCategory = useCallback((category: string) => {
    setCurrentCategory(category)
    setStatusFilter('all')
    setFocusedName(null)
    setDetailsOpen(true)
    setView('mods')
    setSearch('')
    // 选中集跟随分类视图:切换分类即清空,避免批量操作作用到看不见的模组上
    setSelectedNames(new Set())
    selectionAnchorRef.current = null
    // 记录上次打开的分类,供「启动时恢复」使用(与设置开关无关,始终记录)
    void window.api.setLastCategory(category)
  }, [])

  const handleSortOrderChange = useCallback((sortOrder: SortOrder) => {
    setConfig((prev) => (prev ? { ...prev, sortOrder } : prev))
    void window.api.setSortOrder(sortOrder)
  }, [])

  const handleImportArchives = useCallback(
    async (archivePaths: string[]) => {
      if (!archivePaths.length || busyRef.current) return
      setImportSession({ archives: archivePaths, results: [] })
      const results = await withBusy(`正在导入 ${archivePaths.length} 个压缩包…`, () =>
        window.api.importArchives(archivePaths)
      )
      const completed =
        results ??
        archivePaths.map((archive) => ({
          archive,
          result: { success: false, message: '导入操作未完成，请查看运行日志。' }
        }))
      setImportSession({ archives: archivePaths, results: completed })
      void refreshMods().catch((error) =>
        toast.error('刷新模组列表失败', { description: String(error) })
      )
    },
    [withBusy, refreshMods]
  )
  const closeImport = () => {
    if (busyRef.current) return
    setRenameQueue(
      (importSession?.results ?? []).flatMap((item) =>
        item.result.success && item.importedName
          ? [{ modName: item.importedName, defaultName: basenameWithoutExtension(item.archive) }]
          : []
      )
    )
    setImportSession(null)
  }
  const retryImport = async (archive: string) => {
    if (busyRef.current) return
    setImportSession((previous) =>
      previous
        ? { ...previous, results: previous.results.filter((item) => item.archive !== archive) }
        : previous
    )
    const results = await withBusy('正在重试导入…', () => window.api.importArchives([archive]))
    setImportSession((previous) =>
      previous
        ? {
            ...previous,
            results: [
              ...previous.results,
              ...(results ?? [
                { archive, result: { success: false, message: '导入操作未完成，请查看运行日志。' } }
              ])
            ]
          }
        : previous
    )
    void refreshMods().catch((error) =>
      toast.error('刷新模组列表失败', { description: String(error) })
    )
  }

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
    () =>
      runBatch(`正在批量重新打包 ${selectedNames.size} 个模组...`, 'repackage', [...selectedNames]),
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

  const handleRefreshMods = useCallback(() => {
    void runOperation('正在刷新模组列表...', () =>
      refreshMods().then(() => ({ success: true, message: '模组列表已刷新' }))
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
      onToggleSubMod: (mod, childName, enabled) => {
        void runOperation(`正在更新子模组：${childName}…`, () =>
          window.api.setSubModEnabled(mod.name, childName, enabled)
        ).then(() => refreshMods())
      },
      onRenameSubMod: (mod, childName) => {
        setPrompt({
          title: '重命名子模组',
          label: '子模组名称：',
          initialValue: childName,
          onConfirm: (newName) => {
            setPrompt(null)
            void runOperation(`正在重命名子模组 ${childName}...`, () =>
              window.api.renameSubMod(mod.name, childName, newName)
            ).then((result) => {
              if (result) {
                void refreshMods()
              }
            })
          }
        })
      },
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
    [
      handleToggleInstall,
      handleReinstall,
      handleRepackage,
      handleToggleSelect,
      runOperation,
      refreshMods,
      requireConfig
    ]
  )

  // ============ 导入后重命名队列 ============
  const currentRename = renameQueue.length > 0 ? renameQueue[0] : null

  // 多选快捷键让位弹层:任一对话框/确认层打开时不抢 Ctrl+A / Esc
  useEffect(() => {
    modalOpenRef.current =
      view === 'settings' ||
      importSession !== null ||
      pendingView !== null ||
      prompt !== null ||
      pendingConfirm !== null ||
      renameQueue.length > 0
  }, [view, importSession, pendingView, prompt, pendingConfirm, renameQueue])

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

      // F9 隐藏/恢复界面;F11 不做拦截,交给 Chrome/Electron 原生全屏
      if (event.key === 'F9') {
        event.preventDefault()
        setChromeHidden((value) => !value)
        return
      }
      if (
        event.key === 'ArrowDown' &&
        !inEditable &&
        event.altKey === false &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
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

  // ============ 渲染 ============
  if (!config) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <WindowControls />
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" aria-label="加载中" />
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={350}>
      <WindowControls />
      <BackgroundLayer masked={!chromeHidden} maskOpacity={config.backgroundMaskOpacity} />
      <div className={cn('app-shell', chromeHidden && 'is-ui-hidden')}>
        <AppHeader
          view={view}
          busy={busy}
          activity={activity}
          hasGamePath={Boolean(config.gameDirectory)}
          onNavigate={requestView}
          onLaunch={handleLaunchGame}
          onImport={handleImportAction}
          onPackageMod={handlePackageModAction}
        />
        {view === 'mods' ? (
          <div className="mod-workspace">
            <Sidebar
              displayCategories={displayCategories}
              counts={counts}
              currentCategory={currentCategory}
              categoryImages={categoryImages}
              onSelectCategory={handleSelectCategory}
            />
            <main className="mod-library">
              <ModListHeader
                category={currentCategory}
                counts={statusCounts}
                search={search}
                sortOrder={config.sortOrder}
                status={statusFilter}
                busy={busy}
                onSearchChange={setSearch}
                onSortOrderChange={handleSortOrderChange}
                onStatusChange={(value) => {
                  setStatusFilter(value)
                  handleClearSelection()
                }}
                onRefresh={handleRefreshMods}
                onInstallAll={() => void handleInstallAll()}
                onUninstallAll={() => void handleUninstallAll()}
              />
              <div
                ref={modListRef}
                key={`${currentCategory}:${statusFilter}`}
                className={cn('mod-list-scroll', selectedNames.size > 0 && 'has-batch-actions')}
              >
                {visibleMods.length === 0 ? (
                  <div className="library-empty">
                    <Blocks size={42} />
                    <h2>
                      {search || statusFilter !== 'all' ? '没有匹配的模组' : '该分类还没有模组'}
                    </h2>
                    <p>
                      {search || statusFilter !== 'all'
                        ? '试试其他搜索词，或清空筛选条件。'
                        : '导入压缩包，开始整理你的异环模组。'}
                    </p>
                    {search || statusFilter !== 'all' ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSearch('')
                          setStatusFilter('all')
                        }}
                      >
                        清空筛选
                      </Button>
                    ) : (
                      <Button onClick={handleImportAction} disabled={busy}>
                        导入模组
                      </Button>
                    )}
                  </div>
                ) : (
                  (groupedMods ?? [{ secondary: '模组', mods: visibleMods }]).map((group) => (
                    <section className="mod-group" key={group.secondary}>
                      <div className="mod-group-heading">
                        <h2>{group.secondary || '其他模组'}</h2>
                      </div>
                      <div className="mod-group-rows">
                        {group.mods.map((mod) => (
                          <ModCard
                            key={mod.name}
                            mod={mod}
                            actions={modCardActions}
                            disabled={busy}
                            selected={selectedNames.has(mod.name)}
                            active={focusedMod?.name === mod.name}
                            displayName={
                              currentCategory !== ALL_CATEGORY &&
                              mod.name.startsWith(currentCategory + '-')
                                ? mod.name.slice(currentCategory.length + 1)
                                : mod.name
                            }
                            onActivate={activateMod}
                          />
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </div>
              <button
                type="button"
                className="import-drop-hint"
                disabled={busy}
                onClick={handleImportAction}
              >
                <Package size={24} />
                <span>拖入 ZIP、RAR、7Z 压缩包以导入</span>
              </button>
              <MotionPresence present={selectedNames.size > 0}>
                {selectedNames.size > 0 ? (
                  <BatchActionBar
                    count={selectedNames.size}
                    allSelected={allVisibleSelected}
                    canInstall={canInstallSelected}
                    canUninstall={canUninstallSelected}
                    busy={busy}
                    onSelectAll={handleSelectAllVisible}
                    onClear={handleClearSelection}
                    onInstall={handleBatchInstallAction}
                    onUninstall={handleBatchUninstallAction}
                    onReinstall={handleBatchReinstallAction}
                    onRepackage={handleBatchRepackageAction}
                    onMarkInvalid={() =>
                      void runBatch('正在批量标记失效…', 'markInvalid', [...selectedNames])
                    }
                    onUnmarkInvalid={() =>
                      void runBatch('正在取消失效标记…', 'unmarkInvalid', [...selectedNames])
                    }
                    onDelete={handleBatchDeleteAction}
                  />
                ) : null}
              </MotionPresence>
            </main>
            <MotionPresence present={focusedMod !== null}>
              {focusedMod ? (
                <ModDetail
                  key={focusedMod.name}
                  mod={focusedMod}
                  category={categoryForMod(focusedMod, categories)}
                  busy={busy}
                  actions={modCardActions}
                  onClose={() => setDetailsOpen(false)}
                />
              ) : null}
            </MotionPresence>
          </div>
        ) : view === 'logs' ? (
          <LogView />
        ) : (
          <SettingsView
            config={config}
            onDirtyChange={setSettingsDirty}
            onCancel={() => requestView('mods')}
            onSaved={(next, shouldRefresh) => {
              setConfig(next)
              if (shouldRefresh) void refreshMods()
            }}
          />
        )}
      </div>
      {config.fpsCounterEnabled && (
        <div className="fps-counter">
          <FpsCounter />
        </div>
      )}
      <MotionPresence present={dragOver && !busy}>
        {dragOver && !busy ? (
          <div className="import-drag-overlay">
            <div>
              <Package size={42} />
              <h2>松开以导入模组</h2>
              <p>支持 ZIP、RAR、7Z 压缩包</p>
            </div>
          </div>
        ) : null}
      </MotionPresence>
      {chromeHidden && (
        <div
          className="fixed inset-0 z-0"
          onDoubleClick={() => setChromeHidden(false)}
          title="双击恢复界面"
        />
      )}
      <ImportDialog
        session={importSession}
        busy={busy}
        activity={activity}
        onClose={closeImport}
        onRetry={(path) => void retryImport(path)}
      />
      <AlertDialog
        open={pendingView !== null}
        onOpenChange={(open) => {
          if (!open) setPendingView(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃尚未保存的设置？</AlertDialogTitle>
            <AlertDialogDescription>离开此页面会丢弃尚未保存的更改。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingView) setView(pendingView)
                setPendingView(null)
                setSettingsDirty(false)
              }}
            >
              放弃更改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      <AlertDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => !open && setPendingConfirm(null)}
      >
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
          {(pendingConfirm?.kind === 'install-invalid' ||
            pendingConfirm?.kind === 'reinstall-invalid') && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {pendingConfirm.kind === 'reinstall-invalid' ? '重装失效模组' : '安装失效模组'}
                </AlertDialogTitle>
                <AlertDialogDescription>{`“${pendingConfirm.modName}”已标记为失效，可能无法正常工作。是否仍要${pendingConfirm.kind === 'reinstall-invalid' ? '重装' : '安装'}？`}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const modName = pendingConfirm.modName
                    const reinstall = pendingConfirm.kind === 'reinstall-invalid'
                    setPendingConfirm(null)
                    void (
                      reinstall
                        ? reinstallByName(modName)
                        : runOperation(`正在安装 ${modName}...`, () =>
                            window.api.installMod(modName)
                          )
                    ).then((result) => {
                      if (result) {
                        void refreshMods()
                      }
                    })
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
    </TooltipProvider>
  )
}
