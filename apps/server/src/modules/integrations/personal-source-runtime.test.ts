import { describe, expect, it, vi } from 'vitest'

import { AppError } from '../../middleware/error'
import { personalSourceHasDetail, runPersonalSource } from './personal-source-runtime'

describe('personal metadata source runtime', () => {
  it('runs an async source and validates its result', async () => {
    const source = 'export default { async search(query) { return [{ id: "1", title: query }] } }'
    await expect(runPersonalSource(source, 'search', 'Book')).resolves.toEqual([{ id: '1', title: 'Book' }])
    await expect(runPersonalSource(source, 'getDetail', '1')).resolves.toBeNull()
  })

  it('does not expose Node globals or allow invalid results', async () => {
    const source = 'export default { search() { return [{ id: "1", title: typeof process }] } }'
    await expect(runPersonalSource(source, 'search', '')).resolves.toEqual([{ id: '1', title: 'undefined' }])
    await expect(runPersonalSource('export default { search() { return [{}] } }', 'search', '')).rejects.toThrow('Invalid metadata source result')
  })

  it('interrupts an infinite loop', async () => {
    await expect(runPersonalSource('export default { search() { while (true) {} } }', 'search', '')).rejects.toThrow()
  }, 5000)
})

describe('personal metadata source runtime with host fetch', () => {
  it('resolves await fetch through the host and validates results', async () => {
    const source = 'export default { async search(query) { const res = await fetch("https://example.com/api", { method: "POST", body: query }); return JSON.parse(res.body).items } }'
    const fetchMock = vi.fn(async () => ({ status: 200, body: JSON.stringify({ items: [{ id: '1', title: 'From fetch' }] }) }))
    await expect(runPersonalSource(source, 'search', 'Book', { fetch: fetchMock })).resolves.toEqual([{ id: '1', title: 'From fetch' }])
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({ method: 'POST', body: 'Book' }))
  })

  it('surfaces host fetch errors to the sandbox', async () => {
    const source = 'export default { async search() { try { await fetch("https://192.168.0.1/x"); return [] } catch { return [{ id: "e", title: "caught" }] } } }'
    const fetchMock = vi.fn(async () => { throw new AppError('VALIDATION_ERROR', 'URL host is not a public address') })
    await expect(runPersonalSource(source, 'search', '', { fetch: fetchMock })).resolves.toEqual([{ id: 'e', title: 'caught' }])
  })

  it('rejects a pending promise with no work in flight', async () => {
    const source = 'export default { search() { return new Promise(() => {}) } }'
    await expect(runPersonalSource(source, 'search', '', { fetch: async () => ({ status: 200, body: '' }) })).rejects.toThrow('did not complete')
  })

  it('tears down safely when a fire-and-forget fetch is still pending', async () => {
    const source = 'export default { async search() { fetch("https://example.com/slow"); return [] } }'
    const fetchMock = vi.fn(() => new Promise<{ status: number; body: string }>(() => {}))
    await expect(runPersonalSource(source, 'search', '', { fetch: fetchMock })).resolves.toEqual([])
  })

  it('does not define fetch when no host fetch is provided', async () => {
    const source = 'export default { search() { return [{ id: "1", title: typeof fetch }] } }'
    await expect(runPersonalSource(source, 'search', '')).resolves.toEqual([{ id: '1', title: 'undefined' }])
  })
})

describe('personalSourceHasDetail', () => {
  it('detects whether the default export implements getDetail', async () => {
    expect(await personalSourceHasDetail('export default { search() {}, getDetail() {} }')).toBe(true)
    expect(await personalSourceHasDetail('export default { search() {} }')).toBe(false)
    expect(await personalSourceHasDetail('export default 42')).toBe(false)
    expect(await personalSourceHasDetail('export const broken =')).toBe(false)
  })
})
