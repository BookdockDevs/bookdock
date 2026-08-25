import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import { useUiStore } from '../stores/ui.store'
import ReadingPresetPicker from '../features/reader/components/ReadingPresetPicker'
import { SettingsPopover } from '../features/reader/components/SettingsPopover'
import { ViewSettingsContext, type ViewSettingsContextValue } from '../features/reader/view-settings-context'

// Snapshot the store right after module load; tests restore this baseline.
const baseline = useUiStore.getState()

function mockPointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function contextWith(boundPresetId: string | null, setBoundPreset = vi.fn()): ViewSettingsContextValue {
  return {
    effective: {
      fontSize: 18,
      lineHeight: 1.8,
      pageWidth: 800,
      horizontalPadding: 24,
      verticalPadding: 24,
      pageColumns: 2,
      columnGap: 5,
    },
    perBookActive: false,
    setPerBookActive: vi.fn(),
    updateSetting: vi.fn(),
    boundPresetId,
    setBoundPreset,
  }
}

// Two presets, no device active; returns their ids in creation order
function seedPresets(): { aId: string; bId: string } {
  useUiStore.getState().createReadingPreset('A')
  const aId = useUiStore.getState().activePresetId!
  useUiStore.getState().createReadingPreset('B')
  const bId = useUiStore.getState().activePresetId!
  useUiStore.getState().activateReadingPreset(null)
  return { aId, bId }
}

describe('ReadingPresetPicker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockPointer(false)
    localStorage.clear()
    useUiStore.setState({ readingConfig: baseline.readingConfig })
    useUiStore.setState(baseline)
  })

  it('toggles the device active on an unbound book', () => {
    const { aId } = seedPresets()
    render(
      <ViewSettingsContext.Provider value={contextWith(null)}>
        <ReadingPresetPicker />
      </ViewSettingsContext.Provider>,
    )

    fireEvent.click(screen.getByText('A'))
    expect(useUiStore.getState().activePresetId).toBe(aId)

    fireEvent.click(screen.getByText('A'))
    expect(useUiStore.getState().activePresetId).toBeNull()
  })

  it('clicking another chip on a bound book rebinds and adopts it as device active', () => {
    const { aId, bId } = seedPresets()
    const setBoundPreset = vi.fn()
    render(
      <ViewSettingsContext.Provider value={contextWith(aId, setBoundPreset)}>
        <ReadingPresetPicker />
      </ViewSettingsContext.Provider>,
    )

    fireEvent.click(screen.getByText('B'))
    expect(setBoundPreset).toHaveBeenCalledWith(bId)
    expect(useUiStore.getState().activePresetId).toBe(bId)
  })

  it('clicking the effective chip on a bound book unbinds (device active untouched)', () => {
    const { aId } = seedPresets()
    const setBoundPreset = vi.fn()
    render(
      <ViewSettingsContext.Provider value={contextWith(aId, setBoundPreset)}>
        <ReadingPresetPicker />
      </ViewSettingsContext.Provider>,
    )

    fireEvent.click(screen.getByText('A'))
    expect(setBoundPreset).toHaveBeenCalledWith(null)
    expect(useUiStore.getState().activePresetId).toBeNull()
  })

  it('pin button binds/unbinds and the bound chip carries a badge', () => {
    // Inline pin buttons are the touch affordance; pointer uses the context menu
    mockPointer(true)
    const { aId } = seedPresets()
    const setBoundPreset = vi.fn()
    const { rerender } = render(
      <ViewSettingsContext.Provider value={contextWith(null, setBoundPreset)}>
        <ReadingPresetPicker />
      </ViewSettingsContext.Provider>,
    )

    const pinButtons = screen.getAllByTitle('绑定到本书')
    expect(pinButtons).toHaveLength(2)
    fireEvent.click(pinButtons[0])
    expect(setBoundPreset).toHaveBeenCalledWith(aId)

    rerender(
      <ViewSettingsContext.Provider value={contextWith(aId, setBoundPreset)}>
        <ReadingPresetPicker />
      </ViewSettingsContext.Provider>,
    )
    // The bound chip shows the always-visible text marker and the unbind
    // affordance (chip title is 解绑 too — the pin button is the icon-only one)
    expect(screen.getByText((_, el) => el?.textContent === '· 本书')).toBeInTheDocument()
    const unbindPin = screen.getAllByTitle('解绑').find((el) => el.textContent === '')!
    fireEvent.click(unbindPin)
    expect(setBoundPreset).toHaveBeenCalledWith(null)
  })

  it('keeps the chip action group visible on touch devices', () => {
    mockPointer(true)
    seedPresets()
    render(
      <ViewSettingsContext.Provider value={contextWith(null)}>
        <ReadingPresetPicker />
      </ViewSettingsContext.Provider>,
    )
    const actionGroup = screen.getAllByTitle('重命名')[0].parentElement!
    expect(actionGroup.className).toContain('flex')
    expect(actionGroup.className).not.toContain('hidden')
  })

  it('opens a right-click context menu on pointer devices', () => {
    const { aId } = seedPresets()
    const setBoundPreset = vi.fn()
    render(
      <ViewSettingsContext.Provider value={contextWith(null, setBoundPreset)}>
        <ReadingPresetPicker />
      </ViewSettingsContext.Provider>,
    )
    // No inline action buttons on pointer devices
    expect(screen.queryByTitle('绑定到本书')).toBeNull()

    fireEvent.contextMenu(screen.getByText('A'))
    fireEvent.click(screen.getByText('绑定到本书'))
    expect(setBoundPreset).toHaveBeenCalledWith(aId)
    // The menu closes after the action
    expect(screen.queryByText('重命名')).toBeNull()
  })

  it('dismisses the context menu on Escape and outside click', () => {
    seedPresets()
    render(
      <ViewSettingsContext.Provider value={contextWith(null)}>
        <ReadingPresetPicker />
      </ViewSettingsContext.Provider>,
    )

    fireEvent.contextMenu(screen.getByText('A'))
    expect(screen.getByText('重命名')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('重命名')).toBeNull()

    fireEvent.contextMenu(screen.getByText('A'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('重命名')).toBeNull()
  })

  it('clicking menu items does not close the enclosing settings popover', () => {
    // Regression: the popover dismisses on document click in the CAPTURE
    // phase, so the body-portaled menu (outside the popover DOM) used to
    // close the whole popover before the item handler ran
    seedPresets()
    const onClose = vi.fn()
    render(
      <SettingsPopover open onClose={onClose}>
        <ViewSettingsContext.Provider value={contextWith(null)}>
          <ReadingPresetPicker />
        </ViewSettingsContext.Provider>
      </SettingsPopover>,
    )

    fireEvent.contextMenu(screen.getByText('A'))
    fireEvent.click(screen.getByText('重命名'))
    expect(onClose).not.toHaveBeenCalled()
    // The chip switched to its rename input
    expect(screen.getByPlaceholderText('预设名称')).toBeInTheDocument()
  })
})
