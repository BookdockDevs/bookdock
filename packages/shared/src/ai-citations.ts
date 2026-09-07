import type { AiCitation } from './contract'

export function sanitizeAiCitationMarkers(content: string, citationCount: number) {
  const maxCitation = Number.isInteger(citationCount) ? Math.max(0, citationCount) : 0
  return content.replace(/(\[(\d+)\]|【(\d+)】)(?!\()/g, (marker, _full, squareNumber: string | undefined, fullWidthNumber: string | undefined) => {
    const number = Number(squareNumber ?? fullWidthNumber)
    return number >= 1 && number <= maxCitation ? marker : ''
  })
}

export function normalizeAiCitationMarkers(content: string, citations: readonly AiCitation[]) {
  const selected: AiCitation[] = []
  const renumbered = new Map<number, number>()
  const normalizedContent = content.replace(/(\[(\d+)\]|【(\d+)】)(?!\()/g, (marker, _full, squareNumber: string | undefined, fullWidthNumber: string | undefined) => {
    const sourceNumber = Number(squareNumber ?? fullWidthNumber)
    const citation = citations[sourceNumber - 1]
    if (!Number.isInteger(sourceNumber) || sourceNumber < 1 || !citation) return ''
    let targetNumber = renumbered.get(sourceNumber)
    if (targetNumber === undefined) {
      targetNumber = selected.length + 1
      renumbered.set(sourceNumber, targetNumber)
      selected.push(citation)
    }
    return marker.startsWith('【') ? `【${targetNumber}】` : `[${targetNumber}]`
  })
  return { content: normalizedContent, citations: selected }
}
