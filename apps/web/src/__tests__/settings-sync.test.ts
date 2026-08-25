import { describe, expect, it } from 'vitest'

import { customThemesFromSync } from '../lib/reading-theme'

const theme = { id: 't1', name: 'Theme', colors: { bg: '#fff', fg: '#000', primary: '#00f' } }

describe('customThemesFromSync', () => {
  it('parses a valid synced theme list', () => {
    expect(customThemesFromSync(JSON.stringify([theme]))).toEqual([theme])
  })

  it('filters malformed entries, mirroring the store seed leniency', () => {
    const raw = JSON.stringify([theme, { id: 1 }, null, { id: 'x', name: 'y' }])
    expect(customThemesFromSync(raw)).toEqual([theme])
  })

  it('returns undefined for absent or malformed payloads so local themes survive', () => {
    expect(customThemesFromSync(undefined)).toBeUndefined()
    expect(customThemesFromSync(null)).toBeUndefined()
    expect(customThemesFromSync('not json')).toBeUndefined()
    expect(customThemesFromSync('{}')).toBeUndefined()
  })
})
