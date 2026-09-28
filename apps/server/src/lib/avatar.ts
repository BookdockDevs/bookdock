/** Storage key of the WebP thumbnail derived from an avatar key. */
export function avatarThumbnailKey(key: string): string {
  return key.replace(/\.(jpg|png|webp)$/, '.thumb.webp')
}
