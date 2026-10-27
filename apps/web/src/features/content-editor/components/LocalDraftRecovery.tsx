import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { useState } from 'react'
import type { LocalDraftRecord } from '../lib/local-draft-store'

interface Props {
  record: LocalDraftRecord
  revisionId: string
  text: string
  onRestore: () => void
  onDiscard: () => Promise<void>
  failure?: string | null
}

export default function LocalDraftRecovery({ record, revisionId, text, onRestore, onDiscard, failure }: Props) {
  const [error, setError] = useState(false)
  const conflict = record.revisionId !== revisionId
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'bookdock-local-draft.txt'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <ConfirmDialog title={conflict ? '书籍内容已更新' : '恢复本地草稿？'}
    message={<div className="space-y-3"><p>暂存时间：{new Date(record.savedAt).toLocaleString()}。此草稿尚未正式保存。</p>
      {conflict && <p>书籍内容已更新，无法直接恢复之前的草稿。请先下载草稿中的修改内容，手动取回需要的文字。</p>}
      {(error || failure) && <p role="alert">{failure ?? '无法删除本地草稿，请重试或重新打开工作台。'}</p>}
      <div className="flex gap-2"><Button type="button" variant="secondary" onClick={download}>下载草稿文字</Button><Button type="button" variant="danger" onClick={() => { void onDiscard().catch(() => setError(true)) }}>放弃草稿</Button></div>
    </div>}
    confirmLabel="恢复草稿" confirmVariant="primary" confirmDisabled={conflict || Boolean(failure)} dismissible={false} onConfirm={onRestore} onClose={() => {}} />
}
