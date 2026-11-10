const COVER_THUMBNAIL_MAX_EDGE = 360
const COVER_THUMBNAIL_PASSTHROUGH_BYTES = 180 * 1024

/**
 * Downscales local book covers to a shelf-friendly thumbnail so scraped or
 * user-uploaded images match the decode and storage profile of imported covers.
 */
export async function createCoverThumbnail(cover: Blob): Promise<Blob | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return cover
  try {
    const image = await createImageBitmap(cover)
    try {
      if (Math.max(image.width, image.height) <= COVER_THUMBNAIL_MAX_EDGE && cover.size <= COVER_THUMBNAIL_PASSTHROUGH_BYTES) {
        return cover
      }
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, COVER_THUMBNAIL_MAX_EDGE / Math.max(image.width, image.height))
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
      const outputType = cover.type === 'image/jpeg' ? 'image/jpeg' : cover.type === 'image/webp' ? 'image/webp' : 'image/png'
      const quality = outputType === 'image/png' ? undefined : 0.88
      const thumbnail = await new Promise<Blob | undefined>((resolve) =>
        canvas.toBlob((value) => resolve(value ?? undefined), outputType, quality),
      )
      return thumbnail ?? cover
    } finally {
      image.close()
    }
  } catch {
    return undefined
  }
}
