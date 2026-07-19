import { useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import { Button } from '@/components/ui/Button'

import { useUploadBook } from '../hooks'

interface UploadSheetProps {
  open: boolean
  onClose: () => void
}

const ACCEPTED = ['.epub', '.txt']

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED.some((ext) => name.endsWith(ext))
}

export default function UploadSheet({ open, onClose }: UploadSheetProps) {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = useUploadBook()
  const isUploading = upload.isPending
  const progress = upload.progress

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setDragOver(false)
      setError(null)
    }
  }, [open])

  async function handleFile(file: File) {
    if (!isAccepted(file)) {
      setError(t().library.unsupportedFormat)
      return
    }
    setError(null)
    try {
      await upload.mutateAsync(file)
      onClose()
    } catch {
      // toast already handled in hook
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-800 dark:bg-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
          {t().library.upload}
        </h2>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) void handleFile(file)
          }}
          className={
            'flex h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center transition-colors ' +
            (dragOver
              ? 'border-stone-900 bg-stone-50 dark:border-stone-300 dark:bg-stone-900/50'
              : 'border-stone-300 dark:border-stone-700')
          }
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <div className="space-y-2 text-center">
            <p className="text-sm text-stone-500">{t().library.uploadHint}</p>
            {isUploading && (
              <div className="w-64 space-y-1">
                <div className="flex justify-between text-xs text-stone-400">
                  <span>{progress < 100 ? t().library.uploading : t().library.processing}</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                  <div
                    className="h-full rounded-full bg-stone-500 transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isUploading}>
            {t().library.cancel}
          </Button>
          <Button onClick={() => inputRef.current?.click()} disabled={isUploading}>
            {t().library.upload}
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".epub,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}