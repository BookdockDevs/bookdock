import { localRecordId } from '@/features/local-library/id'
import { notify } from '@/lib/notifications'
import { publishUndoOpportunity } from '@/lib/undo'
import { getThemeLibrarySnapshot, useUiStore, type ThemeLibrarySnapshot } from '@/stores/ui.store'

export function publishThemeDeleteUndo(before: ThemeLibrarySnapshot, message: { key: string; params?: Record<string, string | number> }) {
  const after = getThemeLibrarySnapshot()
  const token = localRecordId()
  publishUndoOpportunity({
    token,
    expiresAt: Date.now() + 10_000,
    execute: async () => useUiStore.getState().undoThemeDeletion(before, after),
  })
  notify.success(message, { undo: { token, label: 'undo.action' } })
}
