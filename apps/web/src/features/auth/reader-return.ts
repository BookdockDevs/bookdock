const READER_RETURN_KEY = 'bookdock:reader-return'

export function validatedReaderTarget(value: string): string | null {
  if (value.length > 512) return null
  const match = /^\/books\/([\w-]{1,128})(?:\?account=([\w-]{1,128}))?$/.exec(value)
  return match ? value : null
}

export function readerTarget(pathname: string, search: string): string | null {
  const account = new URLSearchParams(search).get('account')
  const target = account ? `${pathname}?account=${encodeURIComponent(account)}` : pathname
  return validatedReaderTarget(target)
}

export function rememberReaderTarget(pathname: string, search: string): void {
  const target = readerTarget(pathname, search)
  if (target) sessionStorage.setItem(READER_RETURN_KEY, target)
}

export function pendingReaderTarget(): string | null {
  const value = sessionStorage.getItem(READER_RETURN_KEY)
  const target = value ? validatedReaderTarget(value) : null
  if (value && !target) sessionStorage.removeItem(READER_RETURN_KEY)
  return target
}

export function clearReaderTarget(): void {
  sessionStorage.removeItem(READER_RETURN_KEY)
}
