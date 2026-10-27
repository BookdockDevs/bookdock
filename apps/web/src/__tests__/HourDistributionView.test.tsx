import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import HourDistributionView from '../features/stats/components/HourDistributionView'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

describe('HourDistributionView', () => {
  it('shows all time axis labels in 24-hour format', () => {
    render(<HourDistributionView bars={[]} />)

    for (const label of ['0', '4', '8', '12', '16', '20']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.queryByText('16 PM')).not.toBeInTheDocument()
    expect(screen.queryByText('20 PM')).not.toBeInTheDocument()
  })
})
