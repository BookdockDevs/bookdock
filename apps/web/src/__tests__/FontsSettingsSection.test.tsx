import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { FontListItem } from '@bookdock/shared'

import { IDBFactory } from 'fake-indexeddb'
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { useFonts, useDeleteFont, useUpdateFontScope, useUploadFont } from '@/api/hooks/useFonts'
import { useDeviceFontStore } from '../features/device-fonts/store'
import type { DeviceFontMeta } from '../features/device-fonts/db'
import i18n from '../i18n/i18n'
import { notify } from '@/lib/notifications'
import FontsSettingsSection from '../features/settings/components/FontsSettingsSection'
import { useAuthStore } from '../stores/auth.store'
import { useUiStore } from '../stores/ui.store'

vi.mock('@/api/hooks/useFonts', () => ({
  useFonts: vi.fn(() => ({ data: { data: [] } })),
  useUploadFont: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteFont: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateFontScope: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

const fonts: FontListItem[] = [
  { id: 'f1', family: '我的手写体', fileName: 'hand.ttf', format: 'ttf', size: 2 * 1024 * 1024, scope: 'user', mine: true, createdAt: 0 },
  { id: 'f2', family: 'Instance Serif', fileName: 'serif.woff2', format: 'woff2', size: 512 * 1024, scope: 'instance', mine: false, createdAt: 0 },
]

const mockFonts = (list: FontListItem[]) => {
  vi.mocked(useFonts).mockReturnValue({ data: { data: list } } as ReturnType<typeof useFonts>)
}

const deviceFont: DeviceFontMeta = {
  id: 'device-row1',
  family: 'Device SimSun',
  fileName: 'device-simsun.ttf',
  format: 'ttf',
  size: 4096,
  contentHash: 'hash',
  createdAt: 0,
}

describe('FontsSettingsSection', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Device font removals hit IndexedDB directly; a fresh in-memory factory
    // keeps them deterministic without touching any real data
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('Blob', NativeBlob)
    vi.stubGlobal('File', NativeFile)
    await i18n.changeLanguage('zh-CN')
    useAuthStore.setState({ user: { id: 'reader', username: 'reader', role: 'member' } })
    useUiStore.setState({ fontPreferences: {}, fontOrder: [], fontFamily: 'serif' })
    useDeviceFontStore.setState({ status: 'ready', fonts: [], preferences: {}, order: [], selection: { primary: null, cjk: null } })
    vi.mocked(useDeleteFont).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useDeleteFont>)
    vi.mocked(useUpdateFontScope).mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false } as unknown as ReturnType<typeof useUpdateFontScope>)
    mockFonts(fonts)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the device storage explanation inside the import menu', () => {
    render(<FontsSettingsSection />)
    expect(screen.queryByText('仅保存在当前浏览器，不上传服务器')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加字体' }))
    expect(screen.getByText('仅保存在当前浏览器，不上传服务器')).toBeVisible()
  })

  it('renders uploaded, builtin and system fonts in one catalog', () => {
    render(<FontsSettingsSection />)

    expect(screen.getByText('我的手写体')).toBeInTheDocument()
    expect(screen.getByText('Instance Serif')).toBeInTheDocument()
    expect(screen.getByText('霞鹜文楷')).toBeInTheDocument()
    expect(screen.getByText('宋体')).toBeInTheDocument()
    expect(screen.getByText('· 12')).toBeInTheDocument()
    expect(screen.queryByText('ttf')).not.toBeInTheDocument()
    expect(screen.queryByText('woff2')).not.toBeInTheDocument()
    expect(screen.queryByText('2.0 MB')).not.toBeInTheDocument()
    expect(screen.queryByText('512 KB')).not.toBeInTheDocument()
    expect(screen.getByText('仅自己')).toBeInTheDocument()
    expect(screen.getByText('所有用户')).toBeInTheDocument()
    expect(screen.getAllByText('在线')).toHaveLength(4)
    expect(screen.getAllByText('系统')).toHaveLength(6)
    expect(screen.queryByText('自定义')).not.toBeInTheDocument()
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
    expect(Array.from(rows[2]?.children ?? []).filter((child) => child.tagName === 'SPAN').map((child) => child.textContent)).toEqual(['仅自己'])
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
    expect(screen.getAllByRole('button', { name: '调整字体顺序' })).toHaveLength(12)
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
    fireEvent.click(screen.getByRole('button', { name: '所有用户' }))
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

  it('opens the server upload picker and the device import picker from the add menu', () => {
    render(<FontsSettingsSection />)

    const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    inputs.forEach((input) => expect(input.accept).toBe('.ttf,.otf,.woff,.woff2'))
    const serverSpy = vi.spyOn(inputs[0]!, 'click').mockImplementation(() => {})
    const deviceSpy = vi.spyOn(inputs[1]!, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: '添加字体' }))
    fireEvent.click(screen.getByText('添加到服务器'))
    expect(serverSpy).toHaveBeenCalled()
    expect(screen.queryByText('添加到本机')).not.toBeInTheDocument()
    // The shared menu guards against reopening in the same click gesture.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200)
    fireEvent.click(screen.getByRole('button', { name: '添加字体' }))
    clock.mockRestore()
    fireEvent.click(screen.getByText('添加到本机'))
    expect(deviceSpy).toHaveBeenCalled()
  })

  it('still offers device import when the instance keeps member resource uploads off', () => {
    useAuthStore.setState({ user: { id: 'u2', username: 'member', role: 'member' } })
    render(<FontsSettingsSection canUploadResources={false} />)

    fireEvent.click(screen.getByRole('button', { name: '添加字体' }))
    expect(screen.getByText('添加到本机')).toBeInTheDocument()
    expect(screen.queryByText('添加到服务器')).not.toBeInTheDocument()
  })

  it('offers device import to guests and lists device fonts when the server font list fails', async () => {
    useAuthStore.setState({ user: null })
    vi.mocked(useFonts).mockReturnValue({ data: undefined, isPending: false, isError: true, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useFonts>)
    useDeviceFontStore.setState({ status: 'ready', fonts: [deviceFont], preferences: { [deviceFont.id]: { displayName: '手写体' } }, order: [], selection: { primary: null, cjk: null } })
    render(<FontsSettingsSection canUploadResources={false} />)

    // The server failure degrades to an inline error, not a blocked list;
    // guests on a restricted instance see only loaded/server/device fonts,
    // so the never-fetched builtin stays hidden
    expect(screen.getByText('宋体')).toBeInTheDocument()
    expect(screen.getByText('手写体')).toBeInTheDocument()
    expect(screen.getByText('本机')).toBeInTheDocument()
    expect(screen.queryByText('仅自己')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加字体' }))
    expect(screen.getByText('添加到本机')).toBeInTheDocument()
    expect(screen.queryByText('添加到服务器')).not.toBeInTheDocument()
  })

  it('hides never-fetched builtins from members when resource uploads are off', () => {
    render(<FontsSettingsSection canUploadResources={false} />)

    // No builtin is loaded in this environment: all of them stay hidden
    expect(screen.queryByText('霞鹜文楷')).not.toBeInTheDocument()
    expect(screen.queryAllByText('在线')).toHaveLength(0)
    expect(screen.getByText('宋体')).toBeInTheDocument()
  })

  it('routes device renames to the device store instead of the synced preferences', async () => {
    useDeviceFontStore.setState({ status: 'ready', fonts: [deviceFont], preferences: {}, order: [], selection: { primary: null, cjk: null } })
    render(<FontsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    const deviceRow = Array.from(document.querySelectorAll('ul > li')).find((row) => row.querySelector('p')?.textContent?.trim() === 'Device SimSun')!
    fireEvent.click(deviceRow.querySelector('button[aria-label="编辑字体"]')!)
    const input = screen.getByLabelText('显示名称')
    fireEvent.change(input, { target: { value: '我的本机体' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(useDeviceFontStore.getState().preferences[deviceFont.id]).toEqual({ displayName: '我的本机体' })
    })
    expect(useUiStore.getState().fontPreferences[deviceFont.id]).toBeUndefined()
  })

  it('deletes a device font without any server request', async () => {
    const deleteFont = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDeleteFont).mockReturnValue(deleteFont as unknown as ReturnType<typeof useDeleteFont>)
    useDeviceFontStore.setState({ status: 'ready', fonts: [deviceFont], preferences: {}, order: [deviceFont.id], selection: { primary: deviceFont.id, cjk: null } })
    render(<FontsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    const deviceRow = Array.from(document.querySelectorAll('ul > li')).find((row) => row.querySelector('p')?.textContent?.trim() === 'Device SimSun')!
    fireEvent.click(deviceRow.querySelector('button[aria-label="删除"]')!)
    expect(screen.getByText('确定要删除字体“Device SimSun”吗？')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!)

    await waitFor(() => {
      expect(useDeviceFontStore.getState().fonts).toHaveLength(0)
      expect(useDeviceFontStore.getState().selection).toEqual({ primary: null, cjk: null })
    })
    expect(deleteFont.mutate).not.toHaveBeenCalled()
  })

  it('commits sorting into separate synced and device order lists', () => {
    useDeviceFontStore.setState({ status: 'ready', fonts: [deviceFont], preferences: {}, order: [deviceFont.id], selection: { primary: null, cjk: null } })
    render(<FontsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('button', { name: '保存排序并退出编辑模式' }))

    // The unchanged draft keeps device ids out of the synced fontOrder
    expect(useUiStore.getState().fontOrder).not.toContain(deviceFont.id)
    expect(useDeviceFontStore.getState().order).toContain(deviceFont.id)
  })
  it('summarizes a mixed font upload once after all files finish', async () => {
    const upload = vi.fn().mockResolvedValueOnce({ data: { id: 'new-font' } }).mockRejectedValueOnce(new Error('Invalid font'))
    vi.mocked(useUploadFont).mockReturnValue({ mutateAsync: upload, isPending: false } as unknown as ReturnType<typeof useUploadFont>)
    render(<FontsSettingsSection />)
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'a.ttf'), new File(['b'], 'b.ttf')] } })
    await waitFor(() => expect(notify.warning).toHaveBeenCalledWith({ key: 'settings.fontUploadPartial', params: { succeeded: 1, duplicated: 0, failed: 1 } }))
    expect(upload).toHaveBeenCalledTimes(2)
    expect(notify.error).not.toHaveBeenCalled()
    expect(notify.success).not.toHaveBeenCalled()
  })

  it('treats repeated uploads as existing fonts rather than newly added fonts', async () => {
    const upload = vi.fn().mockResolvedValue({ data: fonts[0] })
    vi.mocked(useUploadFont).mockReturnValue({ mutateAsync: upload, isPending: false } as unknown as ReturnType<typeof useUploadFont>)
    render(<FontsSettingsSection />)
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'a.ttf'), new File(['a'], 'a.ttf')] } })
    await waitFor(() => expect(notify.info).toHaveBeenCalledWith({ key: 'settings.fontUploadSummary', params: { succeeded: 0, duplicated: 2 } }))
    expect(notify.success).not.toHaveBeenCalled()
  })

})
