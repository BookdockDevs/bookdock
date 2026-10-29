import { afterEach, expect, it, vi } from 'vitest'

import { prepareNextSection } from '../eink/prepared-section'

afterEach(() => vi.useRealTimers())

it('hands a prepared resource to navigation and releases its background reference', async () => {
  vi.useFakeTimers()
  let finish!: (url: string) => void
  const load = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve })).mockResolvedValue('blob:chapter')
  const unload = vi.fn()
  const sections = [{ id: 'first', load: vi.fn(), unload: vi.fn() }, { id: 'second', load, unload }]
  const prepared = prepareNextSection(sections, () => true)
  prepared.schedule(0)
  await vi.advanceTimersByTimeAsync(1000)
  const navigation = sections[1]!.load()
  expect(load).toHaveBeenCalledTimes(1)
  finish('blob:chapter')
  await expect(navigation).resolves.toBe('blob:chapter')
  await Promise.resolve()
  expect(load).toHaveBeenCalledTimes(2)
  expect(unload).toHaveBeenCalledTimes(1)
  prepared.dispose()
  expect(unload).toHaveBeenCalledTimes(1)
})

it('aborts and releases a stale preparation after it settles', async () => {
  vi.useFakeTimers()
  let finish!: (url: string) => void
  const load = vi.fn((_signal?: AbortSignal) => new Promise<string>(resolve => { finish = resolve }))
  const unload = vi.fn()
  const sections = [{ id: 'first', load: vi.fn(), unload: vi.fn() }, { id: 'second', load, unload }]
  const prepared = prepareNextSection(sections, () => true)
  prepared.schedule(0)
  await vi.advanceTimersByTimeAsync(1000)
  const signal = load.mock.calls[0]![0]!
  prepared.dispose()
  expect(signal.aborted).toBe(true)
  finish('blob:chapter')
  await Promise.resolve()
  expect(unload).toHaveBeenCalledTimes(1)
})

it('lets a foreground navigation abort without cancelling shared preparation', async () => {
  vi.useFakeTimers()
  let finish!: (url: string) => void
  const load = vi.fn((_signal?: AbortSignal) => new Promise<string>(resolve => { finish = resolve }))
  const sections = [{ id: 'first', load: vi.fn(), unload: vi.fn() }, { id: 'second', load, unload: vi.fn() }]
  const prepared = prepareNextSection(sections, () => true)
  prepared.schedule(0)
  await vi.advanceTimersByTimeAsync(1000)
  const navigation = new AbortController()
  const pending = sections[1]!.load(navigation.signal)
  navigation.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(load.mock.calls[0]![0]!.aborted).toBe(false)
  prepared.dispose()
  finish('blob:chapter')
  await Promise.resolve()
  expect(sections[1]!.unload).toHaveBeenCalledTimes(1)
})
