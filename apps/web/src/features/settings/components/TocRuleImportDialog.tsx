import { useMemo, useRef, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import {
  RULE_TRANSFER_MAX_BYTES,
  RULE_TRANSFER_MAX_RULES,
  describeTransferIssues,
  normalizeTransferName,
  suggestImportName,
  tocTransferFileSchema,
  transferFileByteLength,
  type TocTransferRule,
  type TransferIssue,
} from '@bookdock/shared'

import { useImportTocRules } from '@/api/hooks/useTocRules'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

interface TocRuleImportDialogProps {
  existingNames: string[]
  onClose: () => void
}

interface PreviewRow {
  sourceName: string
  sourceEnabled: boolean
  patterns: TocTransferRule['patterns']
  finalName: string
}

function extractServerIssues(error: unknown): TransferIssue[] {
  if (error instanceof ApiError) {
    const details = error.details as { issues?: TransferIssue[]; fieldErrors?: Record<string, string[]> } | undefined
    if (Array.isArray(details?.issues)) return details.issues
  }
  return []
}

export default function TocRuleImportDialog({ existingNames, onClose }: TocRuleImportDialogProps) {
  const _ = useTranslation()
  const importMutation = useImportTocRules()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileGeneration = useRef(0)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fieldIssues, setFieldIssues] = useState<TransferIssue[]>([])
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveIssues, setSaveIssues] = useState<TransferIssue[]>([])
  const [unconfirmed, setUnconfirmed] = useState(false)
  const busy = importMutation.isPending

  const existingSet = useMemo(() => new Set(existingNames.map(normalizeTransferName)), [existingNames])

  const conflicts = useMemo(() => {
    const seen = new Set<string>()
    return rows.map((row) => {
      const key = normalizeTransferName(row.finalName)
      if (!key) return 'blank'
      if (row.finalName.length > 200) return 'too-long'
      if (seen.has(key)) return 'duplicate'
      seen.add(key)
      if (existingSet.has(key)) return 'exists'
      return null
    })
  }, [rows, existingSet])

  const canConfirm = rows.length > 0 && !fileError && fieldIssues.length === 0 && !busy && !unconfirmed
    && conflicts.every((conflict) => conflict === null)

  function resetPreview() {
    setFileError(null)
    setFieldIssues([])
    setRows([])
    setSaveError(null)
    setSaveIssues([])
    setUnconfirmed(false)
  }

  function buildPreview(fileRules: TocTransferRule[]) {
    const taken = new Set(existingSet)
    const next: PreviewRow[] = fileRules.map((rule) => {
      const key = normalizeTransferName(rule.name)
      const finalName = taken.has(key) ? suggestImportName(rule.name, taken) : rule.name
      taken.add(normalizeTransferName(finalName))
      return {
        sourceName: rule.name,
        sourceEnabled: rule.enabled ?? true,
        patterns: rule.patterns,
        finalName,
      }
    })
    setRows(next)
  }

  async function handleFile(file: File) {
    const generation = ++fileGeneration.current
    resetPreview()
    setFileName(file.name)
    if (file.size > RULE_TRANSFER_MAX_BYTES) {
      setFileError(_('settings.tocImportTooLarge'))
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      if (generation === fileGeneration.current) setFileError(_('settings.tocImportUnreadable'))
      return
    }
    if (generation !== fileGeneration.current) return
    if (transferFileByteLength(text) > RULE_TRANSFER_MAX_BYTES) {
      setFileError(_('settings.tocImportTooLarge'))
      return
    }
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(text)
    } catch {
      setFileError(_('settings.tocImportInvalidJson'))
      return
    }
    const parsed = tocTransferFileSchema.safeParse(parsedJson)
    if (!parsed.success) {
      setFieldIssues(describeTransferIssues(parsed.error))
      return
    }
    if (parsed.data.rules.length === 0) {
      setFileError(_('settings.tocImportEmpty'))
      return
    }
    buildPreview(parsed.data.rules)
  }

  function handleConfirm() {
    if (!canConfirm) return
    setSaveError(null)
    setSaveIssues([])
    setUnconfirmed(false)
    importMutation.mutate(
      {
        kind: 'bookdock.toc-rules',
        formatVersion: 1,
        rules: rows.map((row) => ({
          name: row.finalName,
          enabled: row.sourceEnabled,
          patterns: row.patterns.map((pattern) => ({
            level: pattern.level,
            regex: pattern.regex,
            replacement: pattern.replacement ?? null,
            enabled: pattern.enabled ?? true,
          })),
        })),
      },
      {
        onSuccess: (response) => {
          notify.success({ key: 'toast.tocRulesImported', params: { count: response.data.length } })
          onClose()
        },
        onError: (error) => {
          if (error instanceof TypeError || error instanceof SyntaxError || (error instanceof ApiError && error.code === 'UNKNOWN')) {
            setUnconfirmed(true)
            void queryClient.invalidateQueries({ queryKey: ['toc-rules'] })
            return
          }
          setSaveIssues(extractServerIssues(error))
          setSaveError(getUserErrorNotification(error, 'settings.tocRuleOperationFailed').key)
        },
      },
    )
  }

  return (
    <Modal
      title={_('settings.tocImportTitle')}
      onClose={() => { if (!busy) onClose() }}
      size="wide"
      footer={
        <>
          <span className="text-xs text-stone-400 dark:text-stone-500">
            {_('settings.tocImportDisabledHint')}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
              {_('library.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={handleConfirm} disabled={!canConfirm}>
              {busy ? _('settings.tocImportSaving') : _('settings.tocImportConfirm', { count: rows.length })}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleFile(file)
          }}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || unconfirmed}
          >
            {_('settings.tocImportChooseFile')}
          </Button>
          <span className="min-w-0 flex-1 truncate text-xs text-stone-400 dark:text-stone-500">
            {fileName ?? _('settings.tocImportNoFile')}
          </span>
          <span className="shrink-0 text-xs text-stone-400 tabular-nums dark:text-stone-500">
            {_('settings.tocImportLimit', { max: RULE_TRANSFER_MAX_RULES })}
          </span>
        </div>

        {fileError && <p className="text-sm text-red-600 dark:text-red-400">{fileError}</p>}

        {fieldIssues.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-red-200 p-3 text-xs text-red-600 dark:border-red-900 dark:text-red-400">
            {fieldIssues.map((issue, index) => (
              <li key={index}>
                {issue.ruleIndex !== null
                  ? _('settings.tocImportRowError', { index: issue.ruleIndex + 1, field: issue.field || 'rules', message: issue.message })
                  : _('settings.tocImportFileError', { message: issue.message })}
              </li>
            ))}
          </ul>
        )}

        {rows.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-stone-600 dark:text-stone-300">
              {_('settings.tocImportPreview', { count: rows.length })}
            </p>
            <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {rows.map((row, index) => {
                const conflict = conflicts[index]
                return (
                  <li key={index} className="rounded-xl border border-stone-200/80 p-3 dark:border-stone-800">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
                        {_('settings.tocImportFinalName')}
                      </span>
                      <input
                        type="text"
                        value={row.finalName}
                        maxLength={200}
                        disabled={busy}
                        onChange={(event) => {
                          const value = event.target.value
                          setRows((current) => current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, finalName: value } : item,
                          ))
                        }}
                        className="w-full rounded-lg border border-stone-200 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:focus:border-stone-500"
                      />
                    </label>
                    {conflict === 'blank' && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{_('settings.tocRulesNameRequired')}</p>}
                    {conflict === 'too-long' && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{_('settings.tocImportNameTooLong')}</p>}
                    {conflict === 'duplicate' && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{_('settings.tocImportDuplicate')}</p>}
                    {conflict === 'exists' && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{_('settings.tocImportExists')}</p>}
                    {row.finalName !== row.sourceName && (
                      <p className="mt-1 break-all text-xs text-stone-500 dark:text-stone-400">
                        {existingSet.has(normalizeTransferName(row.sourceName)) && <>{_('settings.ruleImportNameConflict')} · </>}
                        {_('settings.ruleImportOriginalName')}: {row.sourceName}
                      </p>
                    )}
                    <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">{_('settings.tocImportLevels', { count: row.patterns.length })}</p>
                    <details className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                      <summary className="cursor-pointer rounded outline-none hover:text-stone-700 focus-visible:ring-2 focus-visible:ring-stone-400 dark:hover:text-stone-200">{_('settings.tocImportShowConfig')}</summary>
                      <ul className="mt-3 space-y-3">
                        {row.patterns.map((pattern) => (
                          <li key={pattern.level}>
                            <span>{_('settings.tocImportLevel', { level: pattern.level })}{!pattern.enabled && <> · {_('settings.tocImportLevelDisabled')}</>}</span>
                            <pre className="mt-1 whitespace-pre-wrap break-all font-mono">{pattern.regex}</pre>
                            <p className="mt-1">{_('settings.tocImportTitle')}: {pattern.replacement
                              ? <>{_('settings.tocImportTitleTemplate')} <code className="whitespace-pre-wrap break-all">{pattern.replacement}</code></>
                              : _('settings.tocImportTitleMatched')}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {unconfirmed && <p className="text-sm text-amber-600 dark:text-amber-400">{_('settings.tocImportUnconfirmed')}</p>}
        {saveError && !unconfirmed && <p className="text-sm text-red-600 dark:text-red-400">{_(saveError)}</p>}
        {saveIssues.length > 0 && (
          <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-red-600 dark:text-red-400">
            {saveIssues.map((issue, index) => (
              <li key={index}>
                {issue.ruleIndex !== null
                  ? _('settings.tocImportRowError', { index: issue.ruleIndex + 1, field: issue.field || 'name', message: issue.message })
                  : _('settings.tocImportFileError', { message: issue.message })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
