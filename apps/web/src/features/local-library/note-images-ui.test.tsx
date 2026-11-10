import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'

import type { AnnotationUpdateReq } from '@bookdock/shared'

import { apiDelete, apiUpload } from '@/api/client'
import IdeaImageEditor from '@/features/content-files/components/IdeaImageEditor'
import { LocalReaderContext, type LocalReaderSession } from '@/features/reading-data/reader-source-context'

import { localLibraryRepository as repository } from './repository'

vi.mock('@/api/client', () => ({ apiDelete: vi.fn(), apiUpload: vi.fn() }))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
afterEach(async () => { cleanup(); await repository.close(); onlineManager.setOnline(true); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('uses the common image editor offline without a Server book ID and releases Blob URLs after saving', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  const createUrl = vi.fn(() => 'blob:local-image')
  const revokeUrl = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl })
  const ref = { scope: { kind: 'local' as const, vaultId: 'image-ui' }, bookId: 'book' }
  await repository.addBook({ ref, content: { book: ref, contentId: 'before' }, format: 'epub', title: 'Book', authors: [], availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }, new Blob(['abc']))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let association: Pick<AnnotationUpdateReq, 'imageIds' | 'draftId'> = {}
  onlineManager.setOnline(false)
  const view = render(<QueryClientProvider client={client}><LocalReaderContext.Provider value={{ ref } as LocalReaderSession}><IdeaImageEditor onChange={(value) => { association = value }} /></LocalReaderContext.Provider></QueryClientProvider>)
  const file = new NativeFile([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'image.png', { type: 'image/png' })
  fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [file] } })
  await waitFor(() => expect(association.imageIds).toHaveLength(1))
  await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:local-image'))
  const saved = await repository.saveNote({ id: 'note', book: ref, kind: 'idea', body: '', text: '', locator: null, chapter: null, createdAt: 1, updatedAt: 1, version: 0 }, 0, [], association)
  view.unmount()
  await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:local-image'))
  expect(saved.kind === 'idea' && saved.images?.length).toBe(1)
  await expect(repository.readNoteImage(ref, association.imageIds![0]!)).resolves.toHaveProperty('size', 9)
  expect(apiUpload).not.toHaveBeenCalled(); expect(apiDelete).not.toHaveBeenCalled()
  client.clear()
})
