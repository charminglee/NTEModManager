const PROTECTED = 'script, style, template, noscript, svg, math, iframe, object, embed, textarea, code, pre, kbd, samp, [hidden], [translate="no" i], [data-translate="no" i], .notranslate'

export function getTranslatableText(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(PROTECTED)) continue
    const text = (node as Text).data.trim()
    if (/\p{L}/u.test(text) && !/^(?:https?:\/\/|www\.)\S+$/iu.test(text)) parts.push(text)
  }
  return parts.join('').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')
}
