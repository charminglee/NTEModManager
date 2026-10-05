import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Blocks, LoaderCircle } from 'lucide-react'
import {
  ALL_CATEGORY,
  OTHER_CATEGORY,
  type AppConfigData,
  type LogEntry,
  type ModInfo,
  type OperationResult,
  type SortOrder
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
import StatusBar from '@/components/status-bar'
import LogView from '@/components/log-view'
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
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

type PendingConfirm =
  | { kind: 'delete'; modName: string }
  | { kind: 'install-invalid'; modName: string }
  | { kind: 'reinstall-invalid'; modName: string }
  | { kind: 'install-all-invalid'; modNames: string[] }
  | null

interface RenameQueueItem {
  modName: string
  defaultName: string
}

export default function App() {
  const [config, setConfig] = useState<AppConfigData | null>(null)
  const [mods, setMods] = useState<ModInfo[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [currentCategory, setCurrentCategory] = useState<string>(ALL_CATEGORY)
  const [view, setView] = useState<'mods' | 'logs'>('mods')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [chromeHidden, setChromeHidden] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
      setLogs(bootstrap.logs)
      if (bootstrap.autoOpenSettings) {
        setSettingsOpen(true)
      }
      if (!bootstrap.initialization.success) {
        toast.error('模组仓库初始化失败', { description: bootstrap.initialization.message })
      }
    })()
  }, [])

  useEffect(() => {
    return window.api.onLogEntry((entry) => {
      setLogs((prev) => [...prev.slice(-4000), entry])
    })
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

  const handleReorderCategories = useCallback((order: string[]) => {
    setConfig((prev) => (prev ? { ...prev, categoryOrder: order } : prev))
    void window.api.setCategoryOrder(order)
  }, [])

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
      }
    }),
    [handleToggleInstall, handleReinstall, handleRepackage, runOperation, refreshMods, requireConfig]
  )

  // ============ 导入后重命名队列 ============
  const currentRename = renameQueue.length > 0 ? renameQueue[0] : null

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

  // ============ 渲染 ============
  if (!config) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" aria-label="加载中" />
      </div>
    )
  }

  return (
    <LiquidGlassConfigProvider config={config.liquidGlass}>
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
              onReorderCategories={handleReorderCategories}
              onLaunchGame={handleLaunchGame}
              onOpenLogs={handleToggleLogsView}
              onOpenSettings={handleOpenSettings}
            />

            <main className="flex min-w-0 flex-1 flex-col">
              {view === 'mods' ? (
                <>
                  <ModListHeader
                    category={currentCategory}
                    count={visibleMods.length}
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
                    className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-8 pb-4"
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
                          uiHidden={chromeHidden}
                        />
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-6">
                  <div
                    className={cn(
                      'flex items-center gap-3 px-4 pb-4 transition-opacity duration-300',
                      chromeHidden && 'opacity-0'
                    )}
                  >
                    <h1 className="text-2xl font-bold tracking-wide text-foreground text-shadow-soft">
                      运行日志
                    </h1>
                    <span className="text-xs text-muted-foreground">{logs.length} 条</span>
                    <Button variant="glass" size="sm" className="ml-auto" onClick={() => {
                      void window.api.getLogEntries().then(setLogs)
                    }}>
                      刷新
                    </Button>
                  </div>
                  <LogView logs={logs} uiHidden={chromeHidden} />
                </div>
              )}

              <StatusBar
                totalMods={mods.length}
                installedMods={installedCount}
                fpsVisible={config?.fpsCounterEnabled ?? false}
                uiHidden={chromeHidden}
              />
            </main>
          </div>

          {/* 拖放导入遮罩 */}
          <div
            className={cn(
              'pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-primary/10 transition-opacity duration-200',
              dragOver && busy ? 'opacity-0' : dragOver ? 'opacity-100' : 'opacity-0'
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
