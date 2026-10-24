export function ttsBoundaryRange(base: Range, expectedText: string, start: number, length: number): Range | null {
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length <= 0 || start + length > expectedText.length) return null
  const doc = base.startContainer.ownerDocument ?? (base.startContainer as Document)
  if (!doc) return null
  const walker = doc.createTreeWalker(base.commonAncestorContainer, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = base.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? [base.commonAncestorContainer as Text]
    : []
  const characters: Array<{ value: string; node: Text; offset: number }> = []
  let pendingSpace: { node: Text; offset: number } | null = null
  let current: Node | null
  while ((current = walker.nextNode())) textNodes.push(current as Text)
  for (const node of textNodes) {
    for (let offset = 0; offset < node.data.length; offset++) {
      if (base.comparePoint(node, offset) !== 0) continue
      const value = node.data[offset]
      if (/\s/u.test(value)) {
        if (characters.length) pendingSpace ??= { node, offset }
        continue
      }
      if (pendingSpace) {
        characters.push({ value: ' ', ...pendingSpace })
        pendingSpace = null
      }
      characters.push({ value, node, offset })
    }
  }
  if (characters.map(({ value }) => value).join('') !== expectedText) return null
  const first = characters[start]
  const last = characters[start + length - 1]
  if (!first || !last) return null
  const result = doc.createRange()
  result.setStart(first.node, first.offset)
  result.setEnd(last.node, last.offset + 1)
  return result
}

export function mapTtsBoundaryTexts(text: string, boundaries: Array<{ offset: number; duration: number; text: string }>) {
  let cursor = 0
  const mapped: Array<{ offsetSec: number; durationSec: number; text: string; start: number; length: number }> = []
  for (const boundary of boundaries) {
    const word = boundary.text.trim()
    if (!word) continue
    const start = text.indexOf(word, cursor)
    if (start < 0) continue
    mapped.push({ offsetSec: boundary.offset / 10_000_000, durationSec: boundary.duration / 10_000_000, text: boundary.text, start, length: word.length })
    cursor = start + word.length
  }
  return mapped
}
