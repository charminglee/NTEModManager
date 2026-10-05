import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react'
import type { ModFileEntry } from '@shared/types'
import { formatFileSize } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export interface FileTreeProps {
  entries: ModFileEntry[]
  depth: number
  /** 当前行的相对路径前缀(空字符串表示模组根目录) */
  relativeBase: string
  onRenameFile: (relativePath: string, newFileName: string) => void
}

/**
 * 模组文件树:文件夹可折叠,文件名双击进入内联编辑(pak/ucas/utoc 组重命名逻辑在主进程)。
 */
export default function FileTree({ entries, depth, relativeBase, onRenameFile }: FileTreeProps) {
  return (
    <div className={cn('flex flex-col', depth > 0 && 'border-l border-foreground/[0.08]')}>
      {entries.map((entry) => (
        <TreeRow
          key={`${relativeBase}/${entry.name}`}
          entry={entry}
          depth={depth}
          relativeBase={relativeBase}
          onRenameFile={onRenameFile}
        />
      ))}
    </div>
  )
}

interface TreeRowProps {
  entry: ModFileEntry
  depth: number
  relativeBase: string
  onRenameFile: (relativePath: string, newFileName: string) => void
}

function TreeRow({ entry, depth, relativeBase, onRenameFile }: TreeRowProps) {
  const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name
  const [expanded, setExpanded] = useState(false)

  if (entry.directory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-foreground/[0.05]"
          style={{ paddingLeft: `${depth * 18 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 text-sky-500/80 dark:text-sky-300/70" />
          <span className="truncate text-[13px] font-medium text-foreground/80">{entry.name}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {formatFileSize(entry.sizeBytes)}
          </span>
        </button>
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-200 ease-out',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            {entry.children.length > 0 ? (
              <FileTree
                entries={entry.children}
                depth={depth + 1}
                relativeBase={relativePath}
                onRenameFile={onRenameFile}
              />
            ) : (
              <div
                className="py-0.5 text-[11px] italic text-muted-foreground/60"
                style={{ paddingLeft: `${(depth + 1) * 18 + 26}px` }}
              >
                空文件夹
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <FileRow
      name={entry.name}
      sizeBytes={entry.sizeBytes}
      relativePath={relativePath}
      depth={depth}
      onRenameFile={onRenameFile}
    />
  )
}

function FileRow({
  name,
  sizeBytes,
  relativePath,
  depth,
  onRenameFile
}: {
  name: string
  sizeBytes: number
  relativePath: string
  depth: number
  onRenameFile: (relativePath: string, newFileName: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed.length === 0 || trimmed === name) {
      setDraft(name)
      return
    }
    onRenameFile(relativePath, trimmed)
  }

  if (editing) {
    return (
      <div className="px-2 py-0.5" style={{ paddingLeft: `${depth * 18 + 26}px` }}>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(name)
              setEditing(false)
            }
          }}
          className="h-6 rounded-sm px-1.5 py-0 text-[13px]"
        />
      </div>
    )
  }

  return (
    <div
      className="group flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-foreground/[0.05]"
      style={{ paddingLeft: `${depth * 18 + 26}px` }}
    >
      <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
      <span
        className="cursor-text truncate text-[13px] text-foreground/70"
        title={`${relativePath}\n双击重命名`}
        onDoubleClick={() => {
          setDraft(name)
          setEditing(true)
        }}
      >
        {name}
      </span>
      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
        {formatFileSize(sizeBytes)}
      </span>
    </div>
  )
}
