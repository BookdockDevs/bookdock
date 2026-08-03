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

export async function annotationsOverlap(a: string, b: string): Promise<boolean> {
  const cfi = await loadCfiModule()
  return cfiRangesOverlap(cfi, a, b)
}
