import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { FontListItem } from '@bookdock/shared'

import { useFonts, useDeleteFont, useUpdateFontScope } from '@/api/hooks/useFonts'
import i18n from '../i18n/i18n'
import FontsSettingsSection from '../features/settings/components/FontsSettingsSection'
import { useAuthStore } from '../stores/auth.store'
import { useUiStore } from '../stores/ui.store'

vi.mock('@/api/hooks/useFonts', () => ({
  useFonts: vi.fn(() => ({ data: { data: [] } })),
  useUploadFont: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteFont: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateFontScope: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
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
    useUiStore.setState({ fontPreferences: {}, fontOrder: [], fontFamily: 'serif' })
    vi.mocked(useDeleteFont).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useDeleteFont>)
    vi.mocked(useUpdateFontScope).mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false } as unknown as ReturnType<typeof useUpdateFontScope>)
    mockFonts(fonts)
  })

  it('renders uploaded, builtin and system fonts in one catalog', () => {
    render(<FontsSettingsSection />)

    expect(screen.getByText('我的手写体')).toBeInTheDocument()
    expect(screen.getByText('Instance Serif')).toBeInTheDocument()
    expect(screen.getByText('霞鹜文楷')).toBeInTheDocument()
    expect(screen.getByText('宋体')).toBeInTheDocument()
    expect(screen.getByText('· 9')).toBeInTheDocument()
    expect(screen.queryByText('ttf')).not.toBeInTheDocument()
    expect(screen.queryByText('woff2')).not.toBeInTheDocument()
    expect(screen.queryByText('2.0 MB')).not.toBeInTheDocument()
    expect(screen.queryByText('512 KB')).not.toBeInTheDocument()
    expect(screen.getByText('个人')).toBeInTheDocument()
    expect(screen.getByText('实例')).toBeInTheDocument()
    expect(screen.getAllByText('内置')).toHaveLength(3)
    expect(screen.getAllByText('系统')).toHaveLength(4)
    expect(screen.getAllByText('自定义')).toHaveLength(2)
  })

  it('orders system, builtin and uploaded fonts, keeps switches at the trailing edge, and places builtin loading beside the name', () => {
    render(<FontsSettingsSection />)

    const rows = Array.from(document.querySelectorAll('ul > li')).filter((row) =>
      ['宋体', '霞鹜文楷', '我的手写体'].includes(row.querySelector('p')?.textContent?.trim() ?? ''),
    )
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('宋体'),
      expect.stringContaining('霞鹜文楷'),
      expect.stringContaining('我的手写体'),
    ])
    expect(rows[0]?.querySelector('button[aria-label="编辑字体"]')).toBeNull()
    expect(rows[1]?.querySelector('button[aria-label="编辑字体"]')).toBeNull()
    expect(rows[2]?.querySelector('button[aria-label="编辑字体"]')).toBeNull()
    expect(rows[1]?.querySelector('button[aria-label="加载字体"]')?.parentElement).toBe(rows[1]?.querySelector('p')?.parentElement)
    expect(rows[1]?.querySelector('button[role="switch"]')?.parentElement).toBe(rows[1]?.lastElementChild)
    expect(Array.from(rows[2]?.children ?? []).filter((child) => child.tagName === 'SPAN').map((child) => child.textContent)).toEqual(['个人', '自定义'])
    expect(rows[2]?.querySelector('button[role="switch"]')).toBe(rows[2]?.lastElementChild?.lastElementChild)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    expect(rows[0]?.querySelector('button[aria-label="编辑字体"]')).toBeNull()
    expect(rows[1]?.querySelector('button[aria-label="编辑字体"]')).toBeNull()
    expect(rows[2]?.querySelector('button[aria-label="编辑字体"]')).toBeTruthy()
  })

  it('uses the saved order and exposes reorder handles only while sorting', () => {
    useUiStore.setState({ fontOrder: ['f1', 'serif', 'lxgw-wenkai'] })
    render(<FontsSettingsSection />)

    const rows = Array.from(document.querySelectorAll('ul > li'))
    expect(rows.slice(0, 3).map((row) => row.querySelector('p')?.textContent?.trim())).toEqual([
      '我的手写体',
      '宋体',
      '霞鹜文楷',
    ])
    expect(screen.queryAllByRole('button', { name: '调整字体顺序' })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    expect(screen.getAllByRole('button', { name: '调整字体顺序' })).toHaveLength(9)
    fireEvent.click(screen.getByRole('button', { name: '保存排序并退出编辑模式' }))
    expect(screen.queryAllByRole('button', { name: '调整字体顺序' })).toHaveLength(0)
  })

  it('keeps the built-in catalog visible when no fonts are uploaded', () => {
    mockFonts([])
    render(<FontsSettingsSection />)

    expect(screen.getByText('霞鹜文楷')).toBeInTheDocument()
    expect(screen.getByText('宋体')).toBeInTheDocument()
    expect(screen.queryByText('我的手写体')).not.toBeInTheDocument()
  })

  it('hides scope editing and other people\'s delete button for non-owners', () => {
    render(<FontsSettingsSection />)

    expect(screen.queryByText('转为实例')).not.toBeInTheDocument()
    expect(screen.queryByText('转为个人')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: '删除' })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(1)
  })

  it('lets the owner edit the uploaded font scope', async () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'owner', role: 'owner' } })
    const updateScope = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
    vi.mocked(useUpdateFontScope).mockReturnValue(updateScope as unknown as ReturnType<typeof useUpdateFontScope>)
    render(<FontsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getAllByRole('button', { name: '编辑字体' })[0])
    expect(screen.getByText('hand.ttf')).toBeInTheDocument()
    expect(screen.queryByText('类型')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '实例' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(updateScope.mutateAsync).toHaveBeenCalledWith({ id: 'f1', scope: 'instance' }))
  })

  it('toggles visibility and persists a per-user font preference', () => {
    render(<FontsSettingsSection />)

    const customRow = Array.from(document.querySelectorAll('ul > li')).find((row) => row.querySelector('p')?.textContent?.trim() === '我的手写体')!
    fireEvent.click(customRow.querySelector('[role="switch"]')!)

    expect(useUiStore.getState().fontPreferences.f1).toEqual({ enabled: false })
  })

  it('deletes a font after confirmation', () => {
    const deleteFont = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDeleteFont).mockReturnValue(deleteFont as unknown as ReturnType<typeof useDeleteFont>)
    render(<FontsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])
    expect(screen.getByText('确定要删除字体“我的手写体”吗？')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!)
    expect(deleteFont.mutate).toHaveBeenCalledWith('f1', expect.objectContaining({ onError: expect.any(Function) }))
  })

  it('does not delete when the confirmation is cancelled', () => {
    const deleteFont = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDeleteFont).mockReturnValue(deleteFont as unknown as ReturnType<typeof useDeleteFont>)
    render(<FontsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(deleteFont.mutate).not.toHaveBeenCalled()
  })

  it('opens the hidden file picker from the upload button', () => {
    render(<FontsSettingsSection />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.accept).toBe('.ttf,.otf,.woff,.woff2')
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: '上传字体' }))
    expect(clickSpy).toHaveBeenCalled()
  })
})
