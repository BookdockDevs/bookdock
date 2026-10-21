import { Link } from '@tanstack/react-router'

import { avatarUrl } from '@/lib/avatar'

interface ProfileIdentityLinkProps {
  userId: string
  name: string
  avatarKey: string | null
  className?: string
  avatarClassName?: string
  stopPropagation?: boolean
}

export default function ProfileIdentityLink({ userId, name, avatarKey, className, avatarClassName = 'h-8 w-8', stopPropagation = false }: ProfileIdentityLinkProps) {
  const avatar = avatarUrl(avatarKey)
  return (
    <Link
      to="/profile"
      search={{ userId }}
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
      className={className}
    >
      {avatar ? <img src={avatar} alt="" className={`shrink-0 rounded-full object-cover ${avatarClassName}`} /> : <span className={`flex shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300 ${avatarClassName}`}>{name.slice(0, 1)}</span>}
      <span className="truncate">{name}</span>
    </Link>
  )
}
