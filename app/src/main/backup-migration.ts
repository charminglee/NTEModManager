import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmdirSync } from 'node:fs'
import { cp, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { describeError, logger } from './logger'

function resolveDirectory(path: string): string {
  if (lstatSync(path, { throwIfNoEntry: false })) return realpathSync(path)
  const parent = dirname(path)
  return parent === path ? path : join(resolveDirectory(parent), basename(path))
}

function contains(parent: string, path: string): boolean {
  const difference = relative(parent.toLowerCase(), path.toLowerCase())
  return !isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`)
}

export async function migrateBackups(
  oldDirectory: string,
  newDirectory: string,
  configPath: string,
  saveConfig: () => void
): Promise<void> {
  if (oldDirectory === newDirectory) {
    saveConfig()
    return
  }
  const source = resolveDirectory(resolve(oldDirectory))
  const target = resolveDirectory(resolve(newDirectory))
  if (source.toLowerCase() === target.toLowerCase()) {
    saveConfig()
    return
  }
  if (contains(source, target) || contains(target, source)) {
    throw new Error('新旧备份目录不能互相包含。')
  }
  if (dirname(source) === source || dirname(target) === target) {
    throw new Error('不能将磁盘根目录用于备份目录迁移。')
  }
  if (contains(source, realpathSync(configPath))) {
    throw new Error('原备份目录包含正在使用的配置文件，无法迁移。')
  }

  const sourceEntry = lstatSync(source, { throwIfNoEntry: false })
  if (sourceEntry && !sourceEntry.isDirectory()) throw new Error(`原备份路径不是目录：${source}`)
  const targetEntry = lstatSync(target, { throwIfNoEntry: false })
  if (targetEntry && (!targetEntry.isDirectory() || readdirSync(target).length > 0)) {
    throw new Error(`请选择一个空的备份目录：${target}`)
  }

  logger.info(`正在迁移模组备份：${source} → ${target}`)
  const undo: (() => void)[] = []
  let staging: string | undefined
  let retired: string | undefined
  try {
    mkdirSync(dirname(target), { recursive: true })
    if (!sourceEntry) {
      if (!targetEntry) {
        mkdirSync(target)
        undo.push(() => rmdirSync(target))
      }
    } else {
      if (targetEntry) {
        rmdirSync(target)
        undo.push(() => mkdirSync(target))
      }
      try {
        renameSync(source, target)
        undo.push(() => renameSync(target, source))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        const copied = mkdtempSync(join(dirname(target), '.ntemm-backups-'))
        staging = copied
        logger.info(`正在跨磁盘复制模组备份：${target}`)
        await cp(source, copied, {
          recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true, preserveTimestamps: true
        })
        const previous = join(dirname(source), `.ntemm-backups-${randomUUID()}`)
        renameSync(source, previous)
        retired = previous
        undo.push(() => renameSync(previous, source))
        renameSync(copied, target)
        undo.push(() => renameSync(target, copied))
      }
    }
    saveConfig()
  } catch (error) {
    const rollbackErrors: string[] = []
    for (const rollback of undo.reverse()) {
      try {
        rollback()
      } catch (rollbackError) {
        rollbackErrors.push(describeError(rollbackError))
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`备份目录迁移失败：${describeError(error)}。回滚失败：${rollbackErrors.join('；')}`, { cause: error })
    }
    if (staging) await removeMigrationDirectory(staging)
    throw error
  }
  if (retired) await removeMigrationDirectory(retired)
  logger.info(`模组备份迁移完成：${target}`)
}

async function removeMigrationDirectory(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch (error) {
    logger.warning(`无法清理备份迁移临时目录：${path}：${describeError(error)}`)
  }
}
