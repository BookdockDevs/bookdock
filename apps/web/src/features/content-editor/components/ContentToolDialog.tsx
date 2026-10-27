import type { TocRulePattern, TocRuleRes } from '@bookdock/shared'
import type { EditorTocRuleSelection, EditorUnit } from '../lib/editor-draft'
import ContentAppendModal from './ContentAppendModal'
import ContentRechapterModal from './ContentRechapterModal'

interface ContentToolDialogProps {
  mode: 'add' | 'rechapter'
  bookId: string
  initialText: string
  rules: TocRuleRes[]
  customPatterns?: TocRulePattern[]
  existingUnits: readonly EditorUnit[]
  initialRuleId?: string | null
  unitCount: number
  defaultInsertIndex: number
  onApply: (units: EditorUnit[], insertIndex: number, selection: EditorTocRuleSelection) => void
  onClose: () => void
}

export default function ContentToolDialog({
  mode,
  bookId,
  initialText,
  rules,
  customPatterns,
  existingUnits,
  initialRuleId,
  unitCount,
  defaultInsertIndex,
  onApply,
  onClose,
}: ContentToolDialogProps) {
  if (mode === 'add') {
    return (
      <ContentAppendModal
        bookId={bookId}
        initialText={initialText}
        existingUnits={existingUnits}
        rules={rules}
        customPatterns={customPatterns}
        initialRuleId={initialRuleId}
        unitCount={unitCount}
        defaultInsertIndex={defaultInsertIndex}
        onApply={onApply}
        onClose={onClose}
      />
    )
  }

  return (
    <ContentRechapterModal
      initialText={initialText}
      rules={rules}
      customPatterns={customPatterns}
      initialRuleId={initialRuleId}
      unitCount={unitCount}
      onApply={onApply}
      onClose={onClose}
    />
  )
}
