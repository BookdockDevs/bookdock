import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'

import { tokenCors } from './token-cors'

const TOKEN = `bd_${'a'.repeat(43)}`
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

function createApp() {
  const app = new Hono()
  app.use('/api/v1/*', tokenCors())
  app.get('/api/v1/books', (c) => c.json({ data: 'ok' }))
  app.post('/api/v1/books', (c) => c.json({ data: 'ok' }, 201))
  return app
}

describe('token CORS middleware', () => {
  it('echoes the origin for a cross-origin request carrying a bd_ token', async () => {
    const res = await createApp().request('/api/v1/books', {
      headers: { Origin: EXTENSION_ORIGIN, Authorization: `Bearer ${TOKEN}` },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(EXTENSION_ORIGIN)
    expect(res.headers.get('vary')).toBe('Origin')
    expect(res.headers.get('access-control-allow-methods')).toBe('GET,POST,PATCH,DELETE,HEAD,OPTIONS')
    expect(res.headers.get('access-control-allow-headers')).toBe('Authorization,Content-Type,Range')
    expect(res.headers.get('access-control-expose-headers')).toBe('Accept-Ranges,Content-Length,Content-Range,Content-Disposition')
    // Tokens travel in a header, never in a cookie.
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('answers a preflight that declares authorization, and caches it', async () => {
    const res = await createApp().request('/api/v1/books', {
      method: 'OPTIONS',
      headers: {
        Origin: EXTENSION_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,range',
      },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(EXTENSION_ORIGIN)
    expect(res.headers.get('access-control-max-age')).toBe('600')
    expect(res.headers.get('access-control-allow-headers')).toBe('Authorization,Content-Type,Range')
  })

  it('ignores a preflight that does not ask for authorization', async () => {
    const res = await createApp().request('/api/v1/books', {
      method: 'OPTIONS',
      headers: { Origin: EXTENSION_ORIGIN, 'Access-Control-Request-Method': 'GET' },
    })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('stays silent for same-origin requests so the Web client is untouched', async () => {
    const res = await createApp().request('/api/v1/books')

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBeNull()
  })

  it('stays silent for other origins that present no bd_ token', async () => {
    const bare = await createApp().request('/api/v1/books', { headers: { Origin: 'https://example.test' } })
    expect(bare.headers.get('access-control-allow-origin')).toBeNull()

    const jwt = await createApp().request('/api/v1/books', {
      headers: { Origin: 'https://example.test', Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.a.b' },
    })
    expect(jwt.headers.get('access-control-allow-origin')).toBeNull()
  })
})
