import { toBlob } from 'html-to-image'

export const EXPORT_PIXEL_RATIO = 2
const EXPORT_TIMEOUT_MS = 30_000

export function withCardExportTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('card image export timed out')), EXPORT_TIMEOUT_MS)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** The prepared PNG is also the visible preview, so export never re-renders
 * a card that may have changed since the user saw it. */
export async function getCardBlob(node: HTMLElement, fontEmbedCSS: string): Promise<Blob> {
  const blob = await withCardExportTimeout(toBlob(node, { pixelRatio: EXPORT_PIXEL_RATIO, fontEmbedCSS }))
  if (!blob) throw new Error('card image export returned null')
  return blob
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
