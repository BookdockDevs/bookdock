import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { AiPromptTemplate, AiStatusRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { aiStatusKey } from '@/api/hooks/useAi'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'

export interface AiQuickCommand {
  id: string
  name: string
  prompt: string
  order?: number
  /**
   * Server-side definition reference. Only commands that came from the account's
   * effective list carry it: the request then runs the current definition rather
   * than the text this client happens to show.
   */
  promptId?: string
}

export function useAiQuickCommands() {
  const accountId = useAuthStore((s) => s.user?.id ?? null)
  const _ = useTranslation()
  const statusQuery = useQuery({
    queryKey: aiStatusKey(accountId),
    queryFn: () => apiGet<{ data: AiStatusRes }>('/ai/status'),
    enabled: Boolean(accountId),
  })
  const fallback = useMemo<AiQuickCommand[]>(() => [
    { id: 'explain-selection', name: _('reader.aiQuickExplain'), prompt: _('reader.aiQuickExplainPrompt'), order: 10 },
    { id: 'translate-selection', name: _('reader.aiQuickTranslate'), prompt: _('reader.aiQuickTranslatePrompt'), order: 20 },
    { id: 'summarize-selection', name: _('reader.aiQuickSummarize'), prompt: _('reader.aiQuickSummarizePrompt'), order: 30 },
    { id: 'questions-selection', name: _('reader.aiQuickQuestions'), prompt: _('reader.aiQuickQuestionsPrompt'), order: 40 },
    { id: 'summarize-chapter', name: _('reader.aiQuickChapterSummary'), prompt: _('reader.aiQuickChapterSummaryPrompt'), order: 50 },
  ], [_])
  const commands = useMemo(() => {
    const configured = statusQuery.data?.data.prompts
    // Before the first status response the reader shows local defaults; those
    // carry no promptId, because the server has no definition to resolve yet.
    const source: Array<AiPromptTemplate | AiQuickCommand> = configured ?? fallback
    return [...source]
      .filter((item: AiPromptTemplate | AiQuickCommand) => 'enabled' in item ? item.enabled : true)
      .sort((a: AiPromptTemplate | AiQuickCommand, b: AiPromptTemplate | AiQuickCommand) => ('order' in a ? a.order ?? 0 : 0) - ('order' in b ? b.order ?? 0 : 0) || a.id.localeCompare(b.id))
      .map((item: AiPromptTemplate | AiQuickCommand) => 'enabled' in item
        ? { id: item.id, name: item.name, prompt: item.prompt, promptId: item.id }
        : { id: item.id, name: item.name, prompt: item.prompt })
  }, [fallback, statusQuery.data?.data.prompts])
  return { ...statusQuery, commands }
}
