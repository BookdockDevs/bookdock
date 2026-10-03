// Avatar blobs are content-hash addressed, so a given (key, size) URL never
// changes payload and stays immutable in the browser cache. The server serves
// the WebP thumbnail by default (animated for GIF); 'static' selects the first
// frame and 'original' selects the untouched bytes.
export function avatarUrl(avatarKey: string | null | undefined, size?: 'thumb' | 'original' | 'static'): string | undefined {
  if (!avatarKey) return undefined
  return size && size !== 'thumb' ? `/api/v1/avatars/${avatarKey}?size=${size}` : `/api/v1/avatars/${avatarKey}`
}
