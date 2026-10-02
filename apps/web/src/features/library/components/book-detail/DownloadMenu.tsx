import type { BookFormat } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { useDownloadStore } from '@/stores/download.store'

import { ActionIcon } from './ui'

interface DownloadMenuProps {
  bookId: string
  title: string
  format: BookFormat
  versionLabel?: string
}

export default function DownloadMenu({ bookId, title, format, versionLabel }: DownloadMenuProps) {
  const _ = useTranslation()
  return (
    <ActionIcon secondary label={_('library.download')} onClick={() => useDownloadStore.getState().open({ id: bookId, title, format, versionLabel })}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </ActionIcon>
  )
}
