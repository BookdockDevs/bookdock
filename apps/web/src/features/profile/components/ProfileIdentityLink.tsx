import { Link } from '@tanstack/react-router'

import { avatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'

interface ProfileIdentityLinkProps {
  userId: string
  name: string
  avatarKey: string | null
  className?: string
  avatarClassName?: string
  stopPropagation?: boolean
}

export default function ProfileIdentityLink({
  userId,
  name,
  avatarKey,
  className,
  avatarClassName = 'h-6 w-6',
  stopPropagation = false,
}: ProfileIdentityLinkProps) {
  const avatar = avatarUrl(avatarKey)
  return (
    <Link
      to="/profile"
      search={{ userId }}
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
      className={cn('inline-flex items-center gap-2 min-w-0 max-w-full', className)}
    >
      {avatarClassName !== 'hidden' && (
        avatar ? (
          <img
            src={avatar}
            alt=""
            className={cn('shrink-0 rounded-full object-cover', avatarClassName)}
          />
        ) : (
          <span
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full bg-stone-200/80 text-[11px] font-semibold uppercase text-stone-700 dark:bg-stone-700 dark:text-stone-200',
              avatarClassName,
            )}
          >
            {name.slice(0, 1)}
          </span>
        )
      )}
      <span className="truncate">{name}</span>
    </Link>
  )
}
