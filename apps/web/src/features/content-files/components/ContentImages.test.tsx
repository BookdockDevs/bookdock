import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { ContentFile } from '@bookdock/shared'

import ContentImages from './ContentImages'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

it('retries the same managed image after an unavailable response without opening the parent card', () => {
  const image: ContentFile = { id: 'cfile_abcdefghijklmnopqrstu', kind: 'image', name: 'sample.png', mimeType: 'image/webp', size: 100, url: '/api/v1/content-files/cfile_abcdefghijklmnopqrstu' }
  const openCard = vi.fn()
  render(<div onClick={openCard}><ContentImages images={[image]} /></div>)
  fireEvent.error(screen.getByRole('img', { name: 'sample.png' }))
  expect(screen.queryByRole('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'contentFiles.retry' }))
  expect(openCard).not.toHaveBeenCalled()
  expect(screen.getByRole('img', { name: 'sample.png' })).toHaveAttribute('src', image.url)
  expect(screen.queryByRole('status')).toBeNull()
})
