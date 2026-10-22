import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { ContentFile } from '@bookdock/shared'

import AnnotationInlineEditor from './AnnotationInlineEditor'

const draft = vi.hoisted(() => ({
  draftId: 'draft-edit', entries: [], uploading: false,
  add: vi.fn(), retry: vi.fn(), dismiss: vi.fn(),
}))

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('@/features/content-files/hooks/useContentDraft', () => ({ useContentDraft: () => draft }))

const image: ContentFile = {
  id: 'image-1', kind: 'image', name: 'idea.png', mimeType: 'image/png', size: 100,
  url: '/api/v1/content-files/image-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  draft.uploading = false
})

it('opens the existing image picker from the footer and saves image removal with the draft and visibility', () => {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(<AnnotationInlineEditor initial="Idea text" placeholder="Idea" saving={false} error={null}
    onSave={onSave} onCancel={onCancel} bookVersionId="version-1" targetId="idea-1"
    initialImages={[image]} visibilityEligible sourceReadable initialVisibility="shared" />)

  expect(screen.getByText('1 / 9')).toBeInTheDocument()
  const picker = document.querySelector('input[type="file"]') as HTMLInputElement
  const click = vi.spyOn(picker, 'click')
  fireEvent.click(screen.getByRole('button', { name: 'contentFiles.addImage' }))
  expect(click).toHaveBeenCalledOnce()
  expect(onCancel).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'contentFiles.remove' }))
  expect(screen.getByText('0 / 9')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'annotation.save' }))
  expect(onSave).toHaveBeenCalledWith('Idea text', 'shared', { imageIds: [], draftId: 'draft-edit' })
})

it('blocks footer image selection and saving while an upload is pending', () => {
  draft.uploading = true
  const onSave = vi.fn()
  render(<AnnotationInlineEditor initial="Idea text" placeholder="Idea" saving={false} error={null}
    onSave={onSave} onCancel={vi.fn()} bookVersionId="version-1" />)
  expect(screen.getByRole('button', { name: 'contentFiles.addImage' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'annotation.save' })).toBeDisabled()
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
  expect(onSave).not.toHaveBeenCalled()
})

it('keeps text-only app editing available without image or visibility tools', () => {
  const onSave = vi.fn()
  render(<AnnotationInlineEditor initial="Old title" placeholder="Title" saving={false} error={null}
    onSave={onSave} onCancel={vi.fn()} allowEmpty theme="app" />)
  expect(screen.queryByRole('button', { name: 'contentFiles.addImage' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: ' New title ' } })
  fireEvent.click(screen.getByRole('button', { name: 'annotation.save' }))
  expect(onSave).toHaveBeenCalledWith('New title', undefined, undefined)
})
