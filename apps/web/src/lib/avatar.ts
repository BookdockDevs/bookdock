// Avatar blobs are content-hash addressed, so a given (key, size) URL never
// changes payload and stays immutable in the browser cache. The server serves
// the 256px WebP thumbnail by default; pass 'original' for the untouched bytes.
export function avatarUrl(avatarKey: string | null | undefined, size?: 'thumb' | 'original'): string | undefined {
  if (!avatarKey) return undefined
  return size === 'original' ? `/api/v1/avatars/${avatarKey}?size=original` : `/api/v1/avatars/${avatarKey}`
}
