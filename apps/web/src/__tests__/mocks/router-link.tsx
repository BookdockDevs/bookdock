import type { AnchorHTMLAttributes } from 'react'

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
  search?: Record<string, string | number | undefined>
}

export function Link({ to, search, children, ...props }: LinkProps) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value !== undefined) params.set(key, String(value))
  }
  const query = params.toString()
  return <a {...props} href={to + (query ? `?${query}` : '')}>{children}</a>
}
