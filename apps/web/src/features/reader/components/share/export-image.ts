import { toBlob } from 'html-to-image'

export const EXPORT_PIXEL_RATIO = 2

interface CardRenderCache {
  key: string
  promise: Promise<Blob>
}

let renderCache: CardRenderCache | null = null

async function renderCardBlob(node: HTMLElement): Promise<Blob> {
  // SVG serialization rasterizes whatever font state exists at call time;
  // exporting before webfonts settle would bake fallback glyphs into the PNG
  await document.fonts.ready
  const blob = await toBlob(node, { pixelRatio: EXPORT_PIXEL_RATIO })
  if (!blob) throw new Error('card image export returned null')
  return blob
}

/** Shared single-flight render keyed by the card's full config snapshot: a
 *  background warm-up and a later copy/save click on the same key resolve to
 *  the same blob, while any config change restarts the render */
export function getCardBlob(node: HTMLElement, key: string): Promise<Blob> {
  const cached = renderCache
  if (cached && cached.key === key) return cached.promise
  const promise = renderCardBlob(node)
  renderCache = { key, promise }
  // a failed render must not poison the cache for the next attempt
  promise.catch(() => {
    if (renderCache?.key === key) renderCache = null
  })
  return promise
}

export function downloadCardBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Copies the card PNG to the clipboard. Returns false so the caller can show
 * an error toast (Firefox lacks ClipboardItem; insecure contexts like
 * http://<lan-ip> have no navigator.clipboard at all). */
export async function copyCardBlob(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch (err) {
    console.warn('[share] clipboard write failed', err)
    return false
  }
}
