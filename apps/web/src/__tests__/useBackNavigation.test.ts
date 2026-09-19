import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { canNavigateBack, useBackNavigation } from '@/hooks/useBackNavigation'

const mockRouterBack = vi.fn()
const mockCanGoBack = vi.fn()
const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useRouter: () => ({
      history: {
        canGoBack: mockCanGoBack,
        back: mockRouterBack,
      },
    }),
    useNavigate: () => mockNavigate,
  }
})

describe('useBackNavigation & canNavigateBack', () => {
  const originalState = window.history.state
  const originalReferrer = document.referrer

  beforeEach(() => {
    mockRouterBack.mockClear()
    mockCanGoBack.mockReset()
    mockNavigate.mockClear()
  })

  afterEach(() => {
    Object.defineProperty(window.history, 'state', {
      value: originalState,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(document, 'referrer', {
      value: originalReferrer,
      configurable: true,
      writable: true,
    })
  })

  it('canNavigateBack returns true when __TSR_index > 0', () => {
    Object.defineProperty(window.history, 'state', {
      value: { __TSR_index: 2 },
      configurable: true,
      writable: true,
    })
    expect(canNavigateBack()).toBe(true)
  })

  it('canNavigateBack returns false when __TSR_index === 0 and no referrer', () => {
    Object.defineProperty(window.history, 'state', {
      value: { __TSR_index: 0 },
      configurable: true,
      writable: true,
    })
    Object.defineProperty(document, 'referrer', {
      value: '',
      configurable: true,
      writable: true,
    })
    expect(canNavigateBack()).toBe(false)
  })

  it('canNavigateBack returns true when referrer matches same origin and history.length > 1', () => {
    Object.defineProperty(window.history, 'state', {
      value: null,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(document, 'referrer', {
      value: `${window.location.origin}/profile`,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window.history, 'length', {
      value: 3,
      configurable: true,
      writable: true,
    })
    expect(canNavigateBack()).toBe(true)
  })

  it('canNavigateBack returns false for external referrer', () => {
    Object.defineProperty(window.history, 'state', {
      value: null,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(document, 'referrer', {
      value: 'https://external-search-engine.com/search',
      configurable: true,
      writable: true,
    })
    expect(canNavigateBack()).toBe(false)
  })

  it('calls router.history.back when canGoBack is true', () => {
    mockCanGoBack.mockReturnValue(true)

    const { result } = renderHook(() => useBackNavigation('/'))
    const clickEvent = {
      button: 0,
      preventDefault: vi.fn(),
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    } as unknown as React.MouseEvent

    result.current(clickEvent)
    expect(clickEvent.preventDefault).toHaveBeenCalled()
    expect(mockRouterBack).toHaveBeenCalledTimes(1)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('navigates to fallback when cannot go back', () => {
    mockCanGoBack.mockReturnValue(false)

    Object.defineProperty(window.history, 'state', {
      value: { __TSR_index: 0 },
      configurable: true,
      writable: true,
    })
    Object.defineProperty(document, 'referrer', {
      value: '',
      configurable: true,
      writable: true,
    })

    const { result } = renderHook(() => useBackNavigation('/'))
    const clickEvent = {
      button: 0,
      preventDefault: vi.fn(),
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    } as unknown as React.MouseEvent

    result.current(clickEvent)
    expect(clickEvent.preventDefault).toHaveBeenCalled()
    expect(mockRouterBack).not.toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('does not prevent default on meta/ctrl/middle click', () => {
    mockCanGoBack.mockReturnValue(true)

    const { result } = renderHook(() => useBackNavigation('/'))
    const metaClickEvent = {
      button: 0,
      preventDefault: vi.fn(),
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    } as unknown as React.MouseEvent

    result.current(metaClickEvent)
    expect(metaClickEvent.preventDefault).not.toHaveBeenCalled()
    expect(mockRouterBack).not.toHaveBeenCalled()
  })
})
