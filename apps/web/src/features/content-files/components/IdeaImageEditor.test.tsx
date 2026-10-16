import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { ContentFile } from '@bookdock/shared'

import IdeaImageEditor from './IdeaImageEditor'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

const draftState = vi.hoisted(() => ({
  entries: [] as Array<{ id: string; file: File; kind: 'image'; progress: number; status: 'uploading' | 'ready' | 'failed' }>,
  add: vi.fn(),
  retry: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('../hooks/useContentDraft', () => ({
  useContentDraft: () => ({
    draftId: 'draft-idea-test',
    entries: draftState.entries,
    add: draftState.add,
    retry: draftState.retry,
    dismiss: draftState.dismiss,
    uploading: false,
  }),
}))

const readyImage: ContentFile = {
  id: 'cfile_abcdefghijklmnopqrstu',
  kind: 'image',
  name: 'ready.png',
  mimeType: 'image/png',
  size: 100,
  url: '/api/v1/content-files/cfile_abcdefghijklmnopqrstu',
}

function renderEditor(images: ContentFile[] = []) {
  const onChange = vi.fn()
  render(
    <IdeaImageEditor
      bookVersionId="v1"
      initialImages={images}
      onChange={onChange}
    />,
  )
  return onChange
}

it('shows ready images in a grid with hover remove and no filename rows or limits copy', () => {
  renderEditor([readyImage])
  expect(screen.getByRole('img', { name: 'ready.png' })).toBeTruthy()
  // Icon-only upload trigger, no format/size hint text
  expect(screen.getByRole('button', { name: 'contentFiles.addImage' })).toBeTruthy()
  expect(screen.queryByText(/5 MB|JPEG/i)).toBeNull()
  // No filename + remove rows
  expect(screen.queryByText('ready.png')).toBeNull()
})

it('detaches an image through the hover close button and reports the remaining ids', () => {
  const onChange = renderEditor([readyImage])
  fireEvent.click(screen.getByRole('button', { name: 'contentFiles.remove' }))
  expect(screen.queryByRole('img', { name: 'ready.png' })).toBeNull()
  expect(onChange).toHaveBeenLastCalledWith({ imageIds: [], draftId: 'draft-idea-test' }, false)
})

it('routes chosen files through validation without touching parent text state', () => {
  draftState.add.mockClear()
  renderEditor([])
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['x'.repeat(10)], 'paste.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
  expect(draftState.add).toHaveBeenCalledTimes(1)
  expect(draftState.add).toHaveBeenCalledWith(file, 'image')
})
