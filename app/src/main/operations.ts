import type { BatchModAction, ModInfo, OperationResult } from '../shared/types'
import { ALL_CATEGORY } from '../shared/types'
import { categoryForMod, secondaryNameForMod } from '../shared/mod-list-logic'
import * as repository from './repository'
import { getAppConfig } from './config'
import { logger } from './logger'

export type ProgressReporter = (message: string) => void

/**
 * 同一角色下同一二级名称分组只能安装一个模组,
 * 安装前自动卸载同组已安装模组(exempt 名单中的分组除外)。
 */
export async function installModExclusively(
  mod: ModInfo,
  categories: string[],
  exemptGroups: string[],
  reportProgress: ProgressReporter
): Promise<OperationResult> {
  const categoryName = categoryForMod(mod, categories)
  const secondaryName = secondaryNameForMod(mod, categories)
  if (secondaryName.length === 0 || exemptGroups.includes(secondaryName)) {
    return repository.install(mod)
  }

  const installedMods = await repository.scan()
  for (const installedMod of installedMods) {
    if (
      !installedMod.installed ||
      installedMod.name === mod.name ||
      categoryForMod(installedMod, categories) !== categoryName ||
      secondaryNameForMod(installedMod, categories) !== secondaryName
    ) {
      continue
    }

    reportProgress(`正在卸载同组模组 ${installedMod.name}...`)
    logger.info(
      `独占安装：自动卸载同组模组 ${installedMod.name}（与 ${mod.name} 同属「${secondaryName}」组）`
    )
    const uninstalled = await repository.uninstall(installedMod)
    if (!uninstalled.success) {
      logger.error(`独占安装失败：无法自动卸载同组模组 ${installedMod.name}：${uninstalled.message}`)
      return {
        success: false,
        message: `无法自动卸载同组模组 ${installedMod.name}:${uninstalled.message}`
      }
    }
  }

  reportProgress(`正在安装 ${mod.name}...`)
  return repository.install(mod)
}

export interface BulkResult {
  result: OperationResult
}

/** 全部安装/全部卸载指定分类中的模组(按当前分类过滤)。 */
export async function changeInstallationForAll(
  install: boolean,
  category: string,
  categories: string[],
  reportProgress: ProgressReporter
): Promise<BulkResult> {
  const action = install ? '安装' : '卸载'
  const allMods = await repository.scan()
  const exemptGroups = getAppConfig().exclusiveInstallExemptGroups
  const pending = allMods.filter(
    (mod) =>
      mod.installed !== install &&
      (category === ALL_CATEGORY || categoryForMod(mod, categories) === category)
  )

  const failures: string[] = []
  let changedCount = 0
  let index = 0
  for (const mod of pending) {
    index += 1
    reportProgress(`正在${action} ${mod.name}(${index}/${pending.length})...`)
    const result = install
      ? await installModExclusively(mod, categories, exemptGroups, reportProgress)
      : await repository.uninstall(mod)
    if (result.success) {
      changedCount += 1
    } else {
      logger.error(`批量${action}失败：${mod.name}：${result.message}`)
      failures.push(`${mod.name}:${result.message}`)
    }
  }

  const summary = `已${action} ${changedCount} 个模组`
  logger.info(
    `批量${action}完成：成功 ${changedCount} 个，失败 ${failures.length} 个（分类：${category}）`
  )
  return {
    result: failures.length === 0
      ? { success: true, message: summary }
      : { success: false, message: `${summary}\n${failures.join('\n')}` }
  }
}

const BATCH_ACTION_LABEL: Record<BatchModAction, string> = {
  install: '安装',
  uninstall: '卸载',
  remove: '删除',
  markInvalid: '标记失效',
  unmarkInvalid: '取消失效标记',
  reinstall: '重新安装',
  repackage: '重新打包'
}

/** 对指定的模组名称列表逐个执行同一操作(多选批量操作入口)。 */
export async function runBatchModAction(
  action: BatchModAction,
  names: string[],
  reportProgress: ProgressReporter
): Promise<BulkResult> {
  const label = BATCH_ACTION_LABEL[action]
  const config = getAppConfig()
  // 一次扫描建立名称索引;删除模组 A 不影响模组 B 的信息,中途不重扫
  const byName = new Map((await repository.scan()).map((mod) => [mod.name, mod]))

  const failures: string[] = []
  let changedCount = 0
  for (const [index, name] of names.entries()) {
    const mod = byName.get(name)
    if (!mod) {
      logger.error(`批量${label}找不到模组：${name}（可能已被删除或重命名）`)
      failures.push(`${name}:找不到模组`)
      continue
    }
    reportProgress(`正在${label} ${name}(${index + 1}/${names.length})...`)
    let result: OperationResult
    switch (action) {
      case 'install':
        result = await installModExclusively(
          mod,
          config.categories,
          config.exclusiveInstallExemptGroups,
          reportProgress
        )
        break
      case 'uninstall':
        result = await repository.uninstall(mod)
        break
      case 'remove':
        result = await repository.remove(mod)
        break
      case 'markInvalid': {
        // 与单模组标记失效一致:已安装的先卸载再标记
        if (mod.installed) {
          reportProgress(`正在卸载失效模组 ${name}...`)
          const uninstalled = await repository.uninstall(mod)
          if (!uninstalled.success) {
            result = uninstalled
            break
          }
        }
        result = await repository.setInvalid(mod, true)
        break
      }
      case 'unmarkInvalid':
        result = await repository.setInvalid(mod, false)
        break
      case 'reinstall': {
        // 与单模组重装一致:先卸载再普通安装(组位由自身卸载让出,不走独占卸载)
        if (!mod.installed) {
          failures.push(`${name}:未安装,无法重新安装`)
          continue
        }
        reportProgress(`正在卸载 ${name}...`)
        const uninstalled = await repository.uninstall(mod)
        result = uninstalled.success ? await repository.install(mod) : uninstalled
        break
      }
      case 'repackage':
        // 重新打包需要逐个弹源文件夹选择框,在 ipc.ts 里单独实现批量分支,不应到达这里
        result = { success: false, message: '批量重新打包通道错误' }
        break
    }
    if (result.success) {
      changedCount += 1
    } else {
      logger.error(`批量${label}失败：${name}：${result.message}`)
      failures.push(`${name}:${result.message}`)
    }
  }

  const summary = `已${label} ${changedCount} 个模组`
  logger.info(`批量${label}完成：成功 ${changedCount} 个，失败 ${failures.length} 个`)
  return {
    result: failures.length === 0
      ? { success: true, message: summary }
      : { success: false, message: `${summary}\n${failures.join('\n')}` }
  }
}
