import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { MetadataCandidate, MetadataProviderId, MetadataSearchResponse, PersonalMetadataFields, PersonalMetadataSourceView, WeReadSearchScope } from '@bookdock/shared'

import { ApiError, apiGet, apiPost, apiPostBlob } from '@/api/client'
import { Button } from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Modal from '@/components/ui/Modal'
import MetadataLookupDropdown from './MetadataLookupDropdown'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import type { MetaDraft } from './types'

function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

// Personal sources often serve covers from CORS-enabled CDNs, so fetching in
// the browser reuses the cache the results list already warmed. Any failure
// falls back to the server proxy, which can also add provider headers.
async function fetchPersonalCoverClientSide(url: string, signal: AbortSignal): Promise<File | null> {
  try {
    const response = await fetch(url, { signal, redirect: 'error', mode: 'cors' })
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    const type = sniffImageType(bytes)
    if (!type) return null
    return new File([bytes], 'cover', { type })
  } catch {
    return null
  }
}

interface MetadataClassificationResult {
  category?: string
  tags?: string[]
}

interface MetadataLookupDialogProps {
  draft: MetaDraft
  limited: boolean
  hasCover: boolean
  initialProvider?: MetadataProviderId
  autoSearch?: boolean
  onApply: (draft: MetaDraft, cover?: File, classification?: MetadataClassificationResult) => void
  onClose: () => void
}


function ResultCover({ src, provider }: { src?: string; provider?: MetadataProviderId }) {
  const [failed, setFailed] = useState(false)
  const [useProxy, setUseProxy] = useState(false)
  const prevSrc = useRef(src)
  if (prevSrc.current !== src) {
    prevSrc.current = src
    setFailed(false)
    setUseProxy(false)
  }
  const proxyUrl = src && provider
    ? `/api/v1/integrations/metadata-lookup/cover?provider=${encodeURIComponent(provider)}&url=${encodeURIComponent(src)}`
    : undefined
  const currentSrc = useProxy ? proxyUrl : src

  if (!currentSrc || failed) {
    return (
      <div className="flex h-[68px] w-[48px] shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-stone-300 bg-stone-100 text-stone-400 dark:border-stone-700 dark:bg-stone-800">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
          <path d="M6 6h10" />
          <path d="M6 10h10" />
        </svg>
      </div>
    )
  }
  return (
    <img
      src={currentSrc}
      alt=""
      onError={() => {
        if (!useProxy && proxyUrl) {
          setUseProxy(true)
        } else {
          setFailed(true)
        }
      }}
      className="h-[68px] w-[48px] shrink-0 rounded-md border border-stone-200/60 object-cover shadow-2xs dark:border-stone-700/60"
    />
  )
}

function ResultCoverLarge({ src, provider, fallbackSrc }: { src?: string; provider?: MetadataProviderId; fallbackSrc?: string }) {
  const [failed, setFailed] = useState(false)
  const [stage, setStage] = useState<'primary' | 'fallback' | 'proxy'>('primary')
  const prevSrc = useRef(src)
  if (prevSrc.current !== src) {
    prevSrc.current = src
    setFailed(false)
    setStage('primary')
  }
  const alternative = fallbackSrc || (src && src.includes('/view/subject/l/') ? src.replace('/view/subject/l/', '/view/subject/s/') : undefined)
  const proxyTarget = src || alternative
  const proxyUrl = proxyTarget && provider
    ? `/api/v1/integrations/metadata-lookup/cover?provider=${encodeURIComponent(provider)}&url=${encodeURIComponent(proxyTarget)}`
    : undefined

  let currentSrc: string | undefined
  if (stage === 'primary') currentSrc = src || alternative
  else if (stage === 'fallback') currentSrc = alternative || proxyUrl
  else currentSrc = proxyUrl

  if (!currentSrc || failed) {
    return (
      <div className="flex h-[104px] w-[74px] shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-100 text-stone-400 dark:border-stone-700 dark:bg-stone-800">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
          <path d="M6 6h10" />
          <path d="M6 10h10" />
        </svg>
      </div>
    )
  }
  return (
    <img
      src={currentSrc}
      alt=""
      onError={() => {
        if (stage === 'primary' && alternative && alternative !== src) {
          setStage('fallback')
        } else if (stage !== 'proxy' && proxyUrl) {
          setStage('proxy')
        } else {
          setFailed(true)
        }
      }}
      className="h-[104px] w-[74px] shrink-0 rounded-lg border border-stone-200/60 object-cover shadow-2xs dark:border-stone-700/60"
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

  const userId = useAuthStore((state) => state.user?.id)
  const { data: sourcesData } = useQuery({
    queryKey: ['personal-metadata-sources', userId],
    queryFn: () => apiGet<{ data: PersonalMetadataSourceView[] }>('/integrations/personal-sources'),
    staleTime: 30_000,
    enabled: Boolean(userId),
  })
  const personalSources = Array.isArray(sourcesData?.data) ? sourcesData.data : []

  const [provider, setProvider] = useState<MetadataProviderId>(initialProvider ?? 'douban')
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
  const [applying, setApplying] = useState(false)
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
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
  const detailCache = useRef<Map<string, MetadataCandidate>>(new Map())

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

  async function search(targetProvider: MetadataProviderId = provider, targetScope: WeReadSearchScope = weReadScope) {
    if (!userId || !query.trim() || applying) return
    setLoading(true)
    setSelected(null)
    setResults([])
    setSearched(false)
    setLoadingDetailId(null)
    detailCache.current.clear()
    // A provider switch mid-search lands here too: the stale request's guards
    // ignore its own settlement, so aborting and replacing it is enough.
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const response = await apiPost<MetadataSearchResponse>('/integrations/metadata-lookup/search', { provider: targetProvider, query, ...(targetProvider === 'weread' ? { weReadScope: targetScope } : {}) }, controller.signal)
      if (request.current !== controller || !active.current) return
      setResults(response.data)
      setSearched(true)
    } catch (err: unknown) {
      if (request.current !== controller || !active.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return
      // Errors go through the standard toast; the results area reuses the
      // no-results empty state. The server detail (timeout, HTTP status,
      // source rejection reason) is appended for diagnosis.
      const detail = err instanceof ApiError && err.message ? `（${err.message}）` : ''
      notify.error(_('metadataLookup.searchError') + detail)
      setSearched(true)
    } finally {
      if (request.current === controller && active.current) setLoading(false)
    }
  }

  async function select(result: MetadataCandidate) {
    if (!userId || loading || applying) return
    if (selected?.id === result.id) {
      setSelected(null)
      return
    }
    // Douban and WeRead detail pages supplement the search result; personal
    // sources only get a detail round trip when they implement getDetail.
    // Sources installed before the has-detail probe existed default to the
    // old attempt-detail behavior.
    const needsDetail = result.provider === 'douban' || result.provider === 'weread' || result.provider === 'qidian'
      || (result.provider.startsWith('personal:') && (personalSources.find((item) => item.sourceId === result.provider.slice('personal:'.length))?.hasDetail ?? true))
    if (!needsDetail) {
      setSelected(result)
      return
    }
    const cacheKey = `${result.provider}:${result.id}`
    if (detailCache.current.has(cacheKey)) {
      setSelected(detailCache.current.get(cacheKey)!)
      return
    }
    setSelected(null)
    setLoading(true)
    setLoadingDetailId(result.id)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const response = await apiPost<{ data: MetadataCandidate | PersonalMetadataFields | null }>(
        '/integrations/metadata-lookup/detail',
        { provider: result.provider, id: result.id },
        controller.signal,
      )
      if (request.current !== controller || !active.current) return
      const detail = response.data
      const detailTitle = detail?.title?.trim()
      const merged: MetadataCandidate = detail ? {
        ...result,
        title: detailTitle ? detailTitle : result.title,
        authors: detail.authors?.length ? detail.authors : result.authors,
        description: detail.description || result.description,
        publisher: detail.publisher || result.publisher,
        published: detail.published || result.published,
        isbn: detail.isbn || result.isbn,
        language: detail.language || result.language,
        series: detail.series || result.series,
        seriesIndex: detail.seriesIndex || result.seriesIndex,
        coverUrl: detail.coverUrl || result.coverUrl,
        category: detail.category || result.category,
        // An empty array is truthy: a detail response that filtered out every
        // tag must not erase the tags the search result already supplied.
        tags: detail.tags?.length ? detail.tags : result.tags,
        sourceUrl: detail.sourceUrl === 'https://weread.qq.com/' ? result.sourceUrl : (detail.sourceUrl || result.sourceUrl),
      } : result
      detailCache.current.set(cacheKey, merged)
      setSelected(merged)
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
              series: selected.series,
              seriesIndex: selected.seriesIndex,
            }
          : {}),
      }
    : {}

  const changes = (Object.entries(values).filter(
    ([key, value]) => typeof value === 'string' && value.trim() && (key === 'description' ? value !== draft.description : value.trim() !== draft[key as keyof MetaDraft]?.trim()) && (replace || !draft[key as keyof MetaDraft]?.trim()),
  ) as [string, string][])

  async function apply() {
    if (!selected || loading || applying) return
    setApplying(true)
    const controller = new AbortController()
    request.current = controller
    try {
      let cover: File | undefined
      if (updateCover && selected.coverUrl) {
        // A cover that cannot be fetched only costs the cover: the scraped
        // fields still apply, so the failure is reported on its own.
        try {
          if (selected.provider.startsWith('personal:')) {
            cover = (await fetchPersonalCoverClientSide(selected.coverUrl, controller.signal)) ?? undefined
          }
          if (!cover) {
            const image = await apiPostBlob(
              '/integrations/metadata-lookup/cover',
              { provider, url: selected.coverUrl },
              controller.signal,
            )
            cover = new File([image], 'cover', { type: image.type })
          }
        } catch {
          if (active.current) notify.error(_('metadataLookup.coverError'))
        }
      }
      const hasClassification = Boolean(selected.category || selected.tags?.length)
      const classification: MetadataClassificationResult | undefined = hasClassification
        ? { category: selected.category, tags: selected.tags }
        : undefined
      if (active.current) {
        if (classification) {
          onApply({ ...draft, ...Object.fromEntries(changes) }, cover, classification)
        } else {
          onApply({ ...draft, ...Object.fromEntries(changes) }, cover)
        }
      }
    } finally {
      if (active.current) setApplying(false)
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
              <button key={scope} type="button" aria-pressed={weReadScope === scope} disabled={loading || applying} onClick={() => {
                if (scope === weReadScope) return
                setWeReadScope(scope)
                try { localStorage.setItem('bd-weread-search-scope', scope) } catch { /* Storage is optional. */ }
                setSelected(null)
                setResults([])
                setSearched(false)
                if (query.trim()) void search('weread', scope)
              }} className={`h-full rounded-md px-2 text-xs transition-colors disabled:opacity-50 ${weReadScope === scope ? 'bg-white font-medium text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}>
                {_(scope === 'all' ? 'metadataLookup.weReadAll' : 'metadataLookup.weReadEbooks')}
              </button>
            ))}
          </div>
        )}
        <MetadataLookupDropdown
          value={provider}
          disabled={applying}
          onSelect={(next) => {
            if (next === provider) return
            setProvider(next)
            setSelected(null)
            setResults([])
            setSearched(false)
            if (query.trim()) {
              void search(next)
            }
          }}
        />
        </>
      }
      onClose={close}
      size="4xl"
      panelClassName="h-[85vh] min-h-[520px] flex flex-col"
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
              disabled={loading || applying || !selected || (changes.length === 0 && !(updateCover && selected.coverUrl))}
              onClick={() => void apply()}
            >
              {applying && (
                <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              <span>{_('metadataLookup.apply')}</span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col flex-1 min-h-0 space-y-3">
        {/* Search input bar - unified card with inline clear & search buttons */}
        <div className="relative flex items-center w-full rounded-xl border border-stone-200 bg-white transition-colors focus-within:border-stone-400 focus-within:ring-2 focus-within:ring-stone-400/10 dark:border-stone-700 dark:bg-stone-800 dark:focus-within:border-stone-500 dark:focus-within:ring-stone-500/20">
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
              disabled={!userId || loading || applying || !query.trim()}
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

        {/* Master-Detail Split Pane */}
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-3 sm:gap-4 overflow-hidden">
          {/* Left Column: Candidates list (compact and snug, leaving generous room for right details) */}
          <div className="w-full sm:w-[40%] md:w-[38%] shrink-0 flex flex-col min-h-0 border-b sm:border-b-0 sm:border-r border-stone-200/70 dark:border-stone-800 pb-3 sm:pb-0 pr-0 sm:pr-3">
            {loading && !loadingDetailId ? (
              <div
                role="status"
                aria-label={_('metadataLookup.searching')}
                className="flex-1 min-h-0 space-y-2 overflow-hidden"
              >
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex w-full items-start gap-2.5 rounded-xl border border-stone-200/70 bg-stone-50/40 p-2 dark:border-stone-800/70 dark:bg-stone-900/40"
                  >
                    <div className="h-[68px] w-[48px] shrink-0 animate-pulse rounded-md bg-stone-200/70 dark:bg-stone-800 motion-reduce:animate-none" />
                    <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                      <div
                        className="h-3.5 animate-pulse rounded-md bg-stone-200/80 dark:bg-stone-800 motion-reduce:animate-none"
                        style={{ width: i === 1 ? '60%' : i === 2 ? '75%' : '48%' }}
                      />
                      <div
                        className="h-3 animate-pulse rounded bg-stone-200/60 dark:bg-stone-800/70 motion-reduce:animate-none"
                        style={{ width: i === 1 ? '30%' : i === 2 ? '38%' : '24%' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : searched && results.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-xs text-stone-400 p-4 text-center">
                {_('metadataLookup.noResults')}
              </div>
            ) : results.length > 0 ? (
              <div className="flex-1 min-h-0 space-y-2 overflow-y-auto no-scrollbar pb-2 pr-1">
                {results.map((result) => {
                  const isChosen = selected?.id === result.id
                  const isItemLoading = loadingDetailId === result.id
                  const title = result.title
                  return (
                    <button
                      key={result.id}
                      type="button"
                      disabled={loading || applying}
                      onClick={() => void select(result)}
                      className={`group flex w-full gap-3 rounded-xl border p-2.5 text-left transition-all ${
                        isChosen || isItemLoading
                          ? 'border-stone-900 bg-stone-50 shadow-xs ring-1 ring-stone-900/10 dark:border-stone-100 dark:bg-stone-800/80 dark:ring-stone-100/20'
                          : 'border-stone-200/90 bg-white hover:border-stone-300 hover:bg-stone-50/70 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 dark:hover:bg-stone-800'
                      }`}
                    >
                      <ResultCover src={result.coverUrl} provider={result.provider} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-1">
                          <div className="font-medium text-xs sm:text-sm text-stone-900 dark:text-stone-100 line-clamp-2 leading-snug">
                            {title}
                          </div>
                          {isItemLoading && (
                            <svg className="size-3.5 shrink-0 animate-spin text-stone-600 dark:text-stone-300 mt-0.5" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          )}
                        </div>

                        <div className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                          <span className="line-clamp-1">
                            {result.authors.join('、') || _('common.unknownAuthor')}
                          </span>
                          {result.published && (
                            <>
                              <span className="opacity-40">·</span>
                              <span className="shrink-0">{result.published}</span>
                            </>
                          )}
                        </div>

                        {result.description && (
                          <p className="mt-1 line-clamp-1 text-xs text-stone-400 dark:text-stone-500 [overflow-wrap:anywhere]">
                            {result.description}
                          </p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-xs text-stone-400 p-4 text-center">
                {_('metadataLookup.privacy')}
              </div>
            )}
          </div>

          {/* Right Column: Full Detail Preview (takes 46%, natural vertical scrolling) */}
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto no-scrollbar pl-0 sm:pl-1">
            {loadingDetailId ? (
              <div
                role="status"
                aria-label={_('metadataLookup.loadingDetail')}
                className="flex flex-col space-y-3.5 p-1 animate-pulse motion-reduce:animate-none"
              >
                <div className="flex gap-3">
                  <div className="h-[104px] w-[74px] shrink-0 rounded-lg bg-stone-200/70 dark:bg-stone-800" />
                  <div className="min-w-0 flex-1 space-y-2 pt-1">
                    <div className="h-5 w-3/4 rounded-md bg-stone-200/80 dark:bg-stone-800" />
                    <div className="h-3.5 w-1/2 rounded bg-stone-200/60 dark:bg-stone-800/70" />
                    <div className="flex gap-1.5 pt-2">
                      <div className="h-5 w-16 rounded-md bg-stone-200/50 dark:bg-stone-800/50" />
                      <div className="h-5 w-12 rounded-md bg-stone-200/50 dark:bg-stone-800/50" />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-stone-200/60 bg-stone-50/50 p-3 dark:border-stone-800/60 dark:bg-stone-800/30">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="h-7 rounded bg-stone-200/50 dark:bg-stone-800/50" />
                    <div className="h-7 rounded bg-stone-200/50 dark:bg-stone-800/50" />
                  </div>
                </div>
                <div className="space-y-2 pt-1">
                  <div className="h-3 w-16 rounded bg-stone-200/60 dark:bg-stone-800/70" />
                  <div className="h-3 w-full rounded bg-stone-200/40 dark:bg-stone-800/40" />
                  <div className="h-3 w-full rounded bg-stone-200/40 dark:bg-stone-800/40" />
                  <div className="h-3 w-4/5 rounded bg-stone-200/40 dark:bg-stone-800/40" />
                </div>
              </div>
            ) : selected ? (
              <div className="flex flex-col space-y-3.5 p-1">
                {/* Header section (modeled after DetailHeader) */}
                <div className="flex gap-3">
                  <div className="relative h-[104px] w-[74px] shrink-0 overflow-hidden rounded-lg border border-stone-200/80 bg-stone-100 shadow-2xs dark:border-stone-700/80 dark:bg-stone-800 self-start">
                    <ResultCoverLarge
                      src={selected.coverUrl}
                      provider={selected.provider}
                      fallbackSrc={results.find((r) => r.id === selected.id)?.coverUrl}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1.5">
                      <h3 className="font-serif text-base sm:text-lg font-semibold leading-snug text-stone-900 dark:text-stone-100 line-clamp-3 break-words">
                        {selected.title}
                      </h3>
                      {selected.sourceUrl && (
                        <a
                          href={selected.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={_('metadataLookup.source')}
                          title={_('metadataLookup.source')}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200 transition-colors"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </a>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300">
                      <span className="font-medium">
                        {selected.authors.join('、') || _('common.unknownAuthor')}
                      </span>
                      {selected.published && (
                        <>
                          <span className="text-stone-300 dark:text-stone-600">·</span>
                          <span className="text-stone-500 dark:text-stone-400">{selected.published}</span>
                        </>
                      )}
                    </div>

                    {/* Classification chips: Category & Tags */}
                    {(selected.category || (selected.tags && selected.tags.length > 0)) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {selected.category && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-400 dark:text-stone-500">
                              <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
                            </svg>
                            <span>{selected.category}</span>
                          </span>
                        )}
                        {selected.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-md bg-stone-100/80 px-1.5 py-0.5 text-xs text-stone-600 dark:bg-stone-800/80 dark:text-stone-400"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Meta Grid (modeled after MetaGrid.tsx) */}
                {(() => {
                  const metaRows: { label: string; value: string }[] = []
                  if (!limited) {
                    if (selected.publisher) metaRows.push({ label: _('library.publisher'), value: selected.publisher })
                    if (selected.published) metaRows.push({ label: _('library.published'), value: selected.published })
                    if (selected.isbn) metaRows.push({ label: 'ISBN', value: selected.isbn })
                    if (selected.language) metaRows.push({ label: _('library.language'), value: selected.language })
                    if (selected.series) {
                      metaRows.push({
                        label: _('library.seriesSection'),
                        value: selected.seriesIndex ? `${selected.series} (${selected.seriesIndex})` : selected.series,
                      })
                    }
                  }
                  if (metaRows.length === 0) return null
                  return (
                    <div className="mt-2 rounded-xl border border-stone-200/70 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-800/40">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        {metaRows.map((row) => (
                          <div key={row.label} className="min-w-0">
                            <dt className="text-stone-400 dark:text-stone-500">{row.label}</dt>
                            <dd className="mt-0.5 font-medium text-stone-700 dark:text-stone-200 truncate" title={row.value}>
                              {row.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )
                })()}

                {/* Description Section (modeled after DescriptionSection.tsx) */}
                {!limited && selected.description && (
                  <section className="mt-3">
                    <div className="text-xs font-medium text-stone-400 dark:text-stone-500 mb-1">
                      {_('library.descriptionSection')}
                    </div>
                    <p className="font-serif text-xs sm:text-sm leading-relaxed text-stone-600 dark:text-stone-300 whitespace-pre-wrap break-words">
                      {selected.description}
                    </p>
                  </section>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-stone-400 dark:text-stone-500">
                <svg
                  className="size-10 mb-2 opacity-30"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                  />
                </svg>
                <span className="text-xs">{_('metadataLookup.selectHint')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
