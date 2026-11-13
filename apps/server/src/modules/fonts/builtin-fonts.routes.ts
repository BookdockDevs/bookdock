import { Hono } from 'hono'

import { getBuiltinFontCss, getBuiltinFontResource } from './builtin-fonts.service'

const builtinFontsRoutes = new Hono()

// These two endpoints are exempt from the auth guard (see PUBLIC_ROUTE_PATTERNS
// in auth.guard.ts): they serve pinned open-source font binaries, and the
// service locks upstream paths so anonymous reads cannot abuse the instance
// as a proxy. Device-book readers without an account depend on this access.
// Rewritten CSS uses root-relative addresses, so responses carry no scheme or
// origin and stay correct behind TLS-terminating reverse proxies.

builtinFontsRoutes.get('/:id/:version/css', async (c) => {
  const { id, version } = c.req.param()
  const resource = await getBuiltinFontCss(id, version)
  return c.newResponse(new Uint8Array(resource.data), 200, {
    'Content-Type': resource.contentType,
    'Content-Length': String(resource.data.length),
    'Cache-Control': resource.cacheControl,
  })
})

builtinFontsRoutes.get('/:id/:version/res/*', async (c) => {
  const { id, version } = c.req.param()
  const prefix = `/api/v1/fonts/builtin/${id}/${version}/res/`
  const resourcePath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : ''
  const resource = await getBuiltinFontResource(id, version, resourcePath)
  return c.newResponse(new Uint8Array(resource.data), 200, {
    'Content-Type': resource.contentType,
    'Content-Length': String(resource.data.length),
    'Cache-Control': resource.cacheControl,
  })
})

export default builtinFontsRoutes
