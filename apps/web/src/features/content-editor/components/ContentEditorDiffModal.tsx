import { memo, useState } from 'react'
import type { EditorUnitDiff } from '../lib/editor-draft'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

interface ContentEditorDiffModalProps {
  open: boolean
  differences: EditorUnitDiff[]
  ruleChanged: boolean
  baselineRuleLabel?: string | null
  currentRuleLabel?: string | null
  onClose: () => void
  onSave?: () => void
  saving?: boolean
}

export const ContentEditorDiffModal = memo(function ContentEditorDiffModal({
  open,
  differences,
  ruleChanged,
  baselineRuleLabel,
  currentRuleLabel,
  onClose,
  onSave,
  saving,
}: ContentEditorDiffModalProps) {
  const _ = useTranslation()
  const [activeDiffId, setActiveDiffId] = useState<string | null>(differences[0]?.id ?? null)

  if (!open) return null

  const selectedDiff = differences.find((d) => d.id === activeDiffId) ?? differences[0] ?? null
  const totalChanges = differences.length + (ruleChanged ? 1 : 0)

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <span>{_('editor.diffTitle') || '草稿修改差异'}</span>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {totalChanges} 项变更
          </span>
        </div>
      }
      onClose={onClose}
      size="wide"
    >
      <div className="flex flex-col gap-4">
        {totalChanges === 0 ? (
          <div className="py-12 text-center text-sm text-stone-400">
            {_('editor.diffNoChanges') || '当前草稿与已保存版本一致，没有修改。'}
          </div>
        ) : (
          <div className="grid min-h-[420px] grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
            {/* Left list of changed chapters */}
            <div className="flex flex-col gap-1 overflow-y-auto pr-1">
              {ruleChanged && (
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-xs dark:border-stone-700 dark:bg-stone-800/60">
                  <span className="font-medium text-stone-800 dark:text-stone-200">
                    {_('editor.tagRule') || '目录规则'}已变更
                  </span>
                  <div className="mt-1 text-stone-500 dark:text-stone-400">
                    {baselineRuleLabel ?? '无规则'} → <span className="font-semibold text-emerald-600 dark:text-emerald-400">{currentRuleLabel ?? '无规则'}</span>
                  </div>
                </div>
              )}

              {differences.map((diff) => {
                const title = diff.after?.title || diff.before?.title || '未命名章节'
                const isSelected = selectedDiff?.id === diff.id
                const tags = [
                  diff.contentChanged && (_('editor.tagBody') || '正文'),
                  diff.titleChanged && (_('editor.tagTitle') || '标题'),
                  diff.levelChanged && (_('editor.tagLevel') || '层级'),
                  diff.orderChanged && (_('editor.tagOrder') || '顺序'),
                  !diff.before && (_('editor.tagAdded') || '新增'),
                  !diff.after && (_('editor.tagDeleted') || '删除'),
                ].filter(Boolean)

                return (
                  <button
                    key={diff.id}
                    type="button"
                    onClick={() => setActiveDiffId(diff.id)}
                    className={cn(
                      'flex flex-col gap-1 rounded-xl p-2.5 text-left text-sm transition-all',
                      isSelected
                        ? 'bg-stone-200/80 font-medium text-stone-900 shadow-xs dark:bg-stone-800 dark:text-stone-100'
                        : 'text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/50',
                    )}
                  >
                    <span className="truncate">{title}</span>
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <span
                          key={String(tag)}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px] font-normal leading-tight',
                            tag === (_('editor.tagAdded') || '新增')
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                              : tag === (_('editor.tagDeleted') || '删除')
                                ? 'bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300'
                                : 'bg-stone-100 text-stone-600 dark:bg-stone-700/60 dark:text-stone-300',
                          )}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Right details of selected chapter diff */}
            <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50/50 p-4 dark:border-stone-800 dark:bg-stone-900/40">
              {selectedDiff ? (
                <>
                  <div className="border-b border-stone-200 pb-2 text-sm font-semibold text-stone-800 dark:border-stone-800 dark:text-stone-100">
                    {selectedDiff.after?.title || selectedDiff.before?.title || '未命名章节'}
                  </div>

                                    {!selectedDiff.before && (
                    <div className="flex flex-col gap-2 text-xs text-stone-600 dark:text-stone-300">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                          {_('editor.tagAdded') || '新增'}
                        </span>
                        <span>第 {(selectedDiff.afterIndex ?? 0) + 1} 章</span>
                        <span>•</span>
                        <span>{selectedDiff.after?.content.length ?? 0} 字</span>
                      </div>
                      {selectedDiff.after?.content ? (
                        <div className="mt-1 flex flex-1 flex-col gap-1.5 min-h-0">
                          <span className="font-medium text-stone-500">正文预览：</span>
                          <pre className="max-h-60 flex-1 overflow-auto rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-2.5 whitespace-pre-wrap font-sans text-xs text-stone-800 custom-scrollbar dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-stone-200">
                            {selectedDiff.after.content}
                          </pre>
                        </div>
                      ) : (
                        <p className="mt-2 text-stone-400">暂无正文内容</p>
                      )}
                    </div>
                  )}

                  {!selectedDiff.after && (
                    <div className="flex flex-col gap-2 text-xs text-stone-600 dark:text-stone-300">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950/80 dark:text-red-300">
                          {_('editor.tagDeleted') || '删除'}
                        </span>
                        <span>原第 {(selectedDiff.beforeIndex ?? 0) + 1} 章</span>
                        <span>•</span>
                        <span>{selectedDiff.before?.content.length ?? 0} 字</span>
                      </div>
                      {selectedDiff.before?.content ? (
                        <div className="mt-1 flex flex-1 flex-col gap-1.5 min-h-0">
                          <span className="font-medium text-stone-500">原正文内容备份：</span>
                          <pre className="max-h-60 flex-1 overflow-auto rounded-xl border border-red-200/80 bg-red-50/60 p-2.5 whitespace-pre-wrap font-sans text-xs text-stone-800 custom-scrollbar dark:border-red-900/60 dark:bg-red-950/20 dark:text-stone-200">
                            {selectedDiff.before.content}
                          </pre>
                        </div>
                      ) : (
                        <p className="mt-2 text-stone-400">原正文为空</p>
                      )}
                    </div>
                  )}

                  {selectedDiff.before && selectedDiff.after && (
                    <>
                      {selectedDiff.titleChanged && (
                        <div className="text-xs text-stone-600 dark:text-stone-300">
                          <span className="font-medium text-stone-400">{_('editor.tagTitle') || '标题'}：</span>
                          <span className="line-through text-red-600 dark:text-red-400">{selectedDiff.before?.title || '（空）'}</span>
                          <span className="mx-1 text-stone-400">→</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{selectedDiff.after?.title || '（空）'}</span>
                        </div>
                      )}

                      {selectedDiff.levelChanged && (
                        <div className="text-xs text-stone-600 dark:text-stone-300">
                          <span className="font-medium text-stone-400">{_('editor.tagLevel') || '层级'}：</span>
                          <span>{selectedDiff.before?.level ?? 0}</span>
                          <span className="mx-1 text-stone-400">→</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{selectedDiff.after?.level ?? 0}</span>
                        </div>
                      )}

                      {selectedDiff.orderChanged && (
                        <div className="text-xs text-stone-600 dark:text-stone-300">
                          <span className="font-medium text-stone-400">{_('editor.tagOrder') || '顺序'}：</span>
                          <span>第 {selectedDiff.beforeIndex! + 1} 章</span>
                          <span className="mx-1 text-stone-400">→</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">第 {selectedDiff.afterIndex! + 1} 章</span>
                        </div>
                      )}

                      {selectedDiff.contentChanged && (
                        <div className="mt-1 flex flex-1 flex-col gap-2 min-h-0">
                          <span className="text-xs font-medium text-stone-500">
                            {_('editor.tagBody') || '正文'}变化对比：
                          </span>
                          <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-2">
                            <div className="flex flex-col rounded-xl border border-red-200/80 bg-red-50/60 p-2.5 text-xs text-stone-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-stone-200">
                              <span className="mb-1 text-[11px] font-semibold text-red-700 dark:text-red-400">原正文内容</span>
                              <pre className="max-h-60 flex-1 overflow-auto whitespace-pre-wrap font-sans text-xs custom-scrollbar">
                                {selectedDiff.before?.content || '（原正文为空）'}
                              </pre>
                            </div>
                            <div className="flex flex-col rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-2.5 text-xs text-stone-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-stone-200">
                              <span className="mb-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">修改后正文</span>
                              <pre className="max-h-60 flex-1 overflow-auto whitespace-pre-wrap font-sans text-xs custom-scrollbar">
                                {selectedDiff.after?.content || '（现正文为空）'}
                              </pre>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="m-auto text-sm text-stone-400">从左侧选择一个章节查看修改细节</div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
          <Button variant="secondary" onClick={onClose}>
            {_('library.cancel') || '关闭'}
          </Button>
          {onSave && totalChanges > 0 && (
            <Button variant="primary" disabled={saving} onClick={onSave}>
              {saving ? (_('editor.saving') || '保存中…') : (_('editor.save') || '保存')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
})
