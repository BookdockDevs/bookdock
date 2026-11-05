import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'

import type { WereadQrLoginStart, WereadQrLoginStatus, WereadWebSessionStatus } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

export default function WereadWebLoginControls() {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [loginId, setLoginId] = useState<string | null>(null)
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const completedLoginRef = useRef<string | null>(null)

  // Mounting means the reader just opened the web channel, so ask the server
  // to verify the stored session (cached server-side, so repeat switches cost
  // no upstream request). A definitive rejection surfaces as valid: false and
  // renders the logged-out UI; the cookie itself stays on the server.
  const sessionQuery = useQuery({
    queryKey: ['weread-web-session'],
    queryFn: () => apiPost<{ data: WereadWebSessionStatus }>('/reading-imports/weread/web-session/verify', {}),
  })

  const startLogin = useMutation({
    mutationFn: () => apiPost<{ data: WereadQrLoginStart }>('/reading-imports/weread/web-login', {}),
    onSuccess: ({ data }) => {
      completedLoginRef.current = null
      setLoginId(data.id)
      setConfirmUrl(data.confirmUrl)
      setQrDataUrl(null)
      setMessage(null)
    },
    onError: (error) => setMessage(getUserErrorMessage(error, _, 'readingImport.webLoginFailed')),
  })

  const loginQuery = useQuery({
    queryKey: ['weread-web-login', loginId],
    queryFn: () => apiGet<{ data: WereadQrLoginStatus }>(`/reading-imports/weread/web-login/${encodeURIComponent(loginId!)}`),
    enabled: loginId !== null,
    refetchInterval: (query) => query.state.data?.data.status === 'pending' ? 1200 : false,
  })

  const clearSession = useMutation({
    mutationFn: () => apiDelete('/reading-imports/weread/web-session'),
    onSuccess: () => {
      notify.success(_('readingImport.webSessionCleared', { defaultValue: '已解除微信读书网页登录态。' }))
      setMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['weread-web-session'] })
    },
    onError: (error) => setMessage(getUserErrorMessage(error, _, 'readingImport.webCookieFailed')),
  })

  useEffect(() => {
    if (!confirmUrl) return
    let active = true
    QRCode.toDataURL(confirmUrl, { width: 220, margin: 2 })
      .then((url) => { if (active) setQrDataUrl(url) })
      .catch(() => { if (active) setMessage(_('readingImport.webQrFailed', { defaultValue: '二维码生成失败，请重试。' })) })
    return () => { active = false }
  }, [confirmUrl, _])

  useEffect(() => {
    const status = loginQuery.data?.data.status
    if (status === 'complete') {
      if (loginId && completedLoginRef.current !== loginId) {
        completedLoginRef.current = loginId
        notify.success(_('readingImport.webLoginDone', { defaultValue: '扫码成功，登录态已加密保存。' }))
        setMessage(null)
        setLoginId(null)
        setConfirmUrl(null)
        setQrDataUrl(null)
        void queryClient.invalidateQueries({ queryKey: ['weread-web-session'] })
      }
    } else if (status === 'expired') {
      setMessage(_('readingImport.webLoginExpired', { defaultValue: '二维码已过期，请重新获取。' }))
    } else if (status === 'failed') {
      setMessage(_('readingImport.webLoginFailed', { defaultValue: '登录失败，请重试。' }))
    }
  }, [loginId, loginQuery.data?.data.failure, loginQuery.data?.data.status, queryClient, _])

  const isCheckingSession = sessionQuery.isPending
  const configured = sessionQuery.data?.data.configured === true && sessionQuery.data?.data.valid !== false
  const canShareQr = typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && Boolean(qrDataUrl)
  const busy = isCheckingSession || startLogin.isPending || clearSession.isPending

  async function shareQrCode() {
    if (!qrDataUrl || typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return
    try {
      const blob = await (await fetch(qrDataUrl)).blob()
      const file = new File([blob], 'weread-login-qr.png', { type: 'image/png' })
      if (!navigator.canShare({ files: [file] })) return
      await navigator.share({ files: [file], title: _('readingImport.webQrShareTitle', { defaultValue: 'WeRead sign-in QR' }) })
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setMessage(_('readingImport.webQrShareFailed', { defaultValue: 'Could not share the QR image. Scan it with another device.' }))
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200/90 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              isCheckingSession
                ? 'animate-pulse bg-stone-300 dark:bg-stone-600'
                : configured
                  ? 'bg-emerald-500'
                  : 'bg-stone-300 dark:bg-stone-600',
            )}
            aria-hidden="true"
          />
          <span className="truncate text-xs font-medium text-stone-700 dark:text-stone-300">
            {isCheckingSession
              ? _('readingImport.webSessionChecking', { defaultValue: '正在检查登录状态…' })
              : configured
                ? _('readingImport.webSessionConnected', { defaultValue: '已登录账号 {{vid}}', vid: sessionQuery.data?.data.vid ?? '' })
                : _('readingImport.webSessionHint', { defaultValue: '未登录微信读书账号' })}
          </span>
        </div>

        {isCheckingSession ? (
          <Button size="sm" variant="secondary" disabled className="shrink-0 opacity-60 cursor-not-allowed">
            {_('readingImport.webSessionCheckingShort', { defaultValue: '检查中…' })}
          </Button>
        ) : configured ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => clearSession.mutate()} className="shrink-0 cursor-pointer">
            {_('readingImport.webDisconnect', { defaultValue: '退出' })}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => startLogin.mutate()} className="shrink-0 cursor-pointer">
            {startLogin.isPending
              ? _('readingImport.webQrPreparing', { defaultValue: '正在准备…' })
              : confirmUrl
                ? _('readingImport.webQrRegenerate', { defaultValue: '重新生成二维码' })
                : _('readingImport.webQrLogin', { defaultValue: '微信扫码登录' })}
          </Button>
        )}
      </div>

      {confirmUrl && loginQuery.data?.data.status === 'pending' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-stone-200 bg-white p-4 text-center sm:flex-row sm:text-left dark:border-stone-700 dark:bg-stone-900">
          <div className="shrink-0 overflow-hidden rounded-lg border border-stone-100 bg-white p-1 shadow-2xs dark:border-stone-800">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={_('readingImport.webQrAlt', { defaultValue: '微信读书登录二维码' })} className="h-28 w-28" />
            ) : (
              <div className="h-28 w-28 animate-pulse bg-stone-100 dark:bg-stone-800" />
            )}
          </div>
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <p className="text-xs leading-relaxed text-stone-600 dark:text-stone-300">
              {_('readingImport.webQrInstructions', { defaultValue: '请用微信扫描二维码并在手机上确认登录。此二维码短时有效。' })}
            </p>
            {canShareQr && (
              <Button size="sm" variant="secondary" onClick={() => void shareQrCode()} className="self-center sm:self-start cursor-pointer">
                {_('readingImport.webQrShare', { defaultValue: '分享二维码图片' })}
              </Button>
            )}
          </div>
        </div>
      )}

      {(message || sessionQuery.isError || loginQuery.isError) && (
        <p role="status" className="rounded-lg bg-stone-100/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-stone-600 dark:bg-stone-800/80 dark:text-stone-300">
          {message ?? getUserErrorMessage(sessionQuery.error ?? loginQuery.error, _, 'readingImport.webLoginFailed')}
        </p>
      )}
    </div>
  )
}
