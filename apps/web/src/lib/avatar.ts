// Avatar blobs are content-hash addressed; the URL payload never changes.
export function avatarUrl(avatarKey: string | null | undefined): string | undefined {
  return avatarKey ? `/api/v1/avatars/${avatarKey}` : undefined
}
