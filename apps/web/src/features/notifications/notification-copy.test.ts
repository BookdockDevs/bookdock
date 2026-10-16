import { describe, expect, it } from 'vitest'

import { notificationActionKey } from './notification-copy'

describe('notificationActionKey', () => {
  it.each([
    [{ domain: 'idea', event: 'comment', commentId: 'c1' }, 'notificationCenter.commentIdea'],
    [{ domain: 'idea', event: 'reply', commentId: 'c2' }, 'notificationCenter.replyIdea'],
    [{ domain: 'idea', event: 'like', commentId: null }, 'notificationCenter.likeIdea'],
    [{ domain: 'idea', event: 'like', commentId: 'c3' }, 'notificationCenter.likeCommentIdea'],
    [{ domain: 'review', event: 'comment', commentId: 'c4' }, 'notificationCenter.commentReview'],
    [{ domain: 'review', event: 'reply', commentId: 'c5' }, 'notificationCenter.replyReview'],
    [{ domain: 'review', event: 'like', commentId: null }, 'notificationCenter.likeReview'],
    [{ domain: 'review', event: 'like', commentId: 'c6' }, 'notificationCenter.likeCommentReview'],
  ] as const)('maps %j to %s', (entry, key) => {
    expect(notificationActionKey(entry)).toBe(key)
  })

  it('never describes a comment like as a content like', () => {
    expect(notificationActionKey({ domain: 'idea', event: 'like', commentId: 'c' })).not.toBe('notificationCenter.likeIdea')
    expect(notificationActionKey({ domain: 'review', event: 'like', commentId: 'c' })).not.toBe('notificationCenter.likeReview')
  })
})
