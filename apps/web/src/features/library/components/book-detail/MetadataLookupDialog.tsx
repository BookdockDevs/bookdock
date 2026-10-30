import { useEffect, useRef, useState } from 'react'

import type { MetadataCandidate, MetadataConfiguration, MetadataProvider, MetadataSearchResponse, WeReadSearchScope } from '@bookdock/shared'

import { apiGet, apiPost, apiPostBlob } from '@/api/client'
import { Button } from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Modal from '@/components/ui/Modal'
import MetadataLookupDropdown from './MetadataLookupDropdown'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

import type { MetaDraft } from './types'

interface MetadataLookupDialogProps {
  draft: MetaDraft
  limited: boolean
  hasCover: boolean
  initialProvider?: MetadataProvider
  autoSearch?: boolean
  onApply: (draft: MetaDraft, cover?: File) => void
  onClose: () => void
}


function ResultCover({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className="flex h-[80px] w-[56px] shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-stone-300 bg-stone-100 text-stone-400 dark:border-stone-700 dark:bg-stone-800">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
          <path d="M6 6h10" />
          <path d="M6 10h10" />
        </svg>
      </div>
    )
  }
  return (
    <img
      src={src}
      referrerPolicy="no-referrer"
      alt=""
      onError={() => setFailed(true)}
      className="h-[80px] w-[56px] shrink-0 rounded-md border border-stone-200/60 object-cover shadow-2xs dark:border-stone-700/60"
    />
  )
}

export default function MetadataLookupDialog({
  draft,
  limited,
  hasCover,
  initialProvider,
  autoSearch = false,
  onApply,
  onClose,
}: MetadataLookupDialogProps) {
  const _ = useTranslation()
  const [query, setQuery] = useState(draft.title)
  const STORAGE_KEY_REPLACE = 'bd-metadata-replace'
  const STORAGE_KEY_UPDATE_COVER = 'bd-metadata-update-cover'

  const [provider, setProvider] = useState<MetadataProvider>(initialProvider ?? 'douban')
  const [results, setResults] = useState<MetadataCandidate[]>([])
  const [selected, setSelected] = useState<MetadataCandidate | null>(null)
  const [weReadScope, setWeReadScope] = useState<WeReadSearchScope>(() => {
    try { return localStorage.getItem('bd-weread-search-scope') === 'ebooks' ? 'ebooks' : 'all' } catch { return 'all' }
  })
  const [replace, setReplaceState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_REPLACE)
      return stored !== null ? stored === 'true' : false
    } catch {
      return false
    }
  })
  const [loading, setLoading] = useState(false)
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [updateCover, setUpdateCoverState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_UPDATE_COVER)
      return stored !== null ? stored === 'true' : !hasCover
    } catch {
      return !hasCover
    }
  })

  function handleReplace(nextVal: boolean) {
    setReplaceState(nextVal)
    try {
      localStorage.setItem(STORAGE_KEY_REPLACE, String(nextVal))
    } catch {
      // ignore
    }
  }

  function handleUpdateCover(nextVal: boolean) {
    setUpdateCoverState(nextVal)
    try {
      localStorage.setItem(STORAGE_KEY_UPDATE_COVER, String(nextVal))
    } catch {
      // ignore
    }
  }
  const active = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    active.current = true
    if (autoSearch && query.trim()) {
      void search(initialProvider ?? provider)
    }
    return () => {
      active.current = false
      request.current?.abort()
    }
    // Run only once on mount to handle autoSearch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function close() {
    active.current = false
    request.current?.abort()
    onClose()
  }

  async function search(targetProvider: MetadataProvider = provider, targetScope: WeReadSearchScope = weReadScope) {
    if (!query.trim() || loading) return
    setLoading(true)
    setError('')
    setSelected(null)
    setResults([])
    setSearched(false)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      if (targetProvider === 'googlebooks' || targetProvider === 'weread') {
        const config = await apiGet<{ data: MetadataConfiguration }>('/integrations/metadata-lookup/config', controller.signal)
        if (request.current !== controller || !active.current) return
        if (!config.data[targetProvider]) {
          setError(_(targetProvider === 'weread' ? 'metadataLookup.needWeReadKey' : 'metadataLookup.needKey'))
          return
        }
      }
      const response = await apiPost<MetadataSearchResponse>('/integrations/metadata-lookup/search', { provider: targetProvider, query, ...(targetProvider === 'weread' ? { weReadScope: targetScope } : {}) }, controller.signal)
      if (request.current !== controller || !active.current) return
      setError('')
      setResults(response.data)
      setSearched(true)
    } catch (err: unknown) {
      if (request.current !== controller || !active.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return
      setError(_('metadataLookup.searchError'))
    } finally {
      if (request.current === controller && active.current) setLoading(false)
    }
  }

  async function select(result: MetadataCandidate) {
    if (loading) return
    setError('')
    if (selected?.id === result.id) {
      setSelected(null)
      return
    }
    if (result.provider !== 'douban' && result.provider !== 'weread') {
      setSelected(result)
      return
    }
    setSelected(null)
    setLoading(true)
    setLoadingDetailId(result.id)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const response = await apiPost<{ data: MetadataCandidate }>(
        '/integrations/metadata-lookup/detail',
        { provider: result.provider, id: result.id },
        controller.signal,
      )
      if (request.current !== controller || !active.current) return
      setError('')
      const detail = response.data
      setSelected({ ...result, ...detail, authors: detail.authors.length ? detail.authors : result.authors,
        description: detail.description || result.description, publisher: detail.publisher || result.publisher,
        published: detail.published || result.published, isbn: detail.isbn || result.isbn,
        language: detail.language || result.language, coverUrl: detail.coverUrl || result.coverUrl,
        sourceUrl: detail.sourceUrl === 'https://weread.qq.com/' ? result.sourceUrl : detail.sourceUrl })
    } catch (err: unknown) {
      if (request.current !== controller || !active.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return
      setSelected(result)
      notify.warning({ key: 'metadataLookup.detailError' })
    } finally {
      if (request.current === controller && active.current) {
        setLoading(false)
        setLoadingDetailId(null)
      }
    }
  }

  const values = selected
    ? {
        title: selected.title,
        authors: selected.authors.join('、'),
        ...(!limited
          ? {
              description: selected.description,
              publisher: selected.publisher,
              published: selected.published,
              isbn: selected.isbn,
              language: selected.language,
            }
          : {}),
      }
    : {}

  const changes = (Object.entries(values).filter(
    ([key, value]) => typeof value === 'string' && value.trim() && (key === 'description' ? value !== draft.description : value.trim() !== draft[key as keyof MetaDraft]?.trim()) && (replace || !draft[key as keyof MetaDraft]?.trim()),
  ) as [string, string][])

  async function apply() {
    if (!selected) return
    setLoading(true)
    setError('')
    const controller = new AbortController()
    request.current = controller
    try {
      let cover: File | undefined
      if (updateCover && selected.coverUrl) {
        const image = await apiPostBlob(
          '/integrations/metadata-lookup/cover',
          { provider, url: selected.coverUrl },
          controller.signal,
        )
        cover = new File([image], 'cover', { type: image.type })
      }
      if (active.current) onApply({ ...draft, ...Object.fromEntries(changes) }, cover)
    } catch {
      if (active.current) setError(_('metadataLookup.coverError'))
    } finally {
      if (active.current) setLoading(false)
    }
  }

  return (
    <Modal
      title={_('metadataLookup.title')}
      actions={
        <>
        {provider === 'weread' && (
          <div role="group" aria-label={_('metadataLookup.weReadSearchScope')} className="inline-flex h-7 items-center rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
            {(['all', 'ebooks'] as const).map((scope) => (
              <button key={scope} type="button" aria-pressed={weReadScope === scope} disabled={loading} onClick={() => {
                if (scope === weReadScope) return
                setWeReadScope(scope)
                try { localStorage.setItem('bd-weread-search-scope', scope) } catch { /* Storage is optional. */ }
                setSelected(null)
                setResults([])
                setSearched(false)
                setError('')
                if (query.trim()) void search('weread', scope)
              }} className={`h-full rounded-md px-2 text-xs transition-colors disabled:opacity-50 ${weReadScope === scope ? 'bg-white font-medium text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}>
                {_(scope === 'all' ? 'metadataLookup.weReadAll' : 'metadataLookup.weReadEbooks')}
              </button>
            ))}
          </div>
        )}
        <MetadataLookupDropdown
          value={provider}
          disabled={loading}
          onSelect={(next) => {
            if (next === provider) return
            setProvider(next)
            setSelected(null)
            setResults([])
            setSearched(false)
            setError('')
            if (query.trim()) {
              void search(next)
            }
          }}
        />
        </>
      }
      onClose={close}
      size="xl"
      panelClassName="h-[80vh] max-h-[760px] min-h-[520px] flex flex-col"
      contentClassName="flex flex-col flex-1 min-h-0 overflow-hidden no-scrollbar [scrollbar-gutter:auto] pb-0 sm:pb-0"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex flex-wrap items-center gap-4">
            <Checkbox
              checked={replace}
              onChange={handleReplace}
              label={_('metadataLookup.replace')}
            />
            <Checkbox
              checked={updateCover}
              disabled={selected ? !selected.coverUrl : false}
              onChange={handleUpdateCover}
              label={_('metadataLookup.cover')}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              disabled={loading || !selected || (changes.length === 0 && !(updateCover && selected.coverUrl))}
              onClick={() => void apply()}
            >
              {_('metadataLookup.apply')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col flex-1 min-h-0 space-y-3">
        {/* Search input bar - unified card with inline clear & search buttons */}
        <div className="relative flex items-center w-full rounded-xl border border-stone-200 bg-white transition-colors focus-within:border-stone-400 focus-within:ring-2 focus-within:ring-stone-400/10 dark:border-stone-700 dark:bg-stone-850 dark:focus-within:border-stone-500 dark:focus-within:ring-stone-500/20">
          <input
            ref={inputRef}
            aria-label={_('metadataLookup.query')}
            value={query}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void search()
            }}
            placeholder={_('metadataLookup.query')}
            className="w-full bg-transparent px-3.5 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-stone-100"
          />
          <div className="flex items-center gap-1 pr-2">
            {isFocused && query.length > 0 && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setQuery('')
                  inputRef.current?.focus()
                }}
                aria-label="清空"
                title="清空"
                className="flex size-7 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-200 transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
            <button
              type="button"
              disabled={loading || !query.trim()}
              onClick={() => void search()}
              aria-label={_(loading && !loadingDetailId ? 'metadataLookup.searching' : 'metadataLookup.search')}
              title={_('metadataLookup.search')}
              className="flex size-7 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 disabled:hover:bg-transparent dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 transition-colors"
            >
              {loading && !loadingDetailId ? (
                <svg className="size-4 animate-spin text-stone-500 dark:text-stone-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {provider === 'googlebooks' && (
          <div className="flex items-center gap-2">
            <img
              src="https://books.google.com/googlebooks/images/poweredby.png"
              alt="Powered by Google"
              className="h-4 object-contain opacity-70"
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50/60 p-3 text-xs text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Results / Status middle section: ALWAYS takes flex-1 min-h-0 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {loading && !loadingDetailId ? (
            <div
              role="status"
              aria-label={_('metadataLookup.searching')}
              className="flex-1 min-h-0 space-y-2 overflow-hidden"
            >
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex w-full items-start gap-3 rounded-xl border border-stone-200/70 bg-stone-50/40 p-2.5 dark:border-stone-800/70 dark:bg-stone-900/40"
                >
                  <div className="h-[80px] w-[56px] shrink-0 animate-pulse rounded-md bg-stone-200/70 dark:bg-stone-800 motion-reduce:animate-none" />
                  <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                    <div className="flex items-center justify-between gap-4">
                      <div
                        className="h-4 animate-pulse rounded-md bg-stone-200/80 dark:bg-stone-800 motion-reduce:animate-none"
                        style={{ width: i === 1 ? '60%' : i === 2 ? '75%' : '48%' }}
                      />
                      <div className="size-4 shrink-0 animate-pulse rounded bg-stone-200/50 dark:bg-stone-800/50 motion-reduce:animate-none" />
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 animate-pulse rounded bg-stone-200/60 dark:bg-stone-800/70 motion-reduce:animate-none"
                        style={{ width: i === 1 ? '30%' : i === 2 ? '38%' : '24%' }}
                      />
                      <div className="h-3 w-12 animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/50 motion-reduce:animate-none" />
                    </div>
                    <div className="space-y-1.5 pt-1">
                      <div className="h-2.5 w-full animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40 motion-reduce:animate-none" />
                      <div className="h-2.5 w-4/5 animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40 motion-reduce:animate-none" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : searched && results.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-xs text-stone-400">
              {_('metadataLookup.noResults')}
            </div>
          ) : results.length > 0 ? (
            <div className="flex-1 min-h-0 space-y-2 overflow-y-auto no-scrollbar pb-3">
              {results.map((result) => {
                const isChosen = selected?.id === result.id
                const isItemLoading = loadingDetailId === result.id
                const description = isChosen ? selected.description : result.description
                return (
                  <button
                    key={result.id}
                    type="button"
                    disabled={loading}
                    onClick={() => void select(result)}
                    className={`group flex w-full gap-3 rounded-xl border p-2.5 text-left transition-all ${
                      isChosen || isItemLoading
                        ? 'border-stone-900 bg-stone-50 shadow-xs ring-1 ring-stone-900/10 dark:border-stone-100 dark:bg-stone-800/80 dark:ring-stone-100/20'
                        : 'border-stone-200/90 bg-white hover:border-stone-300 hover:bg-stone-50/70 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 dark:hover:bg-stone-850'
                    }`}
                  >
                    <ResultCover src={result.coverUrl} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm text-stone-900 dark:text-stone-100 line-clamp-1 leading-snug">
                          {result.title}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isItemLoading && (
                            <svg className="size-3.5 animate-spin text-stone-600 dark:text-stone-300" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          )}
                          {result.sourceUrl && (
                            <a
                              href={result.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={_('metadataLookup.source')}
                              title={_('metadataLookup.source')}
                              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </a>
                          )}
                        </div>
                      </div>

                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                        <span className="line-clamp-1">
                          {result.authors.join('、') || _('metadataLookup.unknownAuthor')}
                        </span>
                        {result.published && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="shrink-0">{result.published}</span>
                          </>
                        )}
                      </div>

                      {isItemLoading ? (
                        <div role="status" aria-label={_('metadataLookup.loadingDetail')} className="mt-1 space-y-1.5">
                          <div className="h-2 w-full animate-pulse rounded bg-stone-200/80 dark:bg-stone-700 motion-reduce:animate-none" />
                          <div className="h-2 w-3/4 animate-pulse rounded bg-stone-200/80 dark:bg-stone-700 motion-reduce:animate-none" />
                        </div>
                      ) : description && (
                        <p className="mt-1 line-clamp-2 text-xs leading-normal text-stone-400 dark:text-stone-500">
                          {description}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-xs text-stone-400">
              {_('metadataLookup.privacy')}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
