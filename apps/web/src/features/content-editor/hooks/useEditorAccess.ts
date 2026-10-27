import { useEffect, useRef, useState } from 'react'
import { useAuthStore, getAuthSessionRevision } from '@/stores/auth.store'
import { fetchEditorAccess, type ManagedEditorTarget } from './useEditorContent'

export function useEditorAccess(bookId: string, revisionId: string | null | undefined, target?: ManagedEditorTarget, enabled = true) {
  const account = useAuthStore((state) => state.user?.id ?? null)
  const role = useAuthStore((state) => state.user?.role ?? null)
  const targetKey = JSON.stringify(target ?? null)
  const identity = JSON.stringify([account, role, bookId, revisionId, targetKey, enabled])
  const [result, setResult] = useState<{ identity: string; status: 'allowed' | 'error' } | null>(null)
  const accountEpoch = useRef(0)
  useEffect(() => {
    let active = true
    const session = getAuthSessionRevision()
    const epoch = accountEpoch.current
    if (!enabled || !account || !revisionId) return () => { active = false }
    const actualTarget = JSON.parse(targetKey) as ManagedEditorTarget | null
    void fetchEditorAccess(bookId, actualTarget ?? undefined).then(({ data }) => {
      if (active && epoch === accountEpoch.current && session === getAuthSessionRevision()) setResult({ identity, status: data.revisionId === revisionId ? 'allowed' : 'error' })
    }).catch(() => { if (active && epoch === accountEpoch.current && session === getAuthSessionRevision()) setResult({ identity, status: 'error' }) })
    return () => { active = false }
  }, [account, bookId, revisionId, targetKey, identity, enabled])
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'bd-user') { accountEpoch.current++; setResult({ identity, status: 'error' }) }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [identity])
  return !account ? 'error' : result?.identity === identity ? result.status : 'pending'
}
