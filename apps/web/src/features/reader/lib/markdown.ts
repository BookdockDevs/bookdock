export const LEADING_CLOSING_PUNCTUATION = /^[，。！？、；：）》】』」”’…]+/

export function normalizeMarkdownParagraphLines(lines: string[]) {
  const normalized: string[] = []
  for (const line of lines) {
    const leading = line.trimStart()
    const previous = normalized[normalized.length - 1]
    if (previous && leading && LEADING_CLOSING_PUNCTUATION.test(leading)) {
      normalized[normalized.length - 1] = `${previous.trimEnd()}${leading}`
    } else {
      normalized.push(line)
    }
  }
  return normalized
}
