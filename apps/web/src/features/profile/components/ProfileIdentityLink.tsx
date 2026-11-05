import { Link } from '@tanstack/react-router'

import Avatar from '@/components/ui/Avatar'
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
        <Avatar decorative src={avatar} name={name} className={cn('text-[11px] font-semibold uppercase', avatarClassName)} />
      )}
      <span className="truncate">{name}</span>
    </Link>
  )
}
