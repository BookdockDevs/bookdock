import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import SmartMenu, { readerMenuDangerItemClass, readerMenuItemClass } from '@/components/ui/SmartMenu'
import { CloseIcon, CopyIcon, HeartIcon, PencilIcon, ReplyIcon, TrashIcon } from '@/features/reader/components/annotation-icons'
import ReviewTime from '@/features/reviews/components/ReviewTime'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { notify } from '@/lib/notifications'
import { computeAtPoint } from '@/lib/position'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

export interface DiscussionThreadComment {
  id: string
  parentId: string | null
  replyToId: string | null
  replyToName: string | null
  author: {
    id: string
    name: string
    avatarKey: string | null
  }
  body: string | null
  createdAt: number
  editedAt: number | null
  deletedAt: number | null
  own: boolean
  canDelete: boolean
  liked: boolean
  likeCount: number
}

export interface DiscussionThreadLiker {
  id: string
  name: string
  avatarKey: string | null
}

export type DiscussionThreadAction =
  | { type: 'like'; liked: boolean; commentId?: string }
  | { type: 'comment'; body: string; replyToId?: string }
  | { type: 'edit'; commentId: string; body: string }
  | { type: 'delete'; commentId: string }

export interface DiscussionThreadProps {
  comments?: DiscussionThreadComment[]
  likers?: DiscussionThreadLiker[]
  commentCount?: number
  likeCount?: number
  isPending?: boolean
  isError?: boolean
  onRetry?: () => void
  onAction: (action: DiscussionThreadAction) => Promise<boolean>
  isActionPending?: boolean
  hostAuthorId?: string
  hideTabs?: boolean
  detailLayout?: boolean
  className?: string
  initialTab?: 'comments' | 'likes'
  focusCommentId?: string
  theme?: 'reader' | 'app'
  submitLabel?: string
  editLabel?: string
  contextMenuId?: string
  timeRenderer?: (createdAt: number, editedAt: number | null) => ReactNode
  headerRight?: ReactNode
}

export default function DiscussionThread({
  comments = [],
  likers = [],
  commentCount = 0,
  likeCount = 0,
  isPending = false,
  isError = false,
  onRetry,
  onAction,
  isActionPending = false,
  hostAuthorId,
  hideTabs = false,
  detailLayout = false,
  className,
  initialTab = 'comments',
  focusCommentId,
  theme = 'reader',
  submitLabel,
  editLabel,
  contextMenuId = 'idea-comment-context-menu',
  timeRenderer,
  headerRight,
}: DiscussionThreadProps) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)

  const [tab, setTab] = useState<'comments' | 'likes'>(initialTab)
  const focused = useRef(false)
  const commentTarget = useRef<HTMLDivElement>(null)
  const [focusVisible, setFocusVisible] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<DiscussionThreadComment | null>(null)
  const [editing, setEditing] = useState<DiscussionThreadComment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DiscussionThreadComment | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  const [contextMenu, setContextMenu] = useState<{ comment: DiscussionThreadComment; pos: { x: number; y: number } } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartPos = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!focusCommentId || !commentTarget.current || focused.current) return
    focused.current = true
    commentTarget.current.scrollIntoView?.({ block: 'center' })
    commentTarget.current.focus({ preventScroll: true })
  }, [comments, focusCommentId])

  useEffect(() => {
    if (!focusCommentId) return
    setFocusVisible(true)
    const timer = setTimeout(() => setFocusVisible(false), 4000)
    return () => clearTimeout(timer)
  }, [focusCommentId])

  const userAvatar = user?.avatarKey ? avatarUrl(user.avatarKey) : undefined
  const isExpanded = isFocused || Boolean(draft) || Boolean(replyTo) || Boolean(editing)

  const tText = theme === 'reader' ? 'text-[var(--bd-read-text)]' : 'text-stone-800 dark:text-stone-200'
  const tSub = theme === 'reader' ? 'text-[var(--bd-read-sub)]' : 'text-stone-500 dark:text-stone-400'
  const tPrimaryBg = theme === 'reader' ? 'bg-[var(--bd-read-primary)]' : 'bg-stone-900 dark:bg-stone-100'
  const tPrimaryFg = theme === 'reader' ? 'text-white' : 'text-white dark:text-stone-900'
  const tComposerBg = theme === 'reader' ? 'bg-[var(--bd-read-bg)]' : 'bg-white dark:bg-stone-900'
  const tPlaceholder = theme === 'reader'
    ? 'placeholder-[var(--bd-read-sub)]/50'
    : 'placeholder-stone-400 dark:placeholder-stone-500'

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    if (!isExpanded) {
      el.style.height = ''
      return
    }
    el.style.height = 'auto'
    const newHeight = Math.min(Math.max(el.scrollHeight, 52), 160)
    el.style.height = `${newHeight}px`
  }, [draft, isExpanded])

  useEffect(() => {
    if (replyTo || editing) {
      setIsFocused(true)
      inputRef.current?.focus()
    }
  }, [replyTo, editing])

  async function submit() {
    if (!draft.trim() || isActionPending) return
    const saved = await onAction(
      editing
        ? { type: 'edit', commentId: editing.id, body: draft.trim() }
        : { type: 'comment', body: draft.trim(), replyToId: replyTo?.id },
    )
    if (saved) {
      setDraft('')
      setReplyTo(null)
      setEditing(null)
      setIsFocused(false)
    }
  }

  function handleCommentContextMenu(e: React.MouseEvent, comment: DiscussionThreadComment) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ comment, pos: { x: e.clientX, y: e.clientY } })
  }

  function handleTouchStart(e: React.TouchEvent, comment: DiscussionThreadComment) {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    touchStartPos.current = { x: touch.clientX, y: touch.clientY }
    if (touchTimer.current) clearTimeout(touchTimer.current)
    touchTimer.current = setTimeout(() => {
      touchTimer.current = null
      setContextMenu({ comment, pos: touchStartPos.current ?? { x: touch.clientX, y: touch.clientY } })
    }, 500)
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!touchStartPos.current) return
    const touch = e.touches[0]
    const dx = Math.abs(touch.clientX - touchStartPos.current.x)
    const dy = Math.abs(touch.clientY - touchStartPos.current.y)
    if (dx > 10 || dy > 10) {
      if (touchTimer.current) {
        clearTimeout(touchTimer.current)
        touchTimer.current = null
      }
    }
  }

  function handleTouchEnd() {
    if (touchTimer.current) {
      clearTimeout(touchTimer.current)
      touchTimer.current = null
    }
  }

  function renderComment(comment: DiscussionThreadComment) {
    const isReply = Boolean(comment.parentId)
    const authorAvatar = avatarUrl(comment.author.avatarKey)
    const isHost = Boolean(hostAuthorId && comment.author.id === hostAuthorId)

    return (
      <div
        key={comment.id}
        ref={comment.id === focusCommentId ? commentTarget : undefined}
        tabIndex={comment.id === focusCommentId ? -1 : undefined}
        data-notification-interaction={comment.id}
        onContextMenu={(e) => handleCommentContextMenu(e, comment)}
        onTouchStart={(e) => handleTouchStart(e, comment)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          'group relative transition-colors',
          comment.id === focusCommentId && focusVisible && 'rounded-lg bg-blue-500/10 ring-1 ring-blue-500/30',
          isReply
            ? 'ml-8 mt-2 border-l-2 border-stone-200/50 pl-3 dark:border-stone-800/60'
            : 'border-t border-stone-200/30 pt-3 pb-1.5 dark:border-stone-800/30 first:border-t-0',
        )}
      >
        <div className="flex items-start gap-2.5">
          <Link to="/profile" search={{ userId: comment.author.id }} onClick={(event) => event.stopPropagation()} className="shrink-0">
            {authorAvatar ? (
              <img src={authorAvatar} alt="" className={cn('rounded-full object-cover', isReply ? 'h-6 w-6' : 'h-7 w-7')} />
            ) : (
              <span className={cn('flex items-center justify-center rounded-full bg-stone-500/10 font-medium', tSub, isReply ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-xs')}>
                {comment.author.name.slice(0, 1)}
              </span>
            )}
          </Link>

          <div
            className={cn('min-w-0 flex-1', user && 'cursor-pointer')}
            onClick={() => {
              if (user) {
                setReplyTo(comment)
                setEditing(null)
              }
            }}
          >
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <Link to="/profile" search={{ userId: comment.author.id }} onClick={(event) => event.stopPropagation()} className={cn('font-medium hover:underline', tText)}>
                {comment.author.name}
              </Link>
              {isHost && (
                <span className={cn('rounded bg-stone-500/15 px-1 py-0.2 text-[10px] font-normal', tSub)}>
                  {_('comment.hostBadge')}
                </span>
              )}
              <span className={cn('cursor-default select-none opacity-70 hover:opacity-100 transition-opacity', tSub)}>
                · {timeRenderer ? timeRenderer(comment.createdAt, comment.editedAt) : <ReviewTime createdAt={comment.createdAt} editedAt={comment.editedAt} />}
              </span>
            </div>

            <p className={cn('mt-1 whitespace-pre-wrap text-sm leading-relaxed', tText)}>
              {comment.replyToName && (
                <span className={tSub}>
                  {_('comment.replyTo', { name: comment.replyToName })}：
                </span>
              )}
              {comment.body}
            </p>
          </div>

          <button
            type="button"
            disabled={!user || isActionPending}
            onClick={(e) => {
              e.stopPropagation()
              void onAction({ type: 'like', commentId: comment.id, liked: !comment.liked })
            }}
            className={cn(
              'flex items-center gap-1 text-xs shrink-0 pt-0.5 transition-colors cursor-pointer',
              comment.liked ? 'text-red-500 font-medium' : cn(tSub, 'hover:text-red-500'),
              !user && 'cursor-default opacity-80',
            )}
            title={comment.liked ? _('comment.unlike') : _('comment.like')}
          >
            {comment.likeCount > 0 && <span className="tabular-nums">{comment.likeCount}</span>}
            <HeartIcon filled={comment.liked} size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    )
  }

  const menuPos = contextMenu ? computeAtPoint(contextMenu.pos, 130, 140) : null

  return (
    <div className={cn(detailLayout ? 'mt-3 px-5 pb-4' : cn('pt-1', !hideTabs && 'mt-4'), className)}>
      {!hideTabs && (
        <div className="flex items-center gap-6 border-b border-stone-200/60 pb-2.5 dark:border-stone-800/60">
          <button
            type="button"
            aria-pressed={tab === 'comments'}
            onClick={() => setTab('comments')}
            className={cn(
              'relative pb-1 text-sm transition-colors cursor-pointer',
              tab === 'comments' ? cn('font-bold', tText) : cn(tSub, 'hover:text-current'),
            )}
          >
            {_('comment.tabComments', { count: commentCount })}
            {tab === 'comments' && (
              <span className={cn('absolute -bottom-2.5 left-0 right-0 h-0.5 rounded-full', theme === 'reader' ? 'bg-[var(--bd-read-primary)]' : 'bg-stone-700 dark:bg-stone-300')} />
            )}
          </button>

          <button
            type="button"
            aria-pressed={tab === 'likes'}
            onClick={() => setTab('likes')}
            className={cn(
              'relative pb-1 text-sm transition-colors cursor-pointer',
              tab === 'likes' ? cn('font-bold', tText) : cn(tSub, 'hover:text-current'),
            )}
          >
            {_('comment.tabLikes', { count: likeCount })}
            {tab === 'likes' && (
              <span className={cn('absolute -bottom-2.5 left-0 right-0 h-0.5 rounded-full', theme === 'reader' ? 'bg-[var(--bd-read-primary)]' : 'bg-stone-700 dark:bg-stone-300')} />
            )}
          </button>

          {headerRight && (
            <div className={cn('ml-auto flex items-center text-xs select-none pb-1 shrink-0', tSub)}>
              {headerRight}
            </div>
          )}
        </div>
      )}

      {isPending ? (
        <div className={cn(!hideTabs ? (detailLayout ? 'mt-2' : 'mt-3') : 'mt-1', 'space-y-3.5 animate-pulse')}>
          {commentCount > 0 ? (
            Array.from({ length: Math.min(commentCount, 2) }).map((__, i) => (
              <div key={i} className="flex items-start gap-2.5 pt-2">
                <div className="h-7 w-7 shrink-0 rounded-full bg-stone-500/15" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-24 rounded bg-stone-500/15" />
                  <div className="h-4 w-3/4 rounded bg-stone-500/10" />
                </div>
              </div>
            ))
          ) : (
            <div className={cn('flex items-center justify-center text-xs opacity-50', tSub, detailLayout ? 'py-3' : 'py-4')}>
              {_('comment.noComments')}
            </div>
          )}
        </div>
      ) : isError ? (
        <div className={cn(hideTabs ? 'pt-1' : detailLayout ? 'mt-2 pt-1' : 'mt-3 pt-1')}>
          <button
            onClick={() => onRetry?.()}
            className={cn('text-sm hover:underline transition-colors cursor-pointer', tSub, detailLayout ? 'py-2' : 'py-3')}
          >
            {_('review.discussionFailedRetry')}
          </button>
        </div>
      ) : !hideTabs && tab === 'likes' ? (
        <div className={detailLayout ? 'mt-2' : 'mt-3'}>
          {likers.length === 0 ? (
            <div className={cn('flex items-center justify-center text-xs', tSub, detailLayout ? 'py-3' : 'py-6')}>
              {_('comment.noLikes')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              {likers.map((liker) => {
                const avatar = avatarUrl(liker.avatarKey)
                return (
                  <div
                    key={liker.id}
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs',
                      theme === 'reader'
                        ? 'border-[var(--bd-read-accent)]/50 bg-stone-500/5 text-[var(--bd-read-text)]'
                        : 'border-stone-200/70 bg-stone-500/5 text-stone-700 dark:border-stone-800/70 dark:text-stone-200',
                    )}
                  >
                    <Link to="/profile" search={{ userId: liker.id }} onClick={(event) => event.stopPropagation()} aria-label={liker.name}>
                      {avatar ? (
                        <img src={avatar} alt="" decoding="async" className="h-4 w-4 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-400/20 text-[9px] font-medium">
                          {liker.name.slice(0, 1)}
                        </span>
                      )}
                    </Link>
                    <Link to="/profile" search={{ userId: liker.id }} onClick={(event) => event.stopPropagation()}>{liker.name}</Link>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className={detailLayout ? 'mt-1' : 'mt-2'}>
          <div className="space-y-1">
            {comments.length === 0 ? (
              <div className={cn('flex items-center justify-center text-xs', tSub, detailLayout ? 'py-3' : 'py-6')}>
                {_('comment.noComments')}
              </div>
            ) : (
              comments
                .filter((c) => !c.parentId)
                .map((rootComment) => (
                  <div key={rootComment.id}>
                    {renderComment(rootComment)}
                    {comments.filter((r) => r.parentId === rootComment.id).map(renderComment)}
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {user && (hideTabs || tab === 'comments') && (
        <div
          className={cn(
            detailLayout
              ? 'sticky bottom-0 z-10 border-t border-stone-200/40 pb-1 pt-2 dark:border-stone-800/40'
              : 'mt-4 border transition-[border-color,background-color]',
            !detailLayout && (
              isExpanded
                ? 'rounded-xl p-3 border-stone-200/70 bg-stone-500/[0.04] dark:border-stone-800/70 dark:bg-stone-500/[0.06]'
                : 'rounded-full px-3.5 py-2 hover:border-stone-300 dark:hover:border-stone-700 border-stone-200/70 bg-stone-500/[0.04] dark:border-stone-800/70 dark:bg-stone-500/[0.06] cursor-text'
            ),
            tComposerBg,
          )}
          onClick={() => {
            if (!isExpanded) {
              setIsFocused(true)
              inputRef.current?.focus()
            }
          }}
        >
          {(replyTo || editing) && (
            <div className={cn('flex items-center justify-between', detailLayout ? 'mb-2' : 'mb-2.5')}>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-stone-500/10 px-2.5 py-0.5 text-xs text-stone-600 dark:text-stone-300">
                <span className="font-medium">
                  {editing ? _('comment.editTitle') : _('comment.replyTo', { name: replyTo?.author.name ?? '' })}
                </span>
                <button
                  type="button"
                  disabled={isActionPending}
                  onClick={(e) => {
                    e.stopPropagation()
                    setReplyTo(null)
                    setEditing(null)
                    setDraft('')
                    setIsFocused(false)
                  }}
                  title={_('comment.cancel')}
                  className="rounded-full p-0.5 text-current transition-colors hover:bg-stone-500/20 cursor-pointer"
                >
                  <CloseIcon size={11} strokeWidth={2} />
                </button>
              </div>
            </div>
          )}

          <div className={cn('flex gap-2.5', isExpanded ? 'items-start' : 'items-center')}>
            {userAvatar ? (
              <img
                src={userAvatar}
                alt=""
                decoding="async"
                className={cn('shrink-0 rounded-full object-cover', isExpanded ? 'mt-0.5 h-6 w-6' : 'h-5 w-5')}
              />
            ) : (
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full bg-stone-400/20 text-[10px] font-medium text-stone-500 dark:text-stone-400',
                  isExpanded ? 'mt-0.5 h-6 w-6' : 'h-5 w-5',
                )}
              >
                {user.username.slice(0, 1)}
              </span>
            )}

            <textarea
              ref={inputRef}
              aria-label={_('comment.inputPlaceholder')}
              placeholder={replyTo ? _('comment.replyInputPlaceholder') : _('comment.inputPlaceholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => {
                if (!draft.trim() && !replyTo && !editing) {
                  setIsFocused(false)
                }
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void submit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setIsFocused(false)
                  setReplyTo(null)
                  setEditing(null)
                  if (!editing) setDraft('')
                }
              }}
              disabled={isActionPending}
              maxLength={10000}
              className={cn(
                'min-w-0 flex-1 resize-none bg-transparent leading-relaxed focus:outline-hidden',
                tText,
                tPlaceholder,
                isExpanded
                  ? 'min-h-[52px] max-h-40 text-sm'
                  : '!h-5 max-h-5 py-0 text-xs overflow-hidden cursor-text leading-5',
              )}
            />
          </div>

          {isExpanded && (
            <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-stone-200/40 pt-2 dark:border-stone-800/40">
              <button
                type="button"
                disabled={isActionPending}
                onClick={(e) => {
                  e.stopPropagation()
                  setIsFocused(false)
                  setReplyTo(null)
                  setEditing(null)
                  setDraft('')
                }}
                className={cn('px-2.5 py-1 text-xs transition-colors hover:text-current cursor-pointer', tSub)}
              >
                {_('comment.cancel')}
              </button>
              <button
                type="button"
                disabled={!draft.trim() || isActionPending}
                onClick={(e) => {
                  e.stopPropagation()
                  void submit()
                }}
                className={cn(
                  'rounded-full px-4 py-1 text-xs font-medium shadow-xs transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer',
                  tPrimaryBg,
                  tPrimaryFg,
                )}
              >
                {isActionPending
                  ? '...'
                  : editing
                    ? (editLabel ?? _('comment.save'))
                    : (submitLabel ?? _('comment.submit'))}
              </button>
            </div>
          )}
        </div>
      )}

      {contextMenu && menuPos && (
        <SmartMenu
          id={contextMenuId}
          innerRef={menuRef}
          variant={theme === 'reader' ? 'reader' : 'default'}
          position={menuPos}
          onClose={() => setContextMenu(null)}
          width={130}
        >
          <button
            type="button"
            className={readerMenuItemClass}
            onClick={() => {
              const text = contextMenu.comment.body
              if (text) {
                void navigator.clipboard.writeText(text).then(
                  () => notify.success({ key: 'reader.copied' }),
                  () => notify.error({ key: 'reader.copyFailed' }),
                )
              }
              setContextMenu(null)
            }}
          >
            <CopyIcon size={14} />
            <span>{_('annotation.copy')}</span>
          </button>

          {user && (
            <button
              type="button"
              className={readerMenuItemClass}
              onClick={() => {
                setReplyTo(contextMenu.comment)
                setEditing(null)
                setContextMenu(null)
              }}
            >
              <ReplyIcon size={14} />
              <span>{_('comment.reply')}</span>
            </button>
          )}

          {contextMenu.comment.own && (
            <button
              type="button"
              className={readerMenuItemClass}
              onClick={() => {
                setEditing(contextMenu.comment)
                setReplyTo(null)
                setDraft(contextMenu.comment.body ?? '')
                setContextMenu(null)
              }}
            >
              <PencilIcon />
              <span>{_('comment.edit')}</span>
            </button>
          )}

          {(contextMenu.comment.own || contextMenu.comment.canDelete) && (
            <button
              type="button"
              className={readerMenuDangerItemClass}
              onClick={() => {
                setDeleteTarget(contextMenu.comment)
                setContextMenu(null)
              }}
            >
              <TrashIcon size={14} />
              <span>{_('comment.delete')}</span>
            </button>
          )}
        </SmartMenu>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={_('comment.deleteConfirmTitle')}
          message={_('comment.deleteConfirmMessage')}
          confirmLabel={_('comment.delete')}
          confirmDisabled={isActionPending}
          onClose={() => {
            if (!isActionPending) setDeleteTarget(null)
          }}
          onConfirm={async () => {
            const targetId = deleteTarget.id
            const ok = await onAction({ type: 'delete', commentId: targetId })
            if (ok) {
              setDeleteTarget(null)
              notify.success({ key: 'comment.deletedNotice' })
            }
          }}
        />
      )}
    </div>
  )
}
