import { Download, ExternalLink, Info } from 'lucide-react'
import type { GameBananaFile, GameBananaMod } from '@shared/types'
import { gameBananaImageSrc } from '@/lib/gamebanana-image'
import { CardContextMenu, useCardContextMenu } from './card-context-menu'
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from './ui/dropdown-menu'

function formatModDate(timestamp: number, now: number): string {
  if (!timestamp) return '未知'
  const difference = now - timestamp * 1000
  const totalMinutes = Math.floor(Math.abs(difference) / 60_000)
  if (totalMinutes === 0) return '刚刚'
  const days = Math.floor(totalMinutes / 1440)
  if (days >= 365) return `${Math.floor(days / 365)}y`
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  const hours = Math.floor(totalMinutes / 60)
  const duration = days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : `${totalMinutes}m`
  return `${duration}`
}

function shortNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value).toLowerCase()
}

export default function GameBananaCard({ mod, selected, active, now, onOpen, onDownload }: {
  mod: GameBananaMod
  selected: boolean
  active: boolean
  now: number
  onOpen: (mod: GameBananaMod) => void
  onDownload: (mod: GameBananaMod, file: GameBananaFile) => void
}) {
  const menu = useCardContextMenu(active)
  const files = [...mod.files, ...mod.archivedFiles]
  const firstFile = files[0]

  return (
    <>
      <button
        type="button"
        className={`gamebanana-mod-card ${selected ? 'is-selected' : ''}`}
        aria-keyshortcuts="Shift+F10"
        onClick={() => onOpen(mod)}
        onContextMenu={menu.onContextMenu}
        onKeyDown={menu.onKeyDown}
      >
        {mod.previewUrl ? <img src={gameBananaImageSrc(mod.previewUrl)} alt="" draggable={false} /> : <div className="gamebanana-card-placeholder"><Download /></div>}
        <div className="gamebanana-card-copy">
          <strong>{mod.name}</strong>
          <span>{mod.authors}</span>
          <small>{shortNumber(mod.downloads)} 下载  ·  {shortNumber(mod.likes)} 喜欢  ·  {shortNumber(mod.views)} 浏览  ·  {shortNumber(mod.comments)} 评论</small>
          <small>
            上传 {formatModDate(mod.uploadedAt, now)}
            {mod.updatedAt !== mod.uploadedAt && `  ·  更新 ${formatModDate(mod.updatedAt, now)}`}
          </small>
        </div>
      </button>
      {menu.position && (
        <CardContextMenu label={`模组操作：${mod.name}`} position={menu.position} onClose={menu.close}>
          <DropdownMenuItem onSelect={() => onOpen(mod)}>
            <Info />
            查看详情
          </DropdownMenuItem>
          {files.length > 1 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download className="size-4 shrink-0" />
                下载
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  collisionPadding={8}
                  className="max-w-80 [&>.solid-popover]:max-h-[var(--radix-dropdown-menu-content-available-height)] [&>.solid-popover]:overflow-y-auto"
                >
                  {files.map((file) => (
                    <DropdownMenuItem key={file.id} onSelect={() => onDownload(mod, file)}>
                      <span className="truncate" title={file.name}>{file.name}</span>
                      {file.archived && <span className="shrink-0 text-xs text-muted-foreground">归档</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem disabled={!firstFile} onSelect={() => onDownload(mod, firstFile)}>
              <Download />
              下载
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void window.api.openExternal(mod.profileUrl)}>
            <ExternalLink />
            查看原页面
          </DropdownMenuItem>
        </CardContextMenu>
      )}
    </>
  )
}
