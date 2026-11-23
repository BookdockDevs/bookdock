import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

import { expect, it, vi } from 'vitest'

it('runs chapter and title regex jobs in the built classic worker', () => {
  const postMessage = vi.fn()
  const self = { postMessage, onmessage: (_event: { data: unknown }) => {} }
  const source = readFileSync(path.join(process.cwd(), 'public/eink/text-replacement.worker.js'), 'utf8')
  runInNewContext(source, { self })
  self.onmessage({ data: [
    { groups: [[{ text: 'fo' }, { text: 'o' }]], rules: [{ pattern: '(fo)o', replacement: '$1!', isRegex: true }] },
    { groups: [[{ text: 'Chapter 12' }]], rules: [{ pattern: 'Chapter (\\d+)', replacement: 'Part $1', isRegex: true }] },
  ] })
  expect(postMessage).toHaveBeenCalledWith([
    [[{ text: 'fo!' }, { text: '' }]],
    [[{ text: 'Part 12' }]],
  ])
})

it('starts the built Kindle bundle and shows the translated login page', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  localStorage.setItem('i18nextLng', 'en')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { guest: true } }))))
  try {
    const source = readFileSync(path.join(process.cwd(), 'public/eink/eink.js'), 'utf8')
    window.eval(source)
    await vi.waitFor(() => expect(document.querySelector('.login h1')?.textContent).toBe('Bookdock'))
    expect(document.querySelector<HTMLInputElement>('input[autocomplete="username"]')?.placeholder).toBe('Username')
    expect(document.querySelector('.login button')?.textContent).toBe('Sign In')
  } finally {
    vi.unstubAllGlobals()
    localStorage.removeItem('i18nextLng')
    document.body.innerHTML = ''
  }
})
