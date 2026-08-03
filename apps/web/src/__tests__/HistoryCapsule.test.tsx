import { describe, expect, it, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import i18n from '../i18n/i18n'
import HistoryCapsule from '../features/reader/components/HistoryCapsule'

describe('HistoryCapsule', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })
  it('renders nothing when neither direction is available', () => {
    const { container } = render(
      <HistoryCapsule canBack={false} canForward={false} onBack={vi.fn()} onForward={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows only the back button when only back is available', () => {
    render(<HistoryCapsule canBack canForward={false} onBack={vi.fn()} onForward={vi.fn()} />)
    expect(screen.getByTitle('后退')).toBeInTheDocument()
    expect(screen.queryByTitle('前进')).toBeNull()
  })

  it('shows only the forward button when only forward is available', () => {
    render(<HistoryCapsule canBack={false} canForward onBack={vi.fn()} onForward={vi.fn()} />)
    expect(screen.getByTitle('前进')).toBeInTheDocument()
    expect(screen.queryByTitle('后退')).toBeNull()
  })

  it('fires the handlers on click', () => {
    const onBack = vi.fn()
    const onForward = vi.fn()
    render(<HistoryCapsule canBack canForward onBack={onBack} onForward={onForward} />)
    fireEvent.click(screen.getByTitle('后退'))
    fireEvent.click(screen.getByTitle('前进'))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onForward).toHaveBeenCalledTimes(1)
  })
})
