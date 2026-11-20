import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { Transaction } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef, useState } from 'react'
import { parseIni } from '@shared/ini'
import type { AppConfigData } from '@shared/types'
import { Button } from './ui/button'

const iniLanguage = StreamLanguage.define({
  startState: () => ({ value: false }),
  token(stream, state) {
    if (stream.sol()) state.value = false
    if (state.value) {
      stream.skipToEnd()
      return 'string'
    }
    if (stream.eatSpace()) return null
    if (stream.match(/[;#].*/)) return 'comment'
    if (stream.match(/\[.+\](?=\s*$)/)) return 'heading'
    if (stream.eat('=')) {
      state.value = true
      return 'operator'
    }
    if (stream.match(/[^=]+(?==)/)) return 'propertyName'
    stream.skipToEnd()
    return 'invalid'
  }
})

const iniHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading, color: '#9c362c', fontWeight: '700' },
  { tag: tags.propertyName, color: '#244e76' },
  { tag: tags.string, color: '#316149' },
  { tag: tags.comment, color: '#625b51', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'hsl(var(--destructive))', textDecoration: 'underline wavy' }
]))

const editorText = (text: string) => text.replace(/\r\n?/g, '\n')

function IniEditor({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const editor = new EditorView({
      parent: container.current!,
      extensions: [
        lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
        iniLanguage, iniHighlighting,
        EditorView.contentAttributes.of({
          'aria-labelledby': 'config-file-heading',
          'aria-describedby': 'config-file-path',
          spellcheck: 'false',
          autocapitalize: 'off'
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(Transaction.addToHistory) === false)) {
            onChangeRef.current(update.state.doc.toString())
          }
        })
      ]
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
  }, [])

  useEffect(() => {
    const editor = view.current!
    if (editor.state.doc.toString() !== value) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: Transaction.addToHistory.of(false)
      })
    }
  }, [value])

  return <div className="settings-ini-editor" ref={container} />
}

interface Props {
  active: boolean
  config: AppConfigData
  onSave: (original: string, content: string) => Promise<boolean>
}

export default function ConfigFileEditor({ active, config, onSave }: Props) {
  const [file, setFile] = useState<{ saved: string; draft: string } | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState('')
  const dirty = file !== null && file.draft !== editorText(file.saved)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void window.api.readConfigFile().then((content) => {
      if (cancelled) return
      setFile((previous) => previous && previous.draft !== editorText(previous.saved)
        ? previous
        : { saved: content, draft: editorText(content) })
    }).catch((cause: unknown) => {
      if (!cancelled) setError(`配置文件读取失败。${cause instanceof Error ? cause.message : String(cause)}`)
    })
    return () => { cancelled = true }
  }, [active, config, loadAttempt])

  const save = async () => {
    if (!file || !dirty || saving || conflict) return
    const content = file.saved.includes('\r\n') ? file.draft.replace(/\n/g, '\r\n') : file.draft
    setError('')
    setSaving(true)
    try {
      parseIni(content, true)
      if (await onSave(file.saved, content)) {
        setFile((previous) => previous && { ...previous, saved: content })
      } else {
        setConflict(true)
        setError('磁盘上的配置文件已更改。请复制要保留的修改，再重新加载。')
      }
    } catch (cause) {
      setError(`保存失败。${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setSaving(false)
    }
  }

  const reload = () => {
    setFile(null)
    setError('')
    setConflict(false)
    setLoadAttempt((attempt) => attempt + 1)
  }

  return (
    <section
      className="settings-config-file"
      aria-labelledby="config-file-heading"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void save()
        }
      }}
    >
      <div className="settings-config-header">
        <div>
          <h2 id="config-file-heading">配置文件</h2>
          <p id="config-file-path" className="select-text wrap-anywhere">{config.configPath}</p>
        </div>
        {file && (
          <div className="settings-config-actions">
            {dirty && <span className="settings-config-status">未保存</span>}
            <Button type="button" variant="secondary" disabled={!dirty || saving || conflict} onClick={() => void save()}>
              {saving ? '正在保存…' : '保存'}
            </Button>
          </div>
        )}
      </div>
      {file && <IniEditor value={file.draft} onChange={(draft) => {
        setFile((previous) => previous && { ...previous, draft })
        if (!conflict) setError('')
      }} />}
      {!file && !error && <p role="status">正在读取配置文件…</p>}
      {error && <p className="settings-config-error" role="alert">{error}</p>}
      {(conflict || (!file && error)) && (
        <Button type="button" variant="secondary" onClick={reload}>
          {conflict && dirty ? '放弃修改并重新加载' : '重新加载'}
        </Button>
      )}
    </section>
  )
}
