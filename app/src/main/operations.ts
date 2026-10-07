import type { ModInfo, OperationResult } from '../shared/types'
import { ALL_CATEGORY } from '../shared/types'
import { categoryForMod, secondaryNameForMod } from '../shared/mod-list-logic'
import * as repository from './repository'
import { getAppConfig } from './config'

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
    const uninstalled = await repository.uninstall(installedMod)
    if (!uninstalled.success) {
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
      failures.push(`${mod.name}:${result.message}`)
    }
  }

  const summary = `已${action} ${changedCount} 个模组`
  return {
    result: failures.length === 0
      ? { success: true, message: summary }
      : { success: false, message: `${summary}\n${failures.join('\n')}` }
  }
}
