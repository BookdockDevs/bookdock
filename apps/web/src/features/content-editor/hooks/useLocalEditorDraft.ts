import { useEffect, useRef, useState } from 'react'
import { localDraftEnvelopeSchema } from '@bookdock/shared'

import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'
import { DRAFT_MAX_AGE, draftKey, readLocalDraft, replaceLocalDraft, type LocalDraftRecord } from '../lib/local-draft-store'
import type { ManagedEditorTarget } from './useEditorContent'

interface Options<T> {
  bookId: string
  format: 'txt' | 'epub'
  target?: ManagedEditorTarget
  revisionId: string | null
  enabled: boolean
  dirty: boolean
  payload: () => T
  changeToken?: unknown
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }
  restore: (payload: T) => boolean
}

export function useLocalEditorDraft<T>(options: Options<T>) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const key = accountId ? draftKey(accountId, options.bookId, options.format, options.target) : null
  const latest = useRef(options)
  latest.current = options
  const token = useRef<string | null>(null)
  const generation = useRef(0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const timerRef = useRef<number | null>(null)
  const changeSequence = useRef(0)
  const savedChangeToken = useRef<unknown>(undefined)
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'pending' | 'saved'>('idle')
  const [candidate, setCandidate] = useState<(LocalDraftRecord & { payload: T }) | null>(null)
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'bd-user') return
      generation.current++
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      setFailure('账号已在另一标签页更改，本地暂存已停止。')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const generationRef = generation
    const current = ++generationRef.current
    const authRevision = getAuthSessionRevision()
    const valid = () => generation.current === current && getAuthSessionRevision() === authRevision && useAuthStore.getState().user?.id === accountId
    setReady(false); setFailure(null); setCandidate(null); setStatus('idle'); token.current = null; savedChangeToken.current = undefined
    if (!key || !options.enabled || !options.revisionId) return () => { generationRef.current++ }
    void (async () => {
      try {
        const raw = await readLocalDraft(key)
        if (!valid()) return
        if (raw === undefined) { setReady(true); return }
        const parsed = localDraftEnvelopeSchema.safeParse(raw)
        const payload = parsed.success ? latest.current.schema.safeParse(parsed.data.payload) : null
        if (!parsed.success || parsed.data.key !== key || !payload?.success) {
          setFailure('本地暂存数据损坏或版本不兼容，已保留原数据；本次编辑无法自动暂存。')
          setReady(true)
          return
        }
        token.current = parsed.data.token
        if (Date.now() - parsed.data.savedAt > DRAFT_MAX_AGE) {
          const removed = await replaceLocalDraft(key, parsed.data.token, null, valid)
          if (!valid()) return
          if (!removed) throw new Error('Draft changed in another tab')
          token.current = null; setReady(true); return
        }
        const recovered = { ...parsed.data, payload: payload.data }
        if (parsed.data.revisionId === latest.current.revisionId) {
          try {
            if (latest.current.restore(payload.data)) { setReady(true); setStatus('saved'); return }
          } catch { /* Preserve the record for text extraction. */ }
          setFailure('本地草稿与当前来源不匹配，请下载草稿文字。')
        }
        setCandidate(recovered)
      } catch {
        if (valid()) { setFailure('本地暂存失败，无法读取浏览器存储；当前编辑不会受到本地保护。'); setReady(true) }
      }
    })()
    return () => { generationRef.current++ }
  }, [key, accountId, options.enabled, options.revisionId])

  useEffect(() => {
    if (!key || !ready || candidate || failure || !options.revisionId) return
    const current = generation.current
    const sequence = ++changeSequence.current
    const authRevision = getAuthSessionRevision()
    const valid = () => generation.current === current && getAuthSessionRevision() === authRevision && useAuthStore.getState().user?.id === accountId
    if (options.dirty) setStatus('pending')
    const timer = window.setTimeout(() => {
      timerRef.current = null
      const snapshot = latest.current
      queue.current = queue.current.then(async () => {
        if (!valid()) return
        const nextToken = crypto.randomUUID()
        const parsedPayload = snapshot.dirty ? snapshot.schema.safeParse(snapshot.payload()) : null
        if (parsedPayload && !parsedPayload.success) throw new Error('Invalid local draft')
        const record: LocalDraftRecord | null = snapshot.dirty
          ? { version: 1, key, revisionId: snapshot.revisionId!, token: nextToken, savedAt: Date.now(), payload: parsedPayload?.success ? parsedPayload.data : null }
          : null
        if (!record && token.current === null) return
        const written = await replaceLocalDraft(key, token.current, record, valid)
        if (!valid()) return
        if (!written) { setFailure('本地暂存失败：另一标签页已更新草稿。请复制当前修改后重新打开工作台。'); return }
        token.current = record ? nextToken : null
        if (record) savedChangeToken.current = snapshot.changeToken
        if (changeSequence.current === sequence) setStatus(record ? 'saved' : 'idle')
      }).catch(() => { if (valid()) setFailure('本地暂存失败，可能是存储不可用或空间不足；当前编辑不会受到本地保护。') })
    }, 1000)
    timerRef.current = timer
    return () => { window.clearTimeout(timer); if (timerRef.current === timer) timerRef.current = null }
  }, [key, ready, candidate, failure, options.dirty, options.changeToken, options.revisionId, accountId, epoch])

  async function discard() {
    if (!key || !candidate) return
    const current = generation.current
    const valid = () => generation.current === current && useAuthStore.getState().user?.id === accountId
    const removed = await replaceLocalDraft(key, candidate.token, null, valid)
    if (!removed) throw new Error('草稿已在另一标签页更新，请重新打开工作台。')
    token.current = null; setCandidate(null); setReady(true)
  }

  function restore() {
    if (!candidate || candidate.revisionId !== latest.current.revisionId) return
    if (!latest.current.restore(candidate.payload)) { setFailure('本地草稿与当前来源不匹配，请下载草稿文字。'); return }
    setCandidate(null); setReady(true)
  }

  async function flush(payload?: T): Promise<boolean> {
    if (!key || !ready || failure || !latest.current.revisionId) return false
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
    const current = generation.current
    const authRevision = getAuthSessionRevision()
    const valid = () => generation.current === current && getAuthSessionRevision() === authRevision && useAuthStore.getState().user?.id === accountId
    const snapshot = latest.current
    const sequence = ++changeSequence.current
    let success = false
    queue.current = queue.current.then(async () => {
      if (!valid()) return
      const parsed = snapshot.schema.safeParse(payload ?? snapshot.payload())
      if (!parsed.success) throw new Error('Invalid local draft')
      const nextToken = crypto.randomUUID()
      const record: LocalDraftRecord = { version: 1, key, revisionId: snapshot.revisionId!, token: nextToken, savedAt: Date.now(), payload: parsed.data }
      if (!await replaceLocalDraft(key, token.current, record, valid)) throw new Error('Local draft changed in another tab')
      if (!valid()) return
      token.current = nextToken
      savedChangeToken.current = snapshot.changeToken
      if (changeSequence.current === sequence) setStatus('saved')
      success = true
    }).catch(() => { if (valid()) setFailure('本地暂存失败，可能是存储不可用、空间不足或另一标签页已更新草稿。') })
    await queue.current
    return success
  }

  async function clear(): Promise<boolean> {
    if (!key) return false
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
    const current = generation.current
    const valid = () => generation.current === current && useAuthStore.getState().user?.id === accountId
    await queue.current
    if (!valid()) return false
    if (token.current === null) return !failure
    try {
      const removed = await replaceLocalDraft(key, token.current, null, valid)
      if (!removed) { if (valid()) setFailure('本地草稿已在另一标签页更新，未删除该草稿。'); return false }
      token.current = null; setEpoch((value) => value + 1)
      return true
    } catch { if (valid()) setFailure('本地暂存清理失败，请检查浏览器存储。'); return false }
  }

  const currentStatus = status === 'saved' && options.changeToken !== savedChangeToken.current ? 'pending' : status
  return { ready, failure, status: currentStatus, candidate, restore, discard, clear, flush }
}
