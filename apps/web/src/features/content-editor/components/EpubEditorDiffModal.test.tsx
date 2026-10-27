import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/i18n'
import { createEpubEditorDraft } from '../lib/epub-editor-draft'
import EpubEditorDiffModal from './EpubEditorDiffModal'

describe('EpubEditorDiffModal', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('shows title changes and collapsible local document text, then saves from the modal', () => {
    const draft = createEpubEditorDraft({
      documents: [{ href: 'Text/one.xhtml', content: '<html><head><title>Private</title></head><body><p>Old passage</p></body></html>' }],
      tocEntries: [{ href: 'Text/one.xhtml', title: 'Old title', level: 1 }],
      spineOrder: ['Text/one.xhtml'],
    })
    draft.documents[0]!.content = '<html><head><title>Private</title></head><body><p>New passage</p></body></html>'
    draft.tocEntries[0] = { ...draft.tocEntries[0]!, title: 'New title' }
    const onSave = vi.fn()

    render(<EpubEditorDiffModal draft={draft} saving={false} onClose={vi.fn()} onSave={onSave} />)

    expect(screen.getByText('2 项变更')).toBeInTheDocument()
    expect(screen.getByText('Old title')).toBeInTheDocument()
    expect(screen.getAllByText('New title')).toHaveLength(2)
    expect(screen.getByText('Old passage')).toBeInTheDocument()
    expect(screen.queryByText('Private')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /New title/ }))
    expect(screen.queryByText('Old passage')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledOnce()
  })
})
