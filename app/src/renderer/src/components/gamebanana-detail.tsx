import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Download, ExternalLink, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { GameBananaAuthor, GameBananaComment, GameBananaFile, GameBananaMod } from '@shared/types'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import GameBananaHtml from './gamebanana-html'
import { formatFileSize } from '@/lib/format'

function date(timestamp: number): string {
  return timestamp ? new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false }) : '未提供'
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
      <span>{file.version && <>{file.version} · </>}{formatFileSize(file.sizeBytes)} · {file.downloadCount.toLocaleString('zh-CN')} 次下载</span>
      <span>上传时间：{date(file.uploadedAt)}</span>
      {file.description && <p>{file.description}</p>}
    </div>
    <Button size="sm" onClick={() => onDownload(file)} aria-label={`下载 ${file.name}`}><Download />下载</Button>
  </article>)}</div>
}

function Comments({ comments }: { comments: GameBananaComment[] }) {
  return <div className="gamebanana-comments">{comments.map((comment) => <article className="gamebanana-comment" key={comment.id}>
    <header><Author author={comment.author} /><div className="gamebanana-comment-dates"><span>发布于 {date(comment.uploadedAt)}</span>{comment.editedAt > 0 && <span>编辑于 {date(comment.editedAt)}</span>}</div></header>
    <GameBananaHtml title={`${comment.author.name} 的评论`} html={comment.content} />
    {comment.replies.length > 0 && <div className="gamebanana-replies"><Comments comments={comment.replies} /></div>}
  </article>)}</div>
}

export default function GameBananaDetail({ initial, onDownload }: { initial: GameBananaMod; onDownload: (mod: GameBananaMod, file: GameBananaFile) => void }) {
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

  return <>
    <DialogHeader className="gamebanana-detail-dialog-header">
      <span className="eyebrow">GAMEBANANA ／ MOD #{initial.id}</span>
      <div className="gamebanana-title-row">
        <DialogTitle>{mod?.name ?? initial.name}</DialogTitle>
        {mod && <Button variant="outline" className="gamebanana-source-button" onClick={() => void window.api.openExternal(mod.profileUrl)}><ExternalLink />查看原页面</Button>}
      </div>
      <DialogDescription className="sr-only">GameBanana 模组详情</DialogDescription>
    </DialogHeader>
    {!mod ? <div className="gamebanana-detail-state" role="status">
      {error ? <><TriangleAlert /><strong>详情加载失败</strong><p>{error}</p><Button onClick={() => setAttempt(attempt + 1)}>重试</Button></>
        : <><LoaderCircle className="animate-spin" /><span>正在加载完整模组页面……</span></>}
    </div> : <div className="gamebanana-detail-body">
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
        <h3>模组截图 <small>{mod.screenshots.length}</small></h3>
        {mod.screenshots.length === 0 ? <p className="gamebanana-empty">作者没有提供截图。</p> : <div className="gamebanana-screenshots">
          {mod.screenshots.map((image, index) => <button type="button" key={image.url} onClick={() => { setOriginalSize(false); setImageIndex(index) }} aria-label={`放大截图 ${index + 1}`}>
            <img src={image.url} alt={`${mod.name} 截图 ${index + 1}`} loading="lazy" />
          </button>)}
        </div>}
      </section>
      {mod.updates.length > 0 && <section className="gamebanana-detail-section" aria-label="更新信息">
        <h3>更新信息 <small>{mod.updates.length}</small></h3>
        <div className="gamebanana-updates">
          {mod.updates.map((update, index) => <details className="gamebanana-update" key={update.id} open={index === 0}>
            <summary><ChevronRight /><strong>{update.name || update.version || '模组更新'}</strong>{update.version && <span className="gamebanana-version">{update.version}</span>}{index === 0 && <span className="gamebanana-latest">最新</span>}<time>{date(update.uploadedAt)}</time></summary>
            <div className="gamebanana-update-content">
              {update.description && <GameBananaHtml html={update.description} title={`更新 ${update.name}`} />}
              {update.changes.map((change, changeIndex) => <div className="gamebanana-change" key={changeIndex}><span>{change.category || '更新'}</span><GameBananaHtml html={change.text} title={`${update.name} 变更 ${changeIndex + 1}`} /></div>)}
              {!update.description && update.changes.length === 0 && <p className="gamebanana-empty">作者没有填写更新说明。</p>}
            </div>
          </details>)}
        </div>
      </section>}
      <section className="gamebanana-detail-section" aria-label="模组介绍">
        <h3>模组介绍</h3>
        {mod.description ? <GameBananaHtml html={mod.description} title="模组介绍" /> : <p className="gamebanana-empty">作者没有提供介绍。</p>}
        {mod.installInstructions && <><h4>安装说明</h4><GameBananaHtml html={mod.installInstructions} title="安装说明" /></>}
      </section>
      <section className="gamebanana-detail-section" aria-label="模组文件">
        <h3>模组文件 <small>{mod.files.length}</small></h3>
        {mod.files.length === 0 ? <p className="gamebanana-empty">暂无可下载文件。</p> : <FileList files={mod.files} onDownload={(file) => onDownload(mod, file)} />}
        {mod.archivedFiles.length > 0 && <details className="gamebanana-archives"><summary><ChevronDown />归档文件 <small>{mod.archivedFiles.length}</small></summary><FileList files={mod.archivedFiles} onDownload={(file) => onDownload(mod, file)} /></details>}
      </section>
      <section className="gamebanana-detail-section" aria-label="用户评论">
        <h3>用户评论 <small>{mod.comments.toLocaleString('zh-CN')}</small></h3>
        {mod.commentItems.length === 0 ? <p className="gamebanana-empty">暂无评论。</p> : <Comments comments={mod.commentItems} />}
      </section>
    </div>}
    <Dialog open={imageIndex !== null} onOpenChange={(open) => { if (!open) setImageIndex(null) }}>
      <DialogContent className="gamebanana-lightbox" onKeyDown={(event) => {
        if (!mod || imageIndex === null) return
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          setOriginalSize(false)
          setImageIndex((imageIndex + (event.key === 'ArrowRight' ? 1 : -1) + mod.screenshots.length) % mod.screenshots.length)
        }
      }}>
        <DialogHeader><DialogTitle>截图预览</DialogTitle><DialogDescription>{imageIndex === null ? '' : `${imageIndex + 1} ／ ${mod?.screenshots.length}`} · 点击图片切换原始尺寸</DialogDescription></DialogHeader>
        {mod && imageIndex !== null && <>
          <div className={`gamebanana-lightbox-canvas ${originalSize ? 'is-original' : ''}`}><button type="button" onClick={() => setOriginalSize(!originalSize)} aria-label={originalSize ? '适应窗口' : '原始尺寸'}><img src={mod.screenshots[imageIndex].url} alt={`${mod.name} 截图 ${imageIndex + 1}`} /></button></div>
          <div className="gamebanana-lightbox-actions"><Button variant="outline" onClick={() => { setOriginalSize(false); setImageIndex((imageIndex - 1 + mod.screenshots.length) % mod.screenshots.length) }} disabled={mod.screenshots.length < 2}>上一张</Button><span>{originalSize ? '原始尺寸' : '适应窗口'}</span><Button variant="outline" onClick={() => { setOriginalSize(false); setImageIndex((imageIndex + 1) % mod.screenshots.length) }} disabled={mod.screenshots.length < 2}>下一张</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  </>
}
