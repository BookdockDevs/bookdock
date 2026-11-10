// Counting rule: each CJK char (incl. full-width punctuation, excluding
// ideographic spaces) counts 1; each run of latin letters/digits counts 1.
const CJK_RE = /[\u2e80-\u2fdf\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff01-\uff60\uffe0-\uffe6]/g
const LATIN_RUN_RE = /[A-Za-z0-9]+/g

export function countWords(text: string): number {
  if (!text) return 0
  const cjk = text.match(CJK_RE)?.length ?? 0
  const latin = text.match(LATIN_RUN_RE)?.length ?? 0
  return cjk + latin
}
