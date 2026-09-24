import { useEffect, useRef, useState, type FormEvent } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

interface LibraryPaginationProps {
  currentPage: number
  totalPages: number
  totalBooks: number
  onPageChange: (page: number) => void
  disabled?: boolean
  selectionActive?: boolean
}

export default function LibraryPagination({
  currentPage,
  totalPages,
  totalBooks,
  onPageChange,
  disabled = false,
  selectionActive = false,
}: LibraryPaginationProps) {
  const _ = useTranslation()
  const [isJumping, setIsJumping] = useState(false)
  const [jumpInputValue, setJumpInputValue] = useState('')
  const [hoveredEllipsis, setHoveredEllipsis] = useState<'prev' | 'next' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Intent awareness: compact and muted when browsing, awake and full contrast when hovered or near bottom
  const [isNearBottom, setIsNearBottom] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    const checkBottom = () => {
      const scrollY = window.scrollY || window.pageYOffset
      const windowHeight = window.innerHeight
      const docHeight = document.documentElement.scrollHeight
      const isScrollable = docHeight > windowHeight + 80
      // Only considered reaching pagination zone if page actually has scroll depth and is scrolled near bottom
      setIsNearBottom(isScrollable && windowHeight + scrollY >= docHeight - 120)
    }

    checkBottom()
    window.addEventListener('scroll', checkBottom, { passive: true })
    window.addEventListener('resize', checkBottom, { passive: true })
    return () => {
      window.removeEventListener('scroll', checkBottom)
      window.removeEventListener('resize', checkBottom)
    }
  }, [])

  // Keyboard navigation: Left/Right arrows, 'g' for jump mode, Esc to exit
  useEffect(() => {
    if (disabled || selectionActive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase()
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return
      if (e.key === 'ArrowLeft' && currentPage > 1) {
        e.preventDefault()
        onPageChange(currentPage - 1)
      } else if (e.key === 'ArrowRight' && currentPage < totalPages) {
        e.preventDefault()
        onPageChange(currentPage + 1)
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        setIsJumping(true)
        setJumpInputValue(String(currentPage))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, selectionActive, currentPage, totalPages, onPageChange])

  // Focus and select input when morphing into jump mode
  useEffect(() => {
    if (isJumping) {
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    }
  }, [isJumping])

  const jumpTarget = Number(jumpInputValue.trim())
  const isValidJump = Number.isSafeInteger(jumpTarget) && jumpTarget >= 1 && jumpTarget <= totalPages && jumpTarget !== currentPage

  function handleJumpSubmit(e: FormEvent) {
    e.preventDefault()
    if (Number.isSafeInteger(jumpTarget) && jumpTarget >= 1 && jumpTarget <= totalPages) {
      if (jumpTarget !== currentPage) {
        onPageChange(jumpTarget)
      }
      setIsJumping(false)
    }
  }

  // Single page state: elegant muted static indicator at bottom of page
  if (totalPages <= 1) {
    if (totalBooks === 0) return null
    return (
      <div className="flex items-center justify-center gap-2.5 py-10 text-xs text-stone-400/80 select-none dark:text-stone-500/80">
        <span className="h-px w-6 bg-stone-200/80 dark:bg-stone-800" />
        <span className="tracking-wider">
          {_('library.allBooksShown')} · {_('library.bookCount', { count: totalBooks })}
        </span>
        <span className="h-px w-6 bg-stone-200/80 dark:bg-stone-800" />
      </div>
    )
  }

  // Calculate visible page range with ellipses
  const pageNumbers: (number | 'ellipsis-prev' | 'ellipsis-next')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i)
  } else {
    pageNumbers.push(1)
    if (currentPage > 3) {
      pageNumbers.push('ellipsis-prev')
    }
    const start = Math.max(2, currentPage - 1)
    const end = Math.min(totalPages - 1, currentPage + 1)
    for (let i = start; i <= end; i++) {
      if (i > 1 && i < totalPages) pageNumbers.push(i)
    }
    if (currentPage < totalPages - 2) {
      pageNumbers.push('ellipsis-next')
    }
    pageNumbers.push(totalPages)
  }

  const isAwake = isHovered || isNearBottom || isJumping

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 flex justify-center select-none sm:bottom-5 md:left-60',
      )}
    >
      <nav
        aria-label={_('library.paginationLabel')}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn(
          'pointer-events-auto inline-flex items-center rounded-full border p-1 backdrop-blur-2xl transition-all duration-300 ease-out',
          isAwake
            ? 'scale-100 border-stone-300 bg-white shadow-xl shadow-stone-900/10 dark:border-stone-700 dark:bg-stone-900 dark:shadow-black/40'
            : 'scale-90 border-stone-200/80 bg-white/85 shadow-sm shadow-stone-900/5 dark:border-stone-800/80 dark:bg-stone-900/85',
        )}
      >
        {isJumping ? (
          <form
            onSubmit={handleJumpSubmit}
            className="flex items-center gap-1.5 px-2 py-0.5 text-xs select-none"
          >
            <span className="font-medium text-stone-500 dark:text-stone-400">
              {_('library.jumpPrompt')}
            </span>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={jumpInputValue}
              onChange={(e) => setJumpInputValue(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setIsJumping(false)
                }
              }}
              autoFocus
              className="h-7 w-12 rounded-lg border border-stone-300 bg-stone-100 px-1 text-center font-mono text-xs font-semibold text-stone-900 outline-none focus:border-stone-900 focus:bg-white focus:ring-1 focus:ring-stone-900 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:focus:border-stone-100 dark:focus:ring-stone-100"
            />
            <span className="font-medium text-stone-400 dark:text-stone-500">
              / {totalPages} 页
            </span>
            <div className="flex items-center gap-1 pl-1">
              <button
                type="submit"
                disabled={!isValidJump}
                aria-label={_('library.jumpConfirm')}
                title={`${_('library.jumpConfirm')} (Enter)`}
                className="inline-flex h-6.5 w-6.5 items-center justify-center rounded-lg bg-stone-900 text-white transition-opacity disabled:pointer-events-none disabled:opacity-25 hover:opacity-90 dark:bg-stone-100 dark:text-stone-900"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setIsJumping(false)}
                aria-label={_('library.jumpCancel')}
                title={`${_('library.jumpCancel')} (Esc)`}
                className="inline-flex h-6.5 w-6.5 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-0.5">
            {/* Previous page button */}
            <button
              type="button"
              disabled={disabled || currentPage <= 1}
              onClick={() => onPageChange(currentPage - 1)}
              aria-label={_('library.previousPage')}
              title={_('library.previousPage')}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-25',
                isAwake
                  ? 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100'
                  : 'text-stone-400 hover:bg-stone-100/70 hover:text-stone-700 dark:text-stone-500',
              )}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            {/* Page buttons */}
            <div className="flex items-center gap-0.5 px-0.5">
              {pageNumbers.map((item) => {
                if (item === 'ellipsis-prev' || item === 'ellipsis-next') {
                  const which = item === 'ellipsis-prev' ? 'prev' : 'next'
                  const isHoveredWhich = hoveredEllipsis === which
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-label={which === 'prev' ? _('library.jumpBackward') : _('library.jumpForward')}
                      title={which === 'prev' ? _('library.jumpBackward') : _('library.jumpForward')}
                      onMouseEnter={() => setHoveredEllipsis(which)}
                      onMouseLeave={() => setHoveredEllipsis(null)}
                      onClick={() => onPageChange(which === 'prev' ? Math.max(1, currentPage - 5) : Math.min(totalPages, currentPage + 5))}
                      onDoubleClick={() => {
                        setIsJumping(true)
                        setJumpInputValue(String(currentPage))
                      }}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-lg font-mono text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-800',
                        isHoveredWhich
                          ? 'font-semibold text-stone-800 dark:text-stone-100'
                          : 'font-medium text-stone-400 dark:text-stone-500',
                      )}
                    >
                      {isHoveredWhich ? (
                        which === 'prev' ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="11 17 6 12 11 7" />
                            <polyline points="18 17 13 12 18 7" />
                          </svg>
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="13 17 18 12 13 7" />
                            <polyline points="6 17 11 12 6 7" />
                          </svg>
                        )
                      ) : (
                        <span>…</span>
                      )}
                    </button>
                  )
                }

                const page = item
                const isActive = page === currentPage
                return (
                  <button
                    key={page}
                    type="button"
                    aria-label={_('library.pageNumber', { page })}
                    aria-current={isActive ? 'page' : undefined}
                    disabled={disabled}
                    onClick={() => {
                      if (isActive) {
                        setIsJumping(true)
                        setJumpInputValue(String(page))
                      } else {
                        onPageChange(page)
                      }
                    }}
                    title={isActive ? `${_('library.pageNumber', { page })} · ${_('library.jumpToPage')}` : _('library.pageNumber', { page })}
                    className={cn(
                      'flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 font-mono text-xs font-medium transition-all duration-200',
                      isActive
                        ? (isAwake
                            ? 'cursor-pointer bg-stone-900 text-white shadow-sm ring-1 ring-stone-900/10 dark:bg-stone-100 dark:text-stone-900'
                            : 'bg-stone-700/80 text-stone-100 dark:bg-stone-300 dark:text-stone-800')
                        : (isAwake
                            ? 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800'
                            : 'text-stone-400 hover:bg-stone-100/70 hover:text-stone-700 dark:text-stone-500'),
                    )}
                  >
                    {page}
                  </button>
                )
              })}
            </div>

            {/* Next page button */}
            <button
              type="button"
              disabled={disabled || currentPage >= totalPages}
              onClick={() => onPageChange(currentPage + 1)}
              aria-label={_('library.nextPage')}
              title={_('library.nextPage')}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-25',
                isAwake
                  ? 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100'
                  : 'text-stone-400 hover:bg-stone-100/70 hover:text-stone-700 dark:text-stone-500',
              )}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </nav>
    </div>
  )
}
