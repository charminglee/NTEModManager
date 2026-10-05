import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import iconv from 'iconv-lite'
import { logger } from './logger'
import type { OperationResult } from '../shared/types'

/** 傻瓜打包器约定:退出码 2 表示用户在脚本中取消了操作。 */
export const PACKAGER_CANCELLED_EXIT_CODE = 2

export interface PackageOptions {
  batchPath: string
  packageDirectory: string
  sourceDirectory?: string
}

function decodeOutput(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return iconv.decode(data, 'gbk')
  }
}

export function runPackager(options: PackageOptions): Promise<OperationResult> {
  const { batchPath, packageDirectory, sourceDirectory } = options
  if (!existsSync(batchPath)) {
    return Promise.resolve({ success: false, message: `找不到打包脚本：${batchPath}` })
  }

  logger.info(`启动打包脚本：${batchPath}`)
  const args = ['/c', path.resolve(batchPath)]
  if (sourceDirectory) {
    args.push(path.resolve(sourceDirectory))
  }

  return new Promise((resolve) => {
    const child = spawn('cmd.exe', args, { cwd: packageDirectory, windowsHide: true })
    let output = Buffer.alloc(0)
    child.stdout.on('data', (chunk: Buffer) => {
      output = Buffer.concat([output, chunk])
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output = Buffer.concat([output, chunk])
    })
    child.on('error', (error) => {
      logger.error(`无法启动打包脚本：${error.message}`)
      resolve({ success: false, message: `无法启动打包脚本：${error.message}` })
    })
    child.on('close', (code) => {
      const text = decodeOutput(output).trim()
      if (text) {
        logger.debug(`打包脚本输出：${text}`)
      }
      if (code === PACKAGER_CANCELLED_EXIT_CODE) {
        logger.warning('打包脚本已取消')
        resolve({ success: false, message: '', cancelled: true })
        return
      }
      if (code !== 0) {
        logger.error(`打包脚本失败，退出码：${code ?? 'unknown'}`)
        resolve({
          success: false,
          message: `打包失败：${text || '打包脚本异常退出。'}`
        })
        return
      }
      logger.info('打包脚本执行完成')
      resolve({ success: true, message: '' })
    })
  })
}
