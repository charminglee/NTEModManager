import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Download, ExternalLink, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { GameBananaAuthor, GameBananaComment, GameBananaFile, GameBananaMod, GameBananaUpdate } from '@shared/types'
import { Button } from './ui/button'
import { AppDialog } from './ui/dialog'
import GameBananaTranslation from './gamebanana-translation'
import { formatFileSize } from '@/lib/format'

function date(timestamp: number): string {
  return timestamp ? new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false }) : '未提供'
}

function updateTranslationHtml(update: GameBananaUpdate): string {
  const document = new DOMParser().parseFromString(update.description, 'text/html')
  update.changes.forEach((change, index) => {
    const block = document.createElement('div')
    block.setAttribute('data-ntemm-update-change', String(index))
    const content = document.createElement('div')
    content.innerHTML = change.text
    block.append(content)
    document.body.append(block)
  })
  return document.documentElement.outerHTML
}

function Author({ author }: { author: GameBananaAuthor }) {
  return <div className="gamebanana-author">
    {author.avatarUrl
      ? <img src={author.avatarUrl} alt="" loading="lazy" />
      : <span className="gamebanana-avatar-placeholder">{author.name.slice(0, 1)}</span>}
    {author.profileUrl
      ? <button type="button" onClick={() => void window.api.openExternal(author.profileUrl)}>{author.name}</button>
      : <strong>{author.name}</strong>}
  </div>
}

function FileList({ files, onDownload }: { files: GameBananaFile[]; onDownload: (file: GameBananaFile) => void }) {
  return <div className="gamebanana-file-list">{files.map((file) => <article className="gamebanana-file-row" key={file.id}>
    <div>
      <strong>{file.name}</strong>
      <span>{file.version && <>{file.version}  ·  </>}{formatFileSize(file.sizeBytes)}  ·  {file.downloadCount.toLocaleString('zh-CN')} 次下载</span>
      <span>上传时间：{date(file.uploadedAt)}</span>
      {file.description && <p>{file.description}</p>}
    </div>
    <Button size="sm" onClick={() => onDownload(file)} aria-label={`下载 ${file.name}`}><Download />下载</Button>
  </article>)}</div>
}

function Comments({ modId, comments }: { modId: number; comments: GameBananaComment[] }) {
  return <div className="gamebanana-comments">{comments.map((comment) => <GameBananaTranslation
    key={comment.id}
    modId={modId}
    section={`comment:${comment.id}`}
    updatedAt={Math.max(comment.uploadedAt, comment.editedAt)}
    title={`${comment.author.name} 的评论`}
    html={comment.content}
  >
    {({ button, content }) => <article className="gamebanana-comment">
      <header><Author author={comment.author} /><div className="gamebanana-comment-dates"><span>发布于 {date(comment.uploadedAt)}</span>{comment.editedAt > 0 && <span>编辑于 {date(comment.editedAt)}</span>}</div>{button}</header>
      {content}
      {comment.replies.length > 0 && <div className="gamebanana-replies"><Comments modId={modId} comments={comment.replies} /></div>}
    </article>}
  </GameBananaTranslation>)}</div>
}

export default function GameBananaDetail({
  initial,
  open,
  onOpenChange,
  onDownload
}: {
  initial: GameBananaMod
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: (mod: GameBananaMod, file: GameBananaFile) => void
}) {
  const [mod, setMod] = useState<GameBananaMod | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [imageIndex, setImageIndex] = useState<number | null>(null)
  const [originalSize, setOriginalSize] = useState(false)

  useEffect(() => {
    let active = true
    setError('')
    setMod(null)
    void window.api.getGameBananaMod(initial.id).then((detail) => {
      if (active) setMod(detail)
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { active = false }
  }, [initial.id, attempt])

  return (
    <>
      <AppDialog
        kind="dialog"
        open={open}
        onOpenChange={onOpenChange}
        title={mod?.name ?? initial.name}
        eyebrow={<span className="eyebrow">GAMEBANANA ／ MOD #{initial.id}</span>}
        headerAction={mod && (
          <Button variant="outline" className="gamebanana-source-button" onClick={() => void window.api.openExternal(mod.profileUrl)}>
            <ExternalLink />查看原页面
          </Button>
        )}
        panelClassName="gamebanana-detail-dialog"
        headerClassName="gamebanana-detail-dialog-header"
        bodyClassName={mod ? 'gamebanana-detail-body' : 'gamebanana-detail-state-body'}
      >
        {!mod ? (
          <div className="gamebanana-detail-state" role="status">
            {error ? (
              <>
                <TriangleAlert />
                <strong>详情加载失败</strong>
                <p>{error}</p>
                <Button onClick={() => setAttempt(attempt + 1)}>重试</Button>
              </>
            ) : (
              <>
                <LoaderCircle className="animate-spin" />
                <span>正在加载完整模组页面……</span>
              </>
            )}
          </div>
        ) : (
          <>
            <section className="gamebanana-overview" aria-label="模组信息">
              <div><Author author={mod.author} /></div>
              <dl className="gamebanana-stats">
                {[['下载', mod.downloads], ['喜欢', mod.likes], ['浏览', mod.views], ['评论', mod.comments]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{Number(value).toLocaleString('zh-CN')}</dd></div>)}
              </dl>
              <dl className="gamebanana-dates">
                <div><dt>上传时间</dt><dd>{date(mod.uploadedAt)}</dd></div>
                {mod.modifiedAt > 0 && mod.modifiedAt !== mod.uploadedAt && <div><dt>修改时间</dt><dd>{date(mod.modifiedAt)}</dd></div>}
                {mod.updates.length > 0 && <div><dt>更新时间</dt><dd>{date(mod.updatedAt)}</dd></div>}
              </dl>
            </section>
            <section className="gamebanana-detail-section" aria-label="模组截图">
              <h3 className="section-heading">模组截图 <small>{mod.screenshots.length}</small></h3>
              {mod.screenshots.length === 0 ? <p className="gamebanana-empty">作者没有提供截图。</p> : <div className="gamebanana-screenshots">
                {mod.screenshots.map((image, index) => <button type="button" key={image.url} onClick={() => { setOriginalSize(false); setImageIndex(index) }} aria-label={`放大截图 ${index + 1}`}>
                  <img src={image.url} alt={`${mod.name} 截图 ${index + 1}`} loading="lazy" />
                </button>)}
              </div>}
            </section>
            {mod.updates.length > 0 && <section className="gamebanana-detail-section" aria-label="更新信息">
              <h3 className="section-heading">更新信息 <small>{mod.updates.length}</small></h3>
              <div className="gamebanana-updates">
                {mod.updates.map((update, index) => {
                  const translationHtml = updateTranslationHtml(update)
                  return <GameBananaTranslation
                    key={update.id}
                    modId={mod.id}
                    section={`update:${update.id}`}
                    updatedAt={Math.max(update.uploadedAt, update.modifiedAt)}
                    html={translationHtml}
                    updateCategories={update.changes.map((change) => change.category)}
                    title={`更新 ${update.name || update.version || ''}`}
                  >
                    {({ button, content }) => <details className="gamebanana-update" open={index === 0}>
                      <summary><ChevronRight /><strong>{update.name || update.version || '模组更新'}</strong>{update.version && <span className="gamebanana-version">{update.version}</span>}{index === 0 && <span className="gamebanana-latest">最新</span>}<time>{date(update.uploadedAt)}</time>{button}</summary>
                      <div className="gamebanana-update-content">
                        {update.description || update.changes.length > 0
                          ? content
                          : <p className="gamebanana-empty">作者没有填写更新说明。</p>}
                      </div>
                    </details>}
                  </GameBananaTranslation>
                })}
              </div>
            </section>}
            <section className="gamebanana-detail-section" aria-label="模组介绍">
              {mod.description ? <GameBananaTranslation
                modId={mod.id}
                section="description"
                updatedAt={Math.max(mod.uploadedAt, mod.modifiedAt, mod.updatedAt)}
                html={mod.description}
                title="模组介绍"
              >
                {({ button, content }) => <>
                  <h3 className="section-heading">模组介绍{button}</h3>
                  {content}
                </>}
              </GameBananaTranslation> : <>
                <h3 className="section-heading">模组介绍</h3>
                <p className="gamebanana-empty">作者没有提供介绍。</p>
              </>}
              {mod.installInstructions && <GameBananaTranslation
                modId={mod.id}
                section="instructions"
                updatedAt={Math.max(mod.uploadedAt, mod.modifiedAt, mod.updatedAt)}
                html={mod.installInstructions}
                title="安装说明"
              >
                {({ button, content }) => <>
                  <h4 className="gamebanana-translation-heading">安装说明{button}</h4>
                  {content}
                </>}
              </GameBananaTranslation>}
            </section>
            <section className="gamebanana-detail-section" aria-label="模组文件">
              <h3 className="section-heading">模组文件 <small>{mod.files.length}</small></h3>
              {mod.files.length === 0 ? <p className="gamebanana-empty">暂无可下载文件。</p> : <FileList files={mod.files} onDownload={(file) => onDownload(mod, file)} />}
              {mod.archivedFiles.length > 0 && <details className="gamebanana-archives"><summary><ChevronDown />归档文件 <small>{mod.archivedFiles.length}</small></summary><FileList files={mod.archivedFiles} onDownload={(file) => onDownload(mod, file)} /></details>}
            </section>
            <section className="gamebanana-detail-section" aria-label="用户评论">
              <h3 className="section-heading">用户评论 <small>{mod.comments.toLocaleString('zh-CN')}</small></h3>
              {mod.commentItems.length === 0 ? <p className="gamebanana-empty">暂无评论。</p> : <Comments modId={mod.id} comments={mod.commentItems} />}
            </section>
          </>
        )}
      </AppDialog>
      <AppDialog
        kind="dialog"
        open={open && imageIndex !== null}
        onOpenChange={(open) => { if (!open) setImageIndex(null) }}
        title="截图预览"
        headerAction={imageIndex === null ? undefined : (
          <span className="gamebanana-lightbox-meta">
            {imageIndex + 1} ／ {mod?.screenshots.length}  ·  点击图片切换原始尺寸
          </span>
        )}
        panelClassName="gamebanana-lightbox"
        bodyClassName="gamebanana-lightbox-body"
        footerClassName="gamebanana-lightbox-actions"
        footer={mod && imageIndex !== null ? (
          <>
            <Button variant="outline" onClick={() => { setOriginalSize(false); setImageIndex((imageIndex - 1 + mod.screenshots.length) % mod.screenshots.length) }} disabled={mod.screenshots.length < 2}>上一张</Button>
            <span>{originalSize ? '原始尺寸' : '适应窗口'}</span>
            <Button variant="outline" onClick={() => { setOriginalSize(false); setImageIndex((imageIndex + 1) % mod.screenshots.length) }} disabled={mod.screenshots.length < 2}>下一张</Button>
          </>
        ) : undefined}
        onKeyDown={(event) => {
          if (!mod || imageIndex === null) return
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault()
            setOriginalSize(false)
            setImageIndex((imageIndex + (event.key === 'ArrowRight' ? 1 : -1) + mod.screenshots.length) % mod.screenshots.length)
          }
        }}
      >
        {mod && imageIndex !== null && (
          <div className={`gamebanana-lightbox-canvas ${originalSize ? 'is-original' : ''}`}><button type="button" onClick={() => setOriginalSize(!originalSize)} aria-label={originalSize ? '适应窗口' : '原始尺寸'}><img src={mod.screenshots[imageIndex].url} alt={`${mod.name} 截图 ${imageIndex + 1}`} /></button></div>
        )}
      </AppDialog>
    </>
  )
}
