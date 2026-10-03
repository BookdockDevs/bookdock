/** Storage key of the WebP thumbnail derived from an avatar key. */
export function avatarThumbnailKey(key: string): string {
  // Keep GIF variants separate from legacy keys for the same bytes uploaded under another MIME type.
  if (key.endsWith('.gif')) return `${key}.thumb.webp`
  return key.replace(/\.(jpg|png|webp)$/, '.thumb.webp')
}

export function avatarFirstFrameKey(key: string): string {
  return `${key}.first.webp`
}

export function avatarVariantKeys(key: string): string[] {
  return [key, avatarThumbnailKey(key), ...(key.endsWith('.gif') ? [avatarFirstFrameKey(key)] : [])]
}
