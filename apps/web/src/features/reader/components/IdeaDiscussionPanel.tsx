import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { IdeaComment } from '@bookdock/shared'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeAtPoint } from '@/lib/position'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import { CloseIcon, CopyIcon, HeartIcon, PencilIcon, TrashIcon } from './annotation-icons'
import { formatFullDateTime, formatRelativeTime } from './format-relative-time'
import { useIdeaAction, useIdeaDiscussion, type IdeaAction } from '../hooks/useIdeas'

interface IdeaDiscussionPanelProps {
  ideaId: string
  bookId: string
  initialCommentCount?: number
  initialLikeCount?: number
  hideTabs?: boolean
  className?: string
}

export default function IdeaDiscussionPanel({
  ideaId,
  bookId,
  initialCommentCount = 0,
  initialLikeCount = 0,
  hideTabs = false,
  className,
}: IdeaDiscussionPanelProps) {
  const _ = useTranslation()
  const query = useIdeaDiscussion(ideaId, bookId)
  const action = useIdeaAction(ideaId, bookId)
  const user = useAuthStore((state) => state.user)

  const [tab, setTab] = useState<'comments' | 'likes'>('comments')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<IdeaComment | null>(null)
  const [editing, setEditing] = useState<IdeaComment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<IdeaComment | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  const [contextMenu, setContextMenu] = useState<{ comment: IdeaComment; pos: { x: number; y: number } } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartPos = useRef<{ x: number; y: number } | null>(null)

  const data = query.data?.data
  const userAvatar = user?.avatarKey ? avatarUrl(user.avatarKey) : undefined
  const isExpanded = isFocused || Boolean(draft) || Boolean(replyTo) || Boolean(editing)

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

  async function perform(input: IdeaAction) {
    try {
      await action.mutateAsync(input)
      return true
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'annotation.saveFailed'))
      return false
    }
  }

  async function submit() {
    if (!draft.trim() || action.isPending) return
    const saved = await perform(
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

  function handleCommentContextMenu(e: React.MouseEvent, comment: IdeaComment) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ comment, pos: { x: e.clientX, y: e.clientY } })
  }

  function handleTouchStart(e: React.TouchEvent, comment: IdeaComment) {
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

  const isIdeaAuthor = (authorId: string) => Boolean(data?.idea.author?.id && authorId === data.idea.author.id)

  function renderComment(comment: IdeaComment) {
    const isReply = Boolean(comment.parentId)
    const authorAvatar = avatarUrl(comment.author.avatarKey)
    const isAuthor = isIdeaAuthor(comment.author.id)

    return (
      <div
        key={comment.id}
        onContextMenu={(e) => handleCommentContextMenu(e, comment)}
        onTouchStart={(e) => handleTouchStart(e, comment)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          'group relative transition-colors',
          isReply
            ? 'ml-8 mt-2 border-l-2 border-stone-200/50 pl-3 dark:border-stone-800/60'
            : 'border-t border-stone-200/30 pt-3 pb-1.5 dark:border-stone-800/30 first:border-t-0',
        )}
      >
        <div className="flex items-start gap-2.5">
          {authorAvatar ? (
            <img src={authorAvatar} alt="" className={cn('rounded-full object-cover shrink-0', isReply ? 'h-6 w-6' : 'h-7 w-7')} />
          ) : (
            <span className={cn('flex items-center justify-center rounded-full bg-stone-500/10 text-[var(--bd-read-sub)] shrink-0 font-medium', isReply ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-xs')}>
              {comment.author.name.slice(0, 1)}
            </span>
          )}

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
              <span className="font-medium text-[var(--bd-read-text)]">{comment.author.name}</span>
              {isAuthor && (
                <span className="rounded bg-stone-500/15 px-1 py-0.2 text-[10px] text-[var(--bd-read-sub)] font-normal">
                  {_('comment.hostBadge')}
                </span>
              )}
              <span
                title={formatFullDateTime(_, comment.createdAt)}
                aria-label={formatFullDateTime(_, comment.createdAt)}
                className="cursor-default select-none text-[var(--bd-read-sub)] opacity-70 hover:opacity-100 transition-opacity"
              >
                · {formatRelativeTime(_, comment.createdAt)}
              </span>
            </div>

            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--bd-read-text)]">
              {comment.replyToName && (
                <span className="text-[var(--bd-read-sub)]">
                  {_('comment.replyTo', { name: comment.replyToName })}：
                </span>
              )}
              {comment.body}
            </p>
          </div>

          <button
            type="button"
            disabled={!user || action.isPending}
            onClick={(e) => {
              e.stopPropagation()
              void perform({ type: 'like', commentId: comment.id, liked: !comment.liked })
            }}
            className={cn(
              'flex items-center gap-1 text-xs shrink-0 pt-0.5 transition-colors',
              comment.liked ? 'text-red-500 font-medium' : 'text-[var(--bd-read-sub)] hover:text-red-500',
              !user && 'cursor-default opacity-80',
            )}
            title={comment.liked ? _('comment.unlike') : _('comment.like')}
          >
            {comment.likeCount > 0 && <span className="tabular-nums">{comment.likeCount}</span>}
            <HeartIcon filled={comment.liked} size={15} />
          </button>
        </div>
      </div>
    )
  }

  const menuPos = contextMenu ? computeAtPoint(contextMenu.pos, 130, 140) : null

  return (
    <div className={cn('pt-1', !hideTabs && 'mt-4', className)}>
      {/* Tabs: 评论 n 与 赞 n */}
      {!hideTabs && (
        <div className="flex items-center gap-6 border-b border-stone-200/60 pb-2.5 dark:border-stone-800/60">
          <button
            type="button"
            aria-pressed={tab === 'comments'}
            onClick={() => setTab('comments')}
            className={cn(
              'relative pb-1 text-sm transition-colors',
              tab === 'comments'
                ? 'font-bold text-[var(--bd-read-text)]'
                : 'text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)]',
            )}
          >
            {_('comment.tabComments', { count: data?.idea.commentCount ?? initialCommentCount })}
            {tab === 'comments' && (
              <span className="absolute -bottom-2.5 left-0 right-0 h-0.5 rounded-full bg-[var(--bd-read-primary)]" />
            )}
          </button>

          <button
            type="button"
            aria-pressed={tab === 'likes'}
            onClick={() => setTab('likes')}
            className={cn(
              'relative pb-1 text-sm transition-colors',
              tab === 'likes'
                ? 'font-bold text-[var(--bd-read-text)]'
                : 'text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)]',
            )}
          >
            {_('comment.tabLikes', { count: data?.idea.likeCount ?? initialLikeCount })}
            {tab === 'likes' && (
              <span className="absolute -bottom-2.5 left-0 right-0 h-0.5 rounded-full bg-[var(--bd-read-primary)]" />
            )}
          </button>
        </div>
      )}

      {query.isPending ? (
        <div className={cn(!hideTabs ? 'mt-3' : 'mt-1', 'space-y-3.5 animate-pulse')}>
          {(data?.idea.commentCount ?? initialCommentCount) > 0 ? (
            Array.from({ length: Math.min(data?.idea.commentCount ?? initialCommentCount, 2) }).map((_, i) => (
              <div key={i} className="flex items-start gap-2.5 pt-2">
                <div className="h-7 w-7 shrink-0 rounded-full bg-stone-500/15" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-24 rounded bg-stone-500/15" />
                  <div className="h-4 w-3/4 rounded bg-stone-500/10" />
                </div>
              </div>
            ))
          ) : (
            <div className="flex py-4 items-center justify-center text-xs text-[var(--bd-read-sub)] opacity-50">
              {_('comment.noComments')}
            </div>
          )}
        </div>
      ) : query.isError || !data ? (
        <div className={cn(hideTabs ? 'pt-1' : 'mt-3 pt-1')}>
          <button
            onClick={() => void query.refetch()}
            className="py-3 text-sm text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)] transition-colors cursor-pointer"
          >
            讨论加载失败，点击重试
          </button>
        </div>
      ) : !hideTabs && tab === 'likes' ? (
        <div className="mt-3">
          {data.likers.length === 0 ? (
            <div className="flex py-6 items-center justify-center text-xs text-[var(--bd-read-sub)]">
              {_('comment.noLikes')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              {data.likers.map((liker) => {
                const avatar = avatarUrl(liker.avatarKey)
                return (
                  <div
                    key={liker.id}
                    className="flex items-center gap-2 rounded-full border border-stone-200/70 bg-stone-500/5 px-2.5 py-1 text-xs text-[var(--bd-read-text)] dark:border-stone-800/70"
                  >
                    {avatar ? (
                      <img src={avatar} alt="" decoding="async" className="h-4 w-4 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-400/20 text-[9px] font-medium">
                        {liker.name.slice(0, 1)}
                      </span>
                    )}
                    <span>{liker.name}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <div className="space-y-1">
            {data.comments.length === 0 ? (
              <div className="flex py-6 items-center justify-center text-xs text-[var(--bd-read-sub)]">
                {_('comment.noComments')}
              </div>
            ) : (
              data.comments
                .filter((c) => !c.parentId)
                .map((rootComment) => (
                  <div key={rootComment.id}>
                    {renderComment(rootComment)}
                    {data.comments.filter((r) => r.parentId === rootComment.id).map(renderComment)}
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* 底部评论输入栏：收起态为极简圆角胶囊（对标微信读书），点击展开为卡片 */}
      {user && (hideTabs || tab === 'comments') && (
        <div
              className={cn(
                'mt-4 border border-stone-200/70 bg-stone-500/[0.04] transition-[border-color,background-color] dark:border-stone-800/70 dark:bg-stone-500/[0.06]',
                isExpanded ? 'rounded-xl p-3' : 'rounded-full px-3.5 py-2 hover:border-stone-300 dark:hover:border-stone-700 cursor-text',
              )}
              onClick={() => {
                if (!isExpanded) {
                  setIsFocused(true)
                  inputRef.current?.focus()
                }
              }}
            >
              {(replyTo || editing) && (
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bd-read-primary)]/10 px-2.5 py-0.5 text-xs text-[var(--bd-read-primary)]">
                    <span className="font-medium">
                      {editing ? _('comment.editTitle') : _('comment.replyTo', { name: replyTo?.author.name ?? '' })}
                    </span>
                    <button
                      type="button"
                      disabled={action.isPending}
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
                      <CloseIcon size={11} />
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
                      'flex shrink-0 items-center justify-center rounded-full bg-stone-400/20 text-[10px] font-medium text-[var(--bd-read-sub)]',
                      isExpanded ? 'mt-0.5 h-6 w-6' : 'h-5 w-5',
                    )}
                  >
                    {user.username.slice(0, 1)}
                  </span>
                )}

                <textarea
                  ref={inputRef}
                  aria-label={_('comment.inputPlaceholder')}
                  placeholder={
                    replyTo
                      ? _('comment.replyInputPlaceholder')
                      : _('comment.inputPlaceholder')
                  }
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
                  disabled={action.isPending}
                  maxLength={10000}
                  className={cn(
                    'min-w-0 flex-1 resize-none bg-transparent leading-relaxed text-[var(--bd-read-text)] placeholder-[var(--bd-read-sub)]/50 focus:outline-hidden',
                    isExpanded
                      ? 'min-h-[52px] max-h-40 text-sm'
                      : '!h-5 max-h-5 py-0 text-xs placeholder-[var(--bd-read-sub)]/70 overflow-hidden cursor-text leading-5',
                  )}
                />
              </div>

              {isExpanded && (
                <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-stone-200/30 pt-2 text-xs dark:border-stone-800/30">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsFocused(false)
                      setReplyTo(null)
                      setEditing(null)
                      if (!editing) setDraft('')
                    }}
                    className="px-2.5 py-1 text-xs text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)] transition-colors cursor-pointer"
                  >
                    {_('comment.cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={action.isPending || !draft.trim()}
                    onClick={(e) => {
                      e.stopPropagation()
                      void submit()
                    }}
                    className="rounded-full bg-[var(--bd-read-primary)] px-4 py-1.5 text-xs font-medium text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
                  >
                    {editing ? _('comment.save') : _('comment.submit')}
                  </button>
                </div>
              )}
            </div>
          )}

      {/* 右键 / 长按操作菜单 */}
      {contextMenu && (
        <SmartMenu
          id="idea-comment-context-menu"
          innerRef={menuRef}
          variant="reader"
          position={menuPos}
          onClose={() => setContextMenu(null)}
          width={130}
        >
          {user && (
            <button
              type="button"
              onClick={() => {
                setReplyTo(contextMenu.comment)
                setEditing(null)
                setDraft('')
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10 cursor-pointer"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 17 4 12 9 7" />
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                </svg>
              </span>
              {_('comment.reply')}
            </button>
          )}

          {contextMenu.comment.body && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(contextMenu.comment.body ?? '')
                notify.success({ key: 'reader.copied' })
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10 cursor-pointer"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                <CopyIcon />
              </span>
              {_('annotation.copy')}
            </button>
          )}

          {contextMenu.comment.own && (
            <button
              type="button"
              onClick={() => {
                setEditing(contextMenu.comment)
                setReplyTo(null)
                setDraft(contextMenu.comment.body ?? '')
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10 cursor-pointer"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                <PencilIcon />
              </span>
              {_('comment.edit')}
            </button>
          )}

          {contextMenu.comment.canDelete && (
            <button
              type="button"
              onClick={() => {
                const target = contextMenu.comment
                setContextMenu(null)
                setDeleteTarget(target)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10 cursor-pointer"
            >
              <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">
                <TrashIcon />
              </span>
              {_('comment.delete')}
            </button>
          )}
        </SmartMenu>
      )}

      {/* 删除二次确认弹窗 */}
      {deleteTarget && (
        <ConfirmDialog
          title={_('comment.deleteConfirmTitle')}
          message={_('comment.deleteConfirmMessage')}
          confirmLabel={_('comment.delete')}
          confirmDisabled={action.isPending}
          onClose={() => {
            if (!action.isPending) setDeleteTarget(null)
          }}
          onConfirm={async () => {
            const ok = await perform({ type: 'delete', commentId: deleteTarget.id })
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
