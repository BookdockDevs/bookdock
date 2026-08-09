import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { FontListItem } from '@bookdock/shared'

import { useFonts, useDeleteFont, useUpdateFontScope } from '@/api/hooks/useFonts'
import i18n from '../i18n/i18n'
import FontsSettingsSection from '../features/settings/components/FontsSettingsSection'
import { useAuthStore } from '../stores/auth.store'

vi.mock('@/api/hooks/useFonts', () => ({
  useFonts: vi.fn(() => ({ data: { data: [] } })),
  useUploadFont: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteFont: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateFontScope: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

const fonts: FontListItem[] = [
  { id: 'f1', family: '我的手写体', fileName: 'hand.ttf', format: 'ttf', size: 2 * 1024 * 1024, scope: 'user', mine: true, createdAt: 0 },
  { id: 'f2', family: 'Instance Serif', fileName: 'serif.woff2', format: 'woff2', size: 512 * 1024, scope: 'instance', mine: false, createdAt: 0 },
]

const mockFonts = (list: FontListItem[]) => {
  vi.mocked(useFonts).mockReturnValue({ data: { data: list } } as ReturnType<typeof useFonts>)
}

describe('FontsSettingsSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useAuthStore.setState({ user: null })
    mockFonts(fonts)
  })

  it('renders the font list with format, size and scope badges', () => {
    render(<FontsSettingsSection />)

    expect(screen.getByText('我的手写体')).toBeInTheDocument()
    expect(screen.getByText('Instance Serif')).toBeInTheDocument()
    expect(screen.getByText('ttf')).toBeInTheDocument()
    expect(screen.getByText('woff2')).toBeInTheDocument()
    expect(screen.getByText('2.0 MB')).toBeInTheDocument()
    expect(screen.getByText('512 KB')).toBeInTheDocument()
    expect(screen.getByText('个人')).toBeInTheDocument()
    expect(screen.getByText('实例')).toBeInTheDocument()
  })

  it('shows the empty hint when no fonts are uploaded', () => {
    mockFonts([])
    render(<FontsSettingsSection />)

    expect(screen.getByText(/还没有上传的字体/)).toBeInTheDocument()
  })

  it('hides the scope toggle and other people\'s delete button for non-owners', () => {
    render(<FontsSettingsSection />)

    expect(screen.queryByText('转为实例')).not.toBeInTheDocument()
    expect(screen.queryByText('转为个人')).not.toBeInTheDocument()
    // f1 is mine → deletable; f2 is someone else's → no delete button
    expect(screen.getAllByText('删除')).toHaveLength(1)
  })

  it('lets the owner toggle scope and delete any font', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'owner', role: 'owner' } })
    const updateScope = { mutate: vi.fn(), isPending: false }
    vi.mocked(useUpdateFontScope).mockReturnValue(updateScope as unknown as ReturnType<typeof useUpdateFontScope>)
    render(<FontsSettingsSection />)

    expect(screen.getAllByText('删除')).toHaveLength(2)
    fireEvent.click(screen.getByText('转为实例'))
    expect(updateScope.mutate).toHaveBeenCalledWith(
      { id: 'f1', scope: 'instance' },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('deletes a font after confirmation', () => {
    const deleteFont = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDeleteFont).mockReturnValue(deleteFont as unknown as ReturnType<typeof useDeleteFont>)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<FontsSettingsSection />)

    fireEvent.click(screen.getByText('删除'))
    expect(window.confirm).toHaveBeenCalled()
    expect(deleteFont.mutate).toHaveBeenCalledWith('f1', expect.objectContaining({ onError: expect.any(Function) }))
  })

  it('does not delete when the confirmation is cancelled', () => {
    const deleteFont = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDeleteFont).mockReturnValue(deleteFont as unknown as ReturnType<typeof useDeleteFont>)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<FontsSettingsSection />)

    fireEvent.click(screen.getByText('删除'))
    expect(deleteFont.mutate).not.toHaveBeenCalled()
  })

  it('opens the hidden file picker from the upload button', () => {
    render(<FontsSettingsSection />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.accept).toBe('.ttf,.otf,.woff,.woff2')
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByText('上传字体'))
    expect(clickSpy).toHaveBeenCalled()
  })
})
