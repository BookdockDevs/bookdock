import { describe, expect, it } from 'vitest'

import { getLanguage, resolveLanguage, setLanguage, t } from '../eink/i18n'

describe('Kindle language', () => {
  it('follows query, saved preference, browser language, then the Chinese fallback', () => {
    expect(resolveLanguage('en-US', 'zh-CN', ['zh-CN'])).toBe('en')
    expect(resolveLanguage(null, 'zh-CN', ['en-US'])).toBe('zh-CN')
    expect(resolveLanguage(null, null, ['en-US'])).toBe('en')
    expect(resolveLanguage(null, null, ['zh-CN'])).toBe('zh-CN')
    expect(resolveLanguage(null, null, ['fr-FR'])).toBe('zh-CN')
  })

  it('uses the existing translated strings and substitutes values', () => {
    expect(t('auth.username')).not.toBe('auth.username')
    expect(t('eink.page', { page: 2 })).toContain('2')
  })
  it('changes and remembers the selected language for the next page', () => {
    const original = getLanguage()
    try {
      setLanguage('en')
      expect(getLanguage()).toBe('en')
      expect(document.documentElement.lang).toBe('en')
      expect(localStorage.getItem('i18nextLng')).toBe('en')
      expect(t('auth.signIn')).toBe('Sign In')
      setLanguage('zh-CN')
      expect(t('auth.signIn')).toBe('登录')
    } finally { setLanguage(original) }
  })

})
