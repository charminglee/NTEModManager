const PROTECTED = 'script, style, template, noscript, svg, math, iframe, object, embed, textarea, code, pre, kbd, samp, [hidden], [translate="no" i], [data-translate="no" i], .notranslate'

export function hasTranslatableText(html: string): boolean {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(PROTECTED)) continue
    const text = (node as Text).data.trim()
    if (/\p{L}/u.test(text) && !/^(?:https?:\/\/|www\.)\S+$/iu.test(text)) return true
  }
  return false
}

function restoreElementPresentation(source: Element, translated: Element): void {
  const sourceChildren = Array.from(source.children)
  const translatedChildren = Array.from(translated.children)
  if (sourceChildren.length !== translatedChildren.length || sourceChildren.some((element, index) =>
    element.localName !== translatedChildren[index].localName || element.namespaceURI !== translatedChildren[index].namespaceURI
  )) return

  sourceChildren.forEach((original, index) => {
    const replacement = translatedChildren[index]
    if (original.matches(PROTECTED)) {
      replacement.replaceWith(original.cloneNode(true))
      return
    }
    restoreElementPresentation(original, replacement)
    const styledElement = original.cloneNode(false) as Element
    while (replacement.firstChild) styledElement.append(replacement.firstChild)
    replacement.replaceWith(styledElement)
  })
}

export function restoreTranslationHtml(html: string, translatedHtml: string): string {
  const parser = new DOMParser()
  const source = parser.parseFromString(html, 'text/html')
  const translated = parser.parseFromString(translatedHtml, 'text/html')
  restoreElementPresentation(source.body, translated.body)

  const content = source.createDocumentFragment()
  while (translated.body.firstChild) content.append(translated.body.firstChild)
  source.body.replaceChildren(content)
  return source.documentElement.outerHTML
}
