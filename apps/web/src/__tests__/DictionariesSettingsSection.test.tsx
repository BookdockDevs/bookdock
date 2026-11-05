import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DictionaryList } from '@bookdock/shared'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('../api/client', async (original) => ({ ...await original<typeof import('../api/client')>(), apiGet: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(), apiUpload: vi.fn() }))

import { apiDelete, apiGet, apiPatch, apiUpload } from '../api/client'
import DictionariesSettingsSection from '../features/settings/components/DictionariesSettingsSection'

const data: DictionaryList = {
  items: [
    {
      id: 'dict-one',
      name: 'Test dictionary',
      enabled: true,
      size: 1024,
      fileNames: ['test.mdx'],
      createdAt: 1,
      scope: 'user',
      mine: true,
    },
  ],
  lastUsedId: null,
}

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <DictionariesSettingsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockResolvedValue({ data })
  vi.mocked(apiPatch).mockResolvedValue({ data })
  vi.mocked(apiDelete).mockResolvedValue({ data: null })
  vi.mocked(apiUpload).mockResolvedValue({ data: data.items[0] })
})

describe('dictionary management using existing settings components', () => {
  it('uses the standard toggle and edit mode and preserves a failed deletion dialog', async () => {
    mount()
    await screen.findByText('Test dictionary')
    fireEvent.click(screen.getByRole('switch', { name: 'Test dictionary' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/dictionaries/dict-one', { enabled: false }))
    await waitFor(() => expect(screen.getByLabelText('settings.editModeEnter')).not.toBeDisabled())
    fireEvent.click(screen.getByLabelText('settings.editModeEnter'))
    fireEvent.click(screen.getByLabelText('dictionary.delete'))
    vi.mocked(apiDelete).mockRejectedValueOnce(new Error('Failed'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'settings.confirmDeleteAction' }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledOnce())
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'settings.confirmDeleteAction' })).not.toBeDisabled())
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'settings.confirmDeleteAction' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('opens dictionary editor to rename and update scope', async () => {
    mount()
    await screen.findByText('Test dictionary')
    fireEvent.click(screen.getByLabelText('settings.editModeEnter'))
    fireEvent.click(screen.getByLabelText('dictionary.edit'))
    const modal = screen.getByRole('dialog')
    expect(modal).toBeInTheDocument()
    const input = within(modal).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Renamed Oxford' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'library.save' }))
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/dictionaries/dict-one', {
        name: 'Renamed Oxford',
        scope: 'user',
        enabled: undefined,
      }),
    )
  })

  it('imports immediately after selection and permits selecting the same file after failure', async () => {
    let rejectUpload!: (error: Error) => void
    vi.mocked(apiUpload).mockReturnValueOnce(new Promise((_resolve, reject) => { rejectUpload = reject }))
    const view = mount()
    await screen.findByText('Test dictionary')
    const input = view.container.querySelector('input[type="file"]')!
    const files = [new File(['fixture'], 'sample.mdx')]
    fireEvent.change(input, { target: { files } })
    await waitFor(() => expect(apiUpload).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dictionary.importing' })).toBeDisabled()
    expect(vi.mocked(apiUpload).mock.calls[0]![1].getAll('files')).toEqual(files)
    rejectUpload(new Error('Failed'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'dictionary.import' })).not.toBeDisabled())
    fireEvent.change(input, { target: { files } })
    await waitFor(() => expect(apiUpload).toHaveBeenCalledTimes(2))
  })

  it('does not upload cancelled or invalid selections', async () => {
    const view = mount()
    await screen.findByText('Test dictionary')
    const input = view.container.querySelector('input[type="file"]')!
    fireEvent.change(input, { target: { files: [] } })
    fireEvent.change(input, { target: { files: [new File(['fixture'], 'sample.mdd')] } })
    expect(apiUpload).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
