import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useTranslation } from '@/hooks/useTranslation'

import { dictionaryDocument } from '../lib/dictionary-document'

interface DictionaryDefinitionProps { id: string; html: string; onNavigate: (word: string) => void }

export default function DictionaryDefinition({ id, html, onNavigate }: DictionaryDefinitionProps) {
  const _ = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const content = useQuery({
    queryKey: ['dictionary-document', id, html],
    queryFn: async ({ signal }) => {
      await Promise.resolve()
      signal.throwIfAborted()
      const style = getComputedStyle(root.current ?? document.documentElement)
      return dictionaryDocument(html, id, signal, {
        bg: style.getPropertyValue('--bd-read-bg').trim() || 'Canvas',
        fg: style.getPropertyValue('--bd-read-text').trim() || 'CanvasText',
        accent: style.getPropertyValue('--bd-read-primary').trim() || 'LinkText',
      })
    }, retry: false, gcTime: 0,
  })
  return <div ref={root} className="min-h-0 flex-1">
    {content.data ? <iframe title={_('dictionary.title')} sandbox="allow-same-origin" srcDoc={content.data} className="h-full w-full border-0" onLoad={(event) => {
      const frame = event.currentTarget.contentDocument
      if (!frame) return
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
          const audio = new Audio(anchor.dataset.soundSrc)
          audio.play().catch(() => {})
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
            const audio = new Audio(anchor.dataset.soundSrc)
            audio.play().catch(() => {})
          }
        }
      })
    }} /> : <p role="status" className="p-4 text-xs text-[var(--bd-read-sub)]">{_(content.isError ? 'dictionary.failed' : 'dictionary.loading')}</p>}
  </div>
}
