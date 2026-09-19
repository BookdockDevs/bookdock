// Overlap detection between annotation CFIs, backed by the vendored foliate-js
// epubcfi module (served from /public, loaded on demand like FoliateReader does).

export interface CfiModule {
  isCFI: RegExp
  collapse: (cfi: string, toEnd?: boolean) => string
  compare: (a: string, b: string) => number
}

let cfiModulePromise: Promise<CfiModule> | null = null

export function loadCfiModule(): Promise<CfiModule> {
  if (!cfiModulePromise) {
    const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<CfiModule>
    cfiModulePromise = dynamicImport('/foliate-js/epubcfi.js')
  }
  return cfiModulePromise
}

// Kept pure (module injected) so tests can pass the real epubcfi module
// without a network fetch. Non-EPUB CFIs (txt:/chapter: books) fall back to
// exact-match equality.
export function cfiRangesOverlap(cfi: CfiModule, a: string, b: string): boolean {
  if (!cfi.isCFI.test(a) || !cfi.isCFI.test(b)) return a === b
  const startA = cfi.collapse(a)
  const endA = cfi.collapse(a, true)
  const startB = cfi.collapse(b)
  const endB = cfi.collapse(b, true)
  return cfi.compare(startA, endB) < 0 && cfi.compare(startB, endA) < 0
}

export function cfiRangesIntersect(cfi: CfiModule, a: string, b: string): boolean {
  if (!cfi.isCFI.test(a) || !cfi.isCFI.test(b)) return a === b
  const startA = cfi.collapse(a)
  const endA = cfi.collapse(a, true)
  const startB = cfi.collapse(b)
  const endB = cfi.collapse(b, true)
  return cfi.compare(startA, endB) <= 0 && cfi.compare(startB, endA) <= 0
}

// Sort key for annotation lists: every CFI step/offset digit run compared
// numerically (epubcfi.compare semantics without the async module load).
// Takes the range start point, or the end point when `toEnd`: foliate emits
// `parent,start,end` where the fragments are relative, so the collapsed
// point is segment 0 + the chosen fragment; the 2-segment form's segments
// are already full start/end points. Returns null for non-`epubcfi(...)`
// values (chapter:/txt: positions), which callers fall back to string compare.
function cfiPositionKey(cfi: string, toEnd = false): number[] | null {
  const inner = /^epubcfi\((.*)\)$/.exec(cfi)?.[1]
  if (!inner) return null
  const segments = inner.split(',')
  const point = toEnd
    ? segments.length >= 3
      ? segments[0] + segments[2]
      : segments[segments.length - 1]
    : segments.length >= 3
      ? segments[0] + segments[1]
      : segments[0]
  return Array.from(point.matchAll(/\d+(?:\.\d+)?/g), (m) => Number(m[0]))
}

export function compareCfiPosition(a: string, b: string, toEnd = false): number {
  const ka = cfiPositionKey(a, toEnd)
  const kb = cfiPositionKey(b, toEnd)
  if (!ka || !kb) return a.localeCompare(b)
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const x = ka[i]
    const y = kb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x !== y) return x - y
  }
  return 0
}

export async function annotationsOverlap(a: string, b: string): Promise<boolean> {
  const cfi = await loadCfiModule()
  return cfiRangesOverlap(cfi, a, b)
}
