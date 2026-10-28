import { describe, expect, it } from 'vitest'
import app from '../app'

describe('Kindle entry routes', () => {
  it('serves eink.html at /eink', async () => {
    const res = await app.request('/eink')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Bookdock E-ink')
    expect(text).toContain('/eink/eink.js')
  })

  it('serves the Kindle script rather than redirecting it to HTML', async () => {
    const res = await app.request('/eink/eink.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/javascript/)
    expect(await res.text()).not.toContain('<!doctype html>')
  })

  it('redirects Kindle user-agent from / to /eink', async () => {
    const res = await app.request('/', {
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2+ (KHTML, like Gecko) Version/5.0 Safari/533.2+ Kindle/3.0+',
      },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/eink')
  })

  it('does not redirect desktop browsers from /', async () => {
    const res = await app.request('/', {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
    })
    expect(res.status).not.toBe(302)
  })

  it('honors desktop override query for Kindle user-agent', async () => {
    const res = await app.request('/?desktop=1', {
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2+ (KHTML, like Gecko) Version/5.0 Safari/533.2+ Kindle/3.0+',
      },
    })
    expect(res.status).not.toBe(302)
  })
})
