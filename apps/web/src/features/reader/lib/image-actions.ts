import type { ImageMediaInfo } from '../types'

export function formatImageFileName(image: ImageMediaInfo, bookTitle?: string, extension = 'jpg'): string {
  const sanitize = (val: string) => val.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').trim()
  const title = bookTitle ? sanitize(bookTitle) : ''
  const isCover = image.sectionIndex === 0 || /cover|封面|titlepage/i.test(image.alt || image.title || image.src)

  let alt = sanitize(image.alt || image.title || '')
  if (/^(image|img|pic|picture|cover|bookdock-image)$/i.test(alt)) {
    alt = ''
  }

  const parts: string[] = []
  if (title) parts.push(title)
  if (isCover) {
    parts.push(alt && alt !== '封面' ? `封面_${alt}` : '封面')
  } else if (alt) {
    parts.push(alt)
  } else {
    parts.push(`插图_${image.sectionIndex + 1}`)
  }

  const base = parts.join('_').slice(0, 80) || 'bookdock_image'
  return `${base}.${extension}`
}

function imageExtension(type: string): string {
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/svg+xml') return 'svg'
  if (type === 'image/gif') return 'gif'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/avif') return 'avif'
  if (type === 'image/bmp') return 'bmp'
  if (type === 'image/tiff') return 'tiff'
  if (type === 'image/x-icon' || type === 'image/vnd.microsoft.icon') return 'ico'
  const subtype = type.startsWith('image/') ? type.slice('image/'.length).split(';', 1)[0] : ''
  return subtype?.replace(/^x-/, '').replace(/[^a-z0-9]+/gi, '') || 'bin'
}

async function loadImageBlob(src: string): Promise<Blob> {
  const response = await fetch(src)
  if (!response.ok) throw new Error(`image resource request failed: ${response.status}`)
  return response.blob()
}

async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new window.Image()
    image.src = objectUrl
    await image.decode()
    const width = image.naturalWidth || 800
    const height = image.naturalHeight || 600
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('image could not be decoded')
    context.drawImage(image, 0, 0, width, height)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new Error('image could not be encoded')
    return png
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export async function downloadImage(image: ImageMediaInfo, bookTitle?: string): Promise<void> {
  const blob = await loadImageBlob(image.src)
  downloadBlob(blob, formatImageFileName(image, bookTitle, imageExtension(blob.type)))
}

export async function copyImage(image: ImageMediaInfo): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('image clipboard is unavailable')
  const blob = await loadImageBlob(image.src)
  const png = await toPngBlob(blob)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
