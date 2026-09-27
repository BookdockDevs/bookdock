/** Storage key of the WebP thumbnail derived from a cover key. */
export function coverThumbnailKey(coverKey: string): string {
  return coverKey.replace(/\.cover\.[^.]+$/, '.thumb.webp')
}
