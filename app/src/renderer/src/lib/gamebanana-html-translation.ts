const EXCLUDED = 'script, style, template, noscript, svg, math, iframe, object, embed, textarea, code, pre, kbd, samp, [hidden], [translate="no" i], [data-translate="no" i]'
const BLOCKS = 'address, article, aside, blockquote, caption, dd, details, div, dl, dt, fieldset, figcaption, figure, footer, h1, h2, h3, h4, h5, h6, header, li, main, nav, ol, p, section, summary, td, th, ul'

export function createTranslationSource(html: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const paragraphs: string[][] = []
  const segments: { node: Text; original: string; text: string }[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Element)) return NodeFilter.FILTER_ACCEPT
      if (node.matches(EXCLUDED)) return NodeFilter.FILTER_REJECT
      return node.matches('br, hr') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    }
  })

  if (!document.body.closest(EXCLUDED)) {
    let previousBlock: Element | null | undefined
    let current: Node | null
    while ((current = walker.nextNode())) {
      if (current instanceof Element) {
        previousBlock = undefined
        continue
      }

      const node = current as Text
      const original = node.data
      const text = original.trim()
      if (!/\p{L}/u.test(text) || /^(?:https?:\/\/|www\.)\S+$/iu.test(text)) continue

      const block = node.parentElement!.closest(BLOCKS)
      if (block !== previousBlock) paragraphs.push([])
      previousBlock = block
      paragraphs[paragraphs.length - 1].push(text)
      segments.push({ node, original, text })
    }
  }

  return {
    paragraphs,
    applyTranslation(translations: (string | null)[]) {
      let incompleteSegments = 0
      segments.forEach(({ node, original, text }, index) => {
        const translation = translations[index]
        if (!translation) incompleteSegments += 1
        node.data = translation ? original.replace(text, () => translation) : original
      })
      return { html: document.documentElement.outerHTML, incompleteSegments }
    }
  }
}
