import { applyReplacementsWithWorker, type TextReplacementRule } from './text-replacements'

const createWorker = () => new Worker(new URL('./text-replacement.worker.ts', import.meta.url), { type: 'module' })

export function applyBrowserTextReplacements(
  html: string,
  rules: TextReplacementRule[],
  docType?: DOMParserSupportedType,
  sectionHref?: string,
  onInvalid?: (ids: string[]) => void,
) {
  return applyReplacementsWithWorker(createWorker, html, rules, docType, sectionHref, onInvalid)
}
