import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useReaderRenderer } from '../hooks/useReaderRenderer'
import { FoliateReader } from '../renderers/FoliateReader'

it('mounts with host-resolved local fonts without requesting server fonts', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('Server must not be used'))
  vi.stubGlobal('fetch', fetch)
  const mount = vi.spyOn(FoliateReader.prototype, 'mount').mockResolvedValue(undefined)
  const destroy = vi.spyOn(FoliateReader.prototype, 'destroy').mockImplementation(() => {})
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Host() {
    const { containerRef } = useReaderRenderer({ url: 'local-content', bookId: 'local-book', initialCfi: '', resolvedFonts: [] })
    return <div ref={containerRef} />
  }
  const view = render(<QueryClientProvider client={client}><Host /></QueryClientProvider>)
  try {
    await waitFor(() => expect(mount).toHaveBeenCalledOnce())
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    client.clear()
    mount.mockRestore()
    destroy.mockRestore()
    vi.unstubAllGlobals()
  }
})
