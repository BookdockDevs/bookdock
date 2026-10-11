import { useEffect, useRef, type RefObject } from 'react'

import {
  BlockTypeSelect, BoldItalicUnderlineToggles, CreateLink, InsertCodeBlock,
  InsertTable, ListsToggle, MDXEditor, UndoRedo, codeBlockPlugin, codeMirrorPlugin,
  headingsPlugin, imagePlugin, linkDialogPlugin, linkPlugin, listsPlugin,
  quotePlugin, tablePlugin, toolbarPlugin,
  type MDXEditorMethods,
} from '@mdxeditor/editor'

import { contentFileIdFromUrl } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

interface ReviewRichEditorProps {
  body: string
  disabled: boolean
  onChange: (body: string) => void
  onUnsupported: () => void
  insertRef: RefObject<((text: string) => void) | null>
}

export default function ReviewRichEditor({ body, disabled, onChange, onUnsupported, insertRef }: ReviewRichEditorProps) {
  const _ = useTranslation()
  const dark = useUiStore((state) => state.systemTheme === 'dark')
  const editor = useRef<MDXEditorMethods>(null)
  const lastBody = useRef(body)
  useEffect(() => {
    insertRef.current = (text) => editor.current?.focus(() => editor.current?.insertMarkdown(text), { defaultSelection: 'rootEnd' })
    return () => { insertRef.current = null }
  }, [insertRef])
  useEffect(() => {
    if (body !== lastBody.current) {
      lastBody.current = body
      editor.current?.setMarkdown(body)
    }
  }, [body])

  return (
    <MDXEditor
      ref={editor}
      markdown={body}
      readOnly={disabled}
      placeholder={_('review.bodyPlaceholder')}
      className={cn(dark && 'dark-theme', "rounded-lg border border-stone-200 bg-white text-stone-800 [--basePageBg:var(--color-white)] [--baseText:var(--color-stone-800)] [&.mdxeditor-popup-container]:z-[60] dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100 dark:[--basePageBg:var(--color-stone-900)] dark:[--baseText:var(--color-stone-100)] [&_.cm-editor]:bg-transparent! [&_.cm-editor]:text-stone-800! [&_.cm-gutters]:bg-transparent! [&_.cm-gutters]:text-stone-500! [&_.cm-content]:text-stone-800 [&_.cm-activeLine]:bg-stone-100! [&_.cm-activeLineGutter]:bg-stone-100! [&_.cm-cursor]:border-stone-800! dark:[&_.cm-editor]:text-stone-100! dark:[&_.cm-content]:text-stone-100 dark:[&_.cm-activeLine]:bg-stone-800! dark:[&_.cm-activeLineGutter]:bg-stone-800! dark:[&_.cm-cursor]:border-stone-100!")}
      contentEditableClassName="min-h-48 max-h-96 overflow-auto px-3 py-3 text-sm leading-relaxed [&_p]:whitespace-pre-wrap [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_img]:max-w-full"
      translation={(key, defaultValue, values) => _(`reviewEditor.${key}`, { defaultValue, ...values })}
      onChange={(markdown, initialNormalize) => {
        if (initialNormalize) return
        lastBody.current = markdown
        onChange(markdown)
      }}
      onError={onUnsupported}
      plugins={[
        headingsPlugin(), listsPlugin(), quotePlugin(), linkPlugin(), linkDialogPlugin(),
        tablePlugin(), codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
        codeMirrorPlugin({ autoLoadLanguageSupport: false, codeBlockLanguages: { '': _('reviewEditor.codeBlock.plainText'), js: 'JavaScript', ts: 'TypeScript', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', json: 'JSON', css: 'CSS', html: 'HTML', bash: 'Shell', sql: 'SQL' } }),
        imagePlugin({
          disableImageResize: true,
          disableImageSettingsButton: true,
          allowSetImageDimensions: false,
          imagePreviewHandler: async (url) => contentFileIdFromUrl(url) ? url : '',
        }),
        toolbarPlugin({ toolbarClassName: 'flex flex-wrap gap-1 rounded-t-lg border-b border-stone-200 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-900', toolbarContents: () => <><UndoRedo /><BlockTypeSelect /><BoldItalicUnderlineToggles options={['Bold', 'Italic']} /><ListsToggle options={['bullet', 'number']} /><CreateLink /><InsertTable /><InsertCodeBlock /></> }),
      ]}
    />
  )
}
