import { Link, useLocation } from '@tanstack/react-router'

import type { ProfileReadingSummary } from '@bookdock/shared'

import { archiveEntryState, captureArchiveExitScroll } from '@/features/archive/archive-return'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

interface ProfileStatsSectionProps {
  summary?: ProfileReadingSummary
  showArchiveLink?: boolean
}

function formatCompactDuration(seconds: number, _: ReturnType<typeof useTranslation>): string {
  return formatDuration(seconds, _).replace(/\s+/g, '')
}

function formatWords(n: number, _: ReturnType<typeof useTranslation>): string {
  if (n >= 10000) {
    const formatted = (n / 10000).toFixed(1).replace(/\.0$/, '')
    const localized = _('stats.wordsWan', { n: formatted })
    return localized === 'stats.wordsWan' ? `${formatted}万字` : localized
  }
  const localized = _('stats.words', { n: Math.round(n) })
  return localized === 'stats.words' ? `${Math.round(n)}字` : localized
}

export function FormattedStatValue({ text }: { text: string }) {
  if (text === '—') return <span>—</span>
  const parts = text.split(/(\d+(?:\.\d+)?)/g).filter(Boolean)
  return (
    <>
      {parts.map((part, i) => {
        const isNum = /^\d+(?:\.\d+)?$/.test(part)
        return isNum ? (
          <span key={i} className="font-bold tracking-tight">{part}</span>
        ) : (
          <span key={i} className="ml-0.5 text-xs font-normal text-stone-500 dark:text-stone-400">{part.trim()}</span>
        )
      })}
    </>
  )
}

const icons = [
  <svg key="time" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  <svg key="words" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" x2="15" y1="20" y2="20" /><line x1="12" x2="12" y1="4" y2="20" /></svg>,
  <svg key="books" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z" /><path d="M10 2v8l3-2 3 2V2" /></svg>,
  <svg key="finished" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>,
  <svg key="days" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>,
  <svg key="streak" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 1 2.5 2.5z" /></svg>,
]

export default function ProfileStatsSection({ summary, showArchiveLink = false }: ProfileStatsSectionProps) {
  const _ = useTranslation()
  const location = useLocation()
  const cards = [
    { label: _('profile.totalReadingTime'), value: summary ? formatCompactDuration(summary.totalSeconds, _) : '—', color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400' },
    { label: _('profile.totalReadingWords'), value: summary ? formatWords(summary.totalWordsRead, _) : '—', color: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400' },
    { label: _('profile.booksRead'), value: summary ? _('stats.booksUnit', { n: summary.totalBooks }) : '—', color: 'bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400' },
    { label: _('profile.booksFinished'), value: summary ? _('stats.booksUnit', { n: summary.finishedBooks }) : '—', color: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400' },
    { label: _('profile.readingDays'), value: summary ? `${summary.totalDays} ${_('stats.days')}` : '—', color: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400' },
    { label: _('profile.currentStreak'), value: summary ? `${summary.currentStreak} ${_('stats.days')}` : '—', secondary: summary ? `${_('profile.longestStreak')} ${summary.longestStreak} ${_('stats.days')}` : undefined, color: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400' },
  ]

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-tight text-stone-900 sm:text-base dark:text-stone-100">{_('profile.overview')}</h2>
        {showArchiveLink && (
          <Link to="/archive" search={{ view: 'overview' }} state={(previous) => ({ ...previous, ...archiveEntryState({ to: '/profile' }, 0, previous.archiveReturn) })} onClick={(event) => {
            if (!location.state.archiveReturn && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented) {
              captureArchiveExitScroll(0)
            }
          }} className="group inline-flex items-center gap-1 text-xs font-medium text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200">
            <span>{_('profile.readingArchive')}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {cards.map((card, index) => (
          <div key={card.label} className="flex min-w-0 flex-col rounded-xl bg-white p-3.5 shadow-2xs ring-1 ring-stone-900/5 transition-all hover:shadow-xs hover:ring-stone-900/10 sm:p-4 dark:bg-stone-900/70 dark:ring-white/10 dark:hover:ring-white/15">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-stone-500 dark:text-stone-400">{card.label}</span>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${card.color}`}>{icons[index]}</div>
            </div>
            <p className="mt-2.5 truncate text-xl tabular-nums text-stone-900 sm:text-2xl dark:text-stone-100">
              <FormattedStatValue text={card.value} />
            </p>
            <div className="mt-1 min-h-[16px]">
              {card.secondary && <p className="truncate text-[11px] text-stone-400 dark:text-stone-500">{card.secondary}</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
