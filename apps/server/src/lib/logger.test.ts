import { afterEach, describe, expect, it, vi } from 'vitest'

import { getLogLevel, log, setLogLevel } from './logger'

describe('structured logger', () => {
  afterEach(() => {
    setLogLevel('info')
    vi.restoreAllMocks()
  })

  it('writes stable JSON records and redacts sensitive fields', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})

    log('info', 'http.request.completed', {
      requestId: 'req_test',
      method: 'GET',
      path: '/api/v1/books',
      status: 200,
      durationMs: 4.6,
      meta: { passwordHash: 'plain-secret', note: 'cookie=private-value' },
    })

    expect(output).toHaveBeenCalledTimes(1)
    const record = JSON.parse(output.mock.calls[0][0] as string)
    expect(record).toMatchObject({
      level: 'info',
      event: 'http.request.completed',
      requestId: 'req_test',
      method: 'GET',
      path: '/api/v1/books',
      status: 200,
      durationMs: 5,
      meta: { passwordHash: '[REDACTED]', note: 'cookie=[REDACTED]' },
    })
    expect(record.ts).toMatch(/Z$/)
  })

  it('keeps error records on stderr and filters below the configured level', () => {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})

    setLogLevel('warn')
    log('info', 'ignored')
    log('error', 'app.unhandled_error', { error: new Error('password=secret') })

    expect(getLogLevel()).toBe('warn')
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledTimes(1)
    const record = JSON.parse(stderr.mock.calls[0][0] as string)
    expect(record.error.message).toBe('password=[REDACTED]')
  })
})
