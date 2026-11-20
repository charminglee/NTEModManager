import { defaultKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

const highlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.propertyName, color: '#244e76' },
  { tag: tags.string, color: '#316149' },
  { tag: tags.number, color: '#79532e' },
  { tag: [tags.bool, tags.null], color: 'hsl(var(--accent-foreground))' }
]))

const searchPhrases = EditorState.phrases.of({
  Find: '查找',
  next: '下一处',
  previous: '上一处',
  all: '选中全部',
  'match case': '区分大小写',
  'by word': '全字匹配',
  regexp: '正则表达式',
  close: '关闭查找',
  'current match': '当前匹配',
  'on line': '所在行',
  'Go to line': '转到行',
  go: '跳转'
})

const previewTheme = EditorView.theme({
  '&': { height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { scrollbarWidth: 'thin' },
  '.cm-content': { paddingBlock: '12px' },
  '.cm-line': { paddingInline: '16px' },
  '.cm-panels.cm-panels-top': {
    backgroundColor: 'hsl(var(--card))',
    color: 'hsl(var(--card-foreground))',
    borderBottom: '1px solid var(--rule)'
  },
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px 8px',
    padding: '8px 40px 8px 12px'
  },
  '.cm-panel.cm-search :is(input, button, label)': { margin: '0', fontSize: 'inherit' },
  '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px' },
  '.cm-panel.cm-search .cm-textfield': {
    flex: '1 1 10rem',
    minWidth: '0',
    height: '28px',
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))'
  },
  '.cm-panel.cm-search .cm-button': {
    height: '28px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid hsl(var(--border))',
    backgroundImage: 'none',
    backgroundColor: 'hsl(var(--card))',
    '&:hover': { backgroundColor: 'hsl(var(--secondary))' }
  },
  '.cm-panel.cm-search [name=close]': {
    top: '8px', right: '8px', width: '28px', height: '28px', fontSize: '18px',
    '&:hover': { backgroundColor: 'hsl(var(--secondary))' }
  },
  '.cm-panel.cm-search :is(input, button):focus-visible': { outline: '2px solid hsl(var(--ring))', outlineOffset: '1px' }
})

export default function WorkbenchJsonPreview({ value }: { value: string }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const editor = new EditorView({
      doc: value,
      parent: container.current!,
      extensions: [
        json(), highlighting, previewTheme,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({
          tabindex: '0',
          'aria-label': '资源元数据（JSON）',
          'aria-keyshortcuts': 'Control+F'
        }),
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        search({ top: true }),
        searchPhrases,
        keymap.of([...searchKeymap, ...defaultKeymap])
      ]
    })
    return () => editor.destroy()
  }, [value])

  return <div className="min-h-0 min-w-0 flex-1 bg-muted/30 text-xs select-text" ref={container} />
}
