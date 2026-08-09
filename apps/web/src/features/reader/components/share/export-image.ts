import { toBlob } from 'html-to-image'

export const EXPORT_PIXEL_RATIO = 2

async function renderCardBlob(node: HTMLElement): Promise<Blob> {
  // SVG serialization rasterizes whatever font state exists at call time;
  // exporting before webfonts settle would bake fallback glyphs into the PNG
  await document.fonts.ready
  const blob = await toBlob(node, { pixelRatio: EXPORT_PIXEL_RATIO })
  if (!blob) throw new Error('card image export returned null')
  return blob
}

export async function downloadCardImage(node: HTMLElement, fileName: string): Promise<void> {
  const blob = await renderCardBlob(node)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Copies the card PNG to the clipboard. Returns false so the caller can fall
 * back to download (Firefox lacks ClipboardItem; insecure contexts reject). */
export async function copyCardImage(node: HTMLElement): Promise<boolean> {
  try {
    const blob = await renderCardBlob(node)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
