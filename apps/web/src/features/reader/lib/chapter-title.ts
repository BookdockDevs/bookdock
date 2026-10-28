export function markEpubChapterTitle(doc: Document, label: string): void {
  const expected = label.replace(/\s+/g, ' ').trim()
  if (!expected) return
  const headings = doc.body?.querySelectorAll('h1, h2, h3, h4, h5, h6, p')
  for (const heading of Array.from(headings ?? []).slice(0, 6)) {
    const title = heading.cloneNode(true) as Element
    for (const br of title.querySelectorAll('br')) br.replaceWith(' ')
    if (title.textContent?.replace(/\s+/g, ' ').trim() !== expected) continue
    heading.setAttribute('data-bd-chapter-title', '')
    break
  }
}
