import { useRef, useState } from 'react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'

interface LeaveEditorDialogProps {
  saving: boolean
  preserve: () => Promise<boolean>
  discard: () => Promise<boolean>
  onLeave: () => void
  onClose: () => void
}

export default function LeaveEditorDialog({ saving, preserve, discard, onLeave, onClose }: LeaveEditorDialogProps) {
  const [discarding, setDiscarding] = useState(false)
  const [preserving, setPreserving] = useState(false)
  const working = useRef(false)
  const [error, setError] = useState<string | null>(null)
  async function discardAndLeave() {
    if (working.current) return
    working.current = true
    setDiscarding(true); setError(null)
    try {
      if (!await discard()) { setError('无法清理本地草稿，请检查存储状态后重试。'); return }
      onLeave()
    } finally { working.current = false; setDiscarding(false) }
  }
  return <ConfirmDialog title="离开内容编辑？" message={<div className="space-y-3">
    <p>当前修改尚未正式保存。可以保留本地草稿，之后继续编辑。</p>
    {error && <p role="alert">{error}</p>}
  </div>} footerLeading={<Button type="button" variant="ghost" size="md" className="mr-auto h-9 px-2 text-xs !text-red-600 hover:!text-red-700 sm:text-sm dark:!text-red-400 dark:hover:!text-red-300" disabled={saving || discarding || preserving} onClick={() => { void discardAndLeave() }}>放弃草稿并离开</Button>}
    confirmLabel="保留草稿并离开" cancelLabel="继续编辑" confirmVariant="primary" confirmDisabled={saving || discarding}
    onConfirm={async () => {
      if (working.current) return
      working.current = true; setPreserving(true)
      try { if (!await preserve()) throw new Error('本地暂存失败，请检查存储状态后重试。'); onLeave() }
      finally { working.current = false; setPreserving(false) }
    }} onClose={() => { if (!working.current) onClose() }} />
}
