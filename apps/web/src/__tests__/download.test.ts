import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadEditedTxt } from '@/features/library/download'

describe('book download response', () => {
  const filenames: string[] = []

  beforeEach(() => {
    filenames.length = 0
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download) })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:download') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('honors the server filename when edited output falls back to original', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('body', { headers: {
      'Content-Type': 'text/plain',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('书名.txt')}`,
    } }))
    await downloadEditedTxt('book', '书名')
    expect(filenames).toEqual(['书名.txt'])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download')
  })

  it('preserves the empty-text error code for the download dialog', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: 'NO_EXPORTABLE_TEXT', message: 'No text' } }), { status: 422 }))
    await expect(downloadEditedTxt('book', 'Book')).rejects.toMatchObject({ code: 'NO_EXPORTABLE_TEXT' })
    expect(filenames).toHaveLength(0)
  })
})
