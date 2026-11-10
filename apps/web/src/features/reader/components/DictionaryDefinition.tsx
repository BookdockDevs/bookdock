import { useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { assertSessionEpoch, getSessionEpoch } from '@/lib/session-scope'
import { useAuthStore } from '@/stores/auth.store'

import { dictionaryDocument } from '../lib/dictionary-document'

interface DictionaryDefinitionProps { accountId: string; id: string; html: string; onNavigate: (word: string) => void }

function releaseMedia(media: HTMLMediaElement) {
  media.pause()
  media.removeAttribute('src')
  for (const source of media.querySelectorAll('source')) source.removeAttribute('src')
  media.load()
}

export default function DictionaryDefinition({ accountId, id, html, onNavigate }: DictionaryDefinitionProps) {
  const _ = useTranslation()
  const currentAccountId = useAuthStore((state) => state.user?.id ?? null)
  const available = currentAccountId === accountId
  const root = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const embeddedMedia = useRef<HTMLMediaElement[]>([])
  const stopMedia = useCallback(() => {
    const audio = audioRef.current
    audioRef.current = null
    if (audio) releaseMedia(audio)
    for (const media of embeddedMedia.current) releaseMedia(media)
    embeddedMedia.current = []
  }, [])
  useEffect(() => stopMedia, [accountId, currentAccountId, stopMedia])
  const playSound = (url: string) => {
    if (useAuthStore.getState().user?.id !== accountId) return
    const previous = audioRef.current
    audioRef.current = null
    if (previous) releaseMedia(previous)
    const audio = new Audio(url)
    audioRef.current = audio
    void audio.play().catch((error) => {
      if (audioRef.current === audio && useAuthStore.getState().user?.id === accountId && error?.name !== 'AbortError') notify.warning({ key: 'dictionary.audioFailed' })
    })
  }
  const content = useQuery({
    queryKey: ['dictionary-document', 'account', accountId, id, html],
    queryFn: async ({ signal }) => {
      if (useAuthStore.getState().user?.id !== accountId) throw new DOMException('Dictionary account changed', 'AbortError')
      const epoch = getSessionEpoch()
      await Promise.resolve()
      signal.throwIfAborted()
      const style = getComputedStyle(root.current ?? document.documentElement)
      const markup = await dictionaryDocument(html, id, signal, {
        bg: style.getPropertyValue('--bd-read-bg').trim() || 'Canvas',
        fg: style.getPropertyValue('--bd-read-text').trim() || 'CanvasText',
        accent: style.getPropertyValue('--bd-read-primary').trim() || 'LinkText',
      })
      signal.throwIfAborted()
      assertSessionEpoch(epoch)
      return markup
    }, enabled: available, retry: false, gcTime: 0,
  })
  return <div ref={root} className="min-h-0 flex-1">
    {available && content.data ? <iframe title={_('dictionary.title')} sandbox="allow-same-origin" srcDoc={content.data} className="h-full w-full border-0" onLoad={(event) => {
      stopMedia()
      const frame = event.currentTarget.contentDocument
      if (!frame) return
      embeddedMedia.current = [...frame.querySelectorAll<HTMLMediaElement>('audio')]
      frame.addEventListener('pointerdown', () => { document.dispatchEvent(new CustomEvent('content-click')) })
      frame.addEventListener('click', (click) => {
        document.dispatchEvent(new CustomEvent('content-click'))
        const anchor = (click.target as Element)?.closest?.('a')
        if (!anchor) return
        if (anchor.dataset.dictionaryEntry) {
          click.preventDefault()
          onNavigate(anchor.dataset.dictionaryEntry)
        } else if (anchor.dataset.soundSrc) {
          click.preventDefault()
          playSound(anchor.dataset.soundSrc)
        } else if (!anchor.getAttribute('href')?.startsWith('#')) {
          click.preventDefault()
        }
      })
      frame.addEventListener('auxclick', (click) => click.preventDefault())
      frame.addEventListener('keydown', (key) => {
        if (key.key === 'Escape') {
          key.preventDefault()
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        } else if (key.key === 'Enter' || key.key === ' ') {
          const anchor = (key.target as Element)?.closest?.('a')
          if (anchor?.dataset.soundSrc) {
            key.preventDefault()
            playSound(anchor.dataset.soundSrc)
          }
        }
      })
    }} /> : <p role="status" className="p-4 text-xs text-[var(--bd-read-sub)]">{_(content.isError ? 'dictionary.failed' : 'dictionary.loading')}</p>}
  </div>
}
