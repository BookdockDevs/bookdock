import type { InteractionNotification } from '@bookdock/shared'

/**
 * First-row action copy key for a notification entry.
 *
 * The key encodes domain (idea/review) and whether the interaction targets
 * the content itself or a comment on it. Comment and reply events always act
 * on a comment thread; only likes split on `commentId` (absent = content
 * like). See `notificationCenter.*Idea|*Review` keys.
 */
export function notificationActionKey(
  entry: Pick<InteractionNotification, 'domain' | 'event' | 'commentId'>,
): string {
  const scope = entry.domain === 'idea' ? 'Idea' : 'Review'
  if (entry.event === 'like' && entry.commentId) return `notificationCenter.likeComment${scope}`
  if (entry.event === 'reply') return `notificationCenter.reply${scope}`
  if (entry.event === 'like') return `notificationCenter.like${scope}`
  return `notificationCenter.comment${scope}`
}
