import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'

import type { MetadataConfiguration, MetadataProvider } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import MetadataProviderIcon from '@/components/ui/MetadataProviderIcon'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

interface MetadataLookupDropdownProps {
  onSelect: (provider: MetadataProvider) => void
  disabled?: boolean
  className?: string
  value?: MetadataProvider
}

const PROVIDERS: readonly MetadataProvider[] = ['douban', 'qidian', 'weread', 'bangumi', 'googlebooks', 'openlibrary'] as const

export default function MetadataLookupDropdown({ onSelect, disabled = false, className = '', value }: MetadataLookupDropdownProps) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const contextClient = useContext(QueryClientContext)
  const fallbackClientRef = useRef<QueryClient | null>(null)
  if (!contextClient && !fallbackClientRef.current) {
    fallbackClientRef.current = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
  }
  const queryClient = contextClient ?? fallbackClientRef.current!

  const userId = useAuthStore((state) => state.user?.id)
  const { data: configRes } = useQuery(
    {
      queryKey: ['metadata-lookup', 'config', userId],
      queryFn: () => apiGet<{ data: MetadataConfiguration }>('/integrations/metadata-lookup/config'),
      staleTime: 60_000,
      enabled: Boolean(contextClient),
    },
    queryClient,
  )
  const config = configRes?.data

  const availableProviders = useMemo(() => {
    return PROVIDERS.filter((item) => {
      if (item === 'weread') return Boolean(config?.weread)
      if (item === 'googlebooks') return Boolean(config?.googlebooks)
      return true
    })
  }, [config])

  const providerNames: Record<MetadataProvider, string> = {
    douban: _('metadataLookup.douban'),
    qidian: _('metadataLookup.qidian'),
    weread: _('metadataLookup.weread'),
    bangumi: 'Bangumi',
    googlebooks: 'Google Books',
    openlibrary: 'Open Library',
  }

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={menuRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={value ? providerNames[value] : _('metadataLookup.scrape')}
        title={value ? providerNames[value] : _('metadataLookup.scrape')}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-stone-200/90 bg-white px-2 text-xs font-medium text-stone-600 shadow-2xs transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-750 dark:hover:text-stone-100"
      >
        {value ? (
          <>
            <MetadataProviderIcon provider={value} size={15} className="rounded shrink-0" />
            <span className="truncate">{providerNames[value]}</span>
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-400">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span>{_('metadataLookup.scrape')}</span>
          </>
        )}
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={cn('shrink-0 text-stone-400 transition-transform duration-150', open && 'rotate-180')}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={_('metadataLookup.sourceLabel')}
          className="absolute right-0 top-full z-50 mt-1.5 w-[136px] overflow-hidden rounded-xl border border-stone-200 bg-white p-1 shadow-lg animate-in fade-in zoom-in-95 duration-100 dark:border-stone-700 dark:bg-stone-850"
        >
          {availableProviders.map((item) => {
            const isSelected = value === item
            const name = providerNames[item]
            return (
              <button
                key={item}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onSelect(item)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors',
                  isSelected
                    ? 'bg-stone-100 font-semibold text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                    : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100',
                )}
              >
                <MetadataProviderIcon provider={item} size={18} className="rounded shrink-0" />
                <span className="flex-1 truncate">{name}</span>
                {isSelected && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-stone-900 dark:text-stone-100"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
