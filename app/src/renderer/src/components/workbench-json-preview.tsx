import { defaultKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import {
  closeSearchPanel, findNext, findPrevious, getSearchQuery, search, searchKeymap, SearchQuery, setSearchQuery
} from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap, runScopeHandlers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui/button'

type PreviewSearch = { controls: HTMLDivElement; view: EditorView; query: SearchQuery }

const searchOptions = [
  ['caseSensitive', '区分大小写', CaseSensitive],
  ['regexp', '正则表达式', Regex],
  ['wholeWord', '全字匹配', WholeWord]
] as const

const highlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.propertyName, color: '#244e76' },
  { tag: tags.string, color: '#316149' },
  { tag: tags.number, color: '#79532e' },
  { tag: [tags.bool, tags.null], color: 'hsl(var(--accent-foreground))' }
]))

const blueprintLanguage = StreamLanguage.define({
  startState: () => ({ typeNext: false }),
  token(stream, state) {
    if (stream.sol()) state.typeNext = false
    if (stream.eatSpace()) return null
    if (stream.match(/\/\/.*/)) return 'comment'
    if (stream.match(/"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/)) return 'string'
    if (stream.match(/-?(?:0x[\da-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i)) return 'number'
    if (stream.match(/(?:class|struct|enum)\b/)) {
      state.typeNext = true
      return 'keyword'
    }
    if (stream.match(/(?:function|return|if|goto|self)\b/)) return 'keyword'
    if (stream.match(/(?:true|false)\b/)) return 'bool'
    if (stream.match(/(?:null|nullptr)\b/)) return 'null'
    if (stream.match(/L_[\dA-F]+\b/)) return 'labelName'
    if (stream.match(/EX_\w+\b/)) return 'operatorKeyword'
    if (stream.match(/[\p{L}_][\p{L}\p{N}_]*/u)) {
      const declaredType = state.typeNext
      state.typeNext = false
      if (declaredType || stream.string.startsWith('class ')) return 'typeName'
      if (stream.match(/\s*\(/, false)) return 'variableName.function'
      if (stream.start === stream.indentation() && stream.match(/\s*[<*\w]/, false)) return 'typeName'
      return null
    }
    stream.next()
    return null
  }
})

const blueprintHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.bool, tags.null], color: 'light-dark(#9c362c, #ffa99c)' },
  { tag: tags.typeName, color: 'light-dark(#244e76, #9acaff)' },
  { tag: tags.function(tags.variableName), color: 'light-dark(#6e417f, #e9b4fb)' },
  { tag: [tags.labelName, tags.operatorKeyword, tags.number], color: 'light-dark(#79532e, #f4bd86)' },
  { tag: tags.string, color: 'light-dark(#316149, #a4d9b8)' },
  { tag: tags.comment, color: 'light-dark(#625b51, #c4b9ae)', fontStyle: 'italic' }
]))

const searchPhrases = EditorState.phrases.of({
  Find: '查找',
  'current match': '当前匹配',
  'on line': '所在行',
  'Go to line': '转到行',
  go: '跳转'
})

const previewTheme = EditorView.theme({
  '&': { height: '100%' },
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
    padding: '8px 12px'
  },
  '.cm-panel.cm-search :is(input, button)': { margin: '0' },
  '.cm-panel.cm-search .cm-textfield': {
    flex: '1 1 10rem',
    minWidth: '0',
    height: '28px',
    fontSize: 'inherit',
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))'
  }
})

export default function WorkbenchJsonPreview({ value, code = false }: { value: string; code?: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const [searchPanel, setSearchPanel] = useState<PreviewSearch>()

  useEffect(() => {
    const editor = new EditorView({
      doc: value,
      parent: container.current!,
      extensions: [
        ...(code ? [blueprintLanguage, blueprintHighlighting] : [json(), highlighting]), previewTheme,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({
          tabindex: '0',
          'aria-label': code ? '蓝图反编译代码' : '资源元数据（JSON）',
          'aria-keyshortcuts': 'Control+F'
        }),
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        search({
          createPanel(view) {
            const document = view.dom.ownerDocument
            const dom = document.createElement('div')
            const input = document.createElement('input')
            const controls = document.createElement('div')
            let query = getSearchQuery(view.state)
            dom.className = 'cm-search'
            input.className = 'cm-textfield'
            input.placeholder = view.state.phrase('Find')
            input.setAttribute('aria-label', input.placeholder)
            input.setAttribute('main-field', 'true')
            input.value = query.search
            controls.className = 'flex shrink-0 items-center gap-1'
            input.addEventListener('input', () => {
              view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, search: input.value })) })
            })
            dom.addEventListener('keydown', event => {
              if (runScopeHandlers(view, event, 'search-panel')) {
                event.preventDefault()
              } else if (event.key === 'Enter' && event.target === input && !event.isComposing) {
                event.preventDefault()
                const find = event.shiftKey ? findPrevious : findNext
                find(view)
              }
            })
            dom.append(input, controls)
            return {
              dom,
              top: true,
              mount() {
                input.focus()
                input.select()
                setSearchPanel({ controls, view, query })
              },
              update({ state }) {
                const next = getSearchQuery(state)
                if (next.eq(query)) return
                query = next
                if (input.value !== query.search) input.value = query.search
                setSearchPanel({ controls, view, query })
              },
              destroy() { setSearchPanel(undefined) }
            }
          }
        }),
        searchPhrases,
        keymap.of([...searchKeymap, ...defaultKeymap])
      ]
    })
    return () => editor.destroy()
  }, [value, code])

  return <div className="min-h-0 min-w-0 flex-1 bg-muted/30 text-xs select-text" ref={container}>
    {searchPanel && createPortal(<>
      <Button type="button" variant="secondary" size="icon" className="size-7" aria-label="下一处"
        onClick={() => findNext(searchPanel.view)}><ChevronDown aria-hidden="true" /></Button>
      <Button type="button" variant="secondary" size="icon" className="size-7" aria-label="上一处"
        onClick={() => findPrevious(searchPanel.view)}><ChevronUp aria-hidden="true" /></Button>
      {searchOptions.map(([option, label, Icon]) => (
        <Button key={option} type="button" variant="secondary" size="icon"
          className="size-7 aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          aria-label={label} aria-pressed={searchPanel.query[option]} onClick={() => {
            const { view } = searchPanel
            const query = getSearchQuery(view.state)
            view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, [option]: !query[option] })) })
          }}><Icon aria-hidden="true" /></Button>
      ))}
      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="关闭查找"
        onClick={() => closeSearchPanel(searchPanel.view)}><X aria-hidden="true" /></Button>
    </>, searchPanel.controls)}
  </div>
}
