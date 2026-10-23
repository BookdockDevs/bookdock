import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('dotenv', () => ({ config: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('server port configuration', () => {
  it.each([
    [undefined, 18423],
    ['3000', 3000],
    ['19000', 19000],
    ['65535', 65535],
  ])('uses PORT=%s as %s', async (value, expected) => {
    vi.stubEnv('PORT', value)
    vi.stubEnv('JWT_SECRET', 'port-test-secret')
    const { loadEnv } = await import('./env')

    expect(loadEnv().PORT).toBe(expected)
  })

  it.each(['0', '-1', '65536', '18423.5', 'invalid', ''])('rejects invalid PORT=%s', async (value) => {
    vi.stubEnv('PORT', value)
    vi.stubEnv('JWT_SECRET', 'port-test-secret')
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('invalid configuration') })
    const { loadEnv } = await import('./env')

    expect(() => loadEnv()).toThrow('invalid configuration')
    expect(process.exit).toHaveBeenCalledWith(1)
  })
})
