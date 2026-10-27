import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { getEpubEditorDiff, type EpubEditorDocumentDiff, type EpubEditorOrderDiff } from '../lib/epub-editor-diff'
import type { EpubEditorDraftState } from '../lib/epub-editor-draft'
import { splitTocHref } from '../lib/epub-editor-navigation'

interface EpubEditorDiffModalProps {
  draft: EpubEditorDraftState
  saving: boolean
  onClose: () => void
  onSave: () => void
}

function documentTitle(diff: EpubEditorDocumentDiff, draft: EpubEditorDraftState): string {
  const href = diff.after?.href ?? diff.before?.href
  return draft.tocEntries.find((entry) => splitTocHref(entry.href).documentHref === href)?.title
    ?? draft.baseline.tocEntries.find((entry) => splitTocHref(entry.href).documentHref === href)?.title
    ?? href
    ?? '未命名文档'
}

function tocLabel(id: string, draft: EpubEditorDraftState): string {
  const href = id.slice(0, id.lastIndexOf('\u0000'))
  const occurrence = Number(id.slice(id.lastIndexOf('\u0000') + 1))
  const matches = draft.tocEntries.filter((entry) => entry.href === href)
  return matches[occurrence]?.title ?? draft.baseline.tocEntries.filter((entry) => entry.href === href)[occurrence]?.title ?? href
}

function spineLabel(href: string, draft: EpubEditorDraftState): string {
  return draft.tocEntries.find((entry) => splitTocHref(entry.href).documentHref === href)?.title
    ?? draft.baseline.tocEntries.find((entry) => splitTocHref(entry.href).documentHref === href)?.title
    ?? href
}

function tocEntryLabel(entry: { title: string; level: number } | null, other: { title: string; level: number } | null): string {
  if (!entry) return '（已删除）'
  return entry.level !== other?.level ? `${entry.title}（层级 ${entry.level}）` : entry.title
}

export default function EpubEditorDiffModal({ draft, saving, onClose, onSave }: EpubEditorDiffModalProps) {
  const _ = useTranslation()
  const diff = getEpubEditorDiff(draft)
  const [expandedId, setExpandedId] = useState<string | null>(diff.documents[0]?.id ?? null)

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <span>{_('editor.diffTitle') || '草稿修改差异'}</span>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {diff.changeCount} 项变更
          </span>
        </div>
      }
      onClose={onClose}
      size="wide"
    >
      <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto">
        {diff.changeCount === 0 ? (
          <div className="py-12 text-center text-sm text-stone-400">
            {_('editor.diffNoChanges') || '当前草稿与已保存版本一致，没有修改。'}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {diff.documents.map((item) => {
              const title = documentTitle(item, draft)
              const isExpanded = expandedId === item.id
              return (
                <section key={item.id} className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="flex w-full items-center justify-between gap-3 bg-stone-50 px-3 py-2.5 text-left text-sm font-medium text-stone-800 dark:bg-stone-900/60 dark:text-stone-200"
                  >
                    <span className="min-w-0 truncate">{title}</span>
                    <span className="shrink-0 text-xs font-normal text-stone-500">{item.before && item.after ? '正文' : item.after ? '新增文档' : '删除文档'}</span>
                  </button>
                  {isExpanded && (
                    <div className="flex flex-col gap-2 p-3">
                      {!item.before || !item.after ? (
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {item.before && <TextPanel label="原文" tone="red" text={item.textChange?.before ?? '（无可见文字变化）'} />}
                          {item.after && <TextPanel label="修改后" tone="green" text={item.textChange?.after ?? '（无可见文字变化）'} />}
                        </div>
                      ) : item.textChange ? (
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          <TextPanel label="修改前（局部上下文）" tone="red" text={item.textChange.before} />
                          <TextPanel label="修改后（局部上下文）" tone="green" text={item.textChange.after} />
                        </div>
                      ) : (
                        <p className="text-xs text-stone-500">XHTML 结构有变化，可见文字没有变化。</p>
                      )}
                    </div>
                  )}
                </section>
              )
            })}

            {diff.tocEntries.map((item) => (
              <div key={item.id} className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 text-sm dark:border-stone-800 dark:bg-stone-900/40">
                <div className="mb-1 text-xs font-medium text-stone-500">目录条目</div>
                <div className="break-words text-stone-700 dark:text-stone-300">
                  <span className={cn(!item.before && 'text-stone-400', item.before && item.after && item.before.title !== item.after.title && 'line-through text-red-600 dark:text-red-400')}>
                    {item.before ? tocEntryLabel(item.before, item.after) : '（无）'}
                  </span>
                  <span className="mx-2 text-stone-400">→</span>
                  <span className={cn(!item.after && 'text-stone-400', item.before && item.after && (item.before.title !== item.after.title || item.before.level !== item.after.level) && 'font-semibold text-emerald-600 dark:text-emerald-400')}>
                    {item.after ? tocEntryLabel(item.after, item.before) : '（已删除）'}
                  </span>
                </div>
              </div>
            ))}

            {diff.tocReordered && <OrderChange label="目录顺序已调整" changes={diff.tocOrderChanges} titleFor={(item) => tocLabel(item.id, draft)} />}
            {diff.spineReordered && <OrderChange label="阅读顺序已调整" changes={diff.spineOrderChanges} titleFor={(item) => spineLabel(item.href, draft)} />}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
          <Button variant="secondary" onClick={onClose}>{_('library.cancel') || '关闭'}</Button>
          {diff.changeCount > 0 && (
            <Button variant="primary" disabled={saving} onClick={onSave}>
              {saving ? (_('editor.saving') || '保存中…') : (_('editor.save') || '保存')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function TextPanel({ label, tone, text }: { label: string; tone: 'red' | 'green'; text: string }) {
  const toneClasses = tone === 'red'
    ? 'border-red-200/80 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20'
    : 'border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20'
  const labelClasses = tone === 'red' ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
  return (
    <div className={cn('min-w-0 rounded-xl border p-2.5 text-xs text-stone-800 dark:text-stone-200', toneClasses)}>
      <div className={cn('mb-1 font-semibold', labelClasses)}>{label}</div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{text || '（正文为空）'}</pre>
    </div>
  )
}

function OrderChange({ label, changes, titleFor }: { label: string; changes: EpubEditorOrderDiff[]; titleFor: (change: EpubEditorOrderDiff) => string }) {
  const visibleChanges = changes.slice(0, 5)
  const remainingChanges = changes.slice(5)
  const renderChange = (change: EpubEditorOrderDiff) => (
    <li key={change.id} className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate">{titleFor(change)}</span>
      <span className="shrink-0 text-stone-400">第 {change.beforeIndex + 1} 项 → 第 {change.afterIndex + 1} 项</span>
    </li>
  )
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-300">
      <div className="font-medium">{label} · {changes.length} 项位置变化</div>
      <ul className="mt-2 flex flex-col gap-1 text-xs">{visibleChanges.map(renderChange)}</ul>
      {remainingChanges.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-stone-500">展开其余 {remainingChanges.length} 项</summary>
          <ul className="mt-2 flex flex-col gap-1">{remainingChanges.map(renderChange)}</ul>
        </details>
      )}
    </div>
  )
}
