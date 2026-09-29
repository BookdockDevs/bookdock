import { useState } from 'react'

import type { CatalogBook, CatalogBookUpdateReq, CatalogVersion, CatalogVersionUpdateReq } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useLibraryCategories, useLibraryTags, useUpdateCatalogBook, useUpdateCatalogVersion } from '../hooks'
import { formatAuthorList } from '@/lib/utils'

import { parseAuthorList } from './book-detail/types'

import { versionTabLabel } from '../book-row'

/**
 * One edit session for a work and its visible version - never across
 * versions. The detail locks its version tabs while this dialog is open, so
 * the draft always belongs to exactly one version context: the work's own
 * metadata in the first section, the version's label and inheritance
 * overrides in the second. An override left on "follow the work" is sent as
 * null and restores inheritance instead of copying the value down.
 */
interface WorkEditDialogProps {
  work: CatalogBook
  libraryId: string
  version: CatalogVersion
  versionIndex: number
  onClose: () => void
}

const inputClass = 'rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200'
const labelClass = 'font-medium text-xs text-stone-500 dark:text-stone-400'

export default function WorkEditDialog({ work, libraryId, version, versionIndex, onClose }: WorkEditDialogProps) {
  const _ = useTranslation()
  const updateBook = useUpdateCatalogBook()
  const updateVersion = useUpdateCatalogVersion()
  const { data: categoriesData } = useLibraryCategories(libraryId)
  const { data: tagsData } = useLibraryTags(libraryId)

  const [title, setTitle] = useState(work.title)
  const [authorsText, setAuthorsText] = useState(formatAuthorList(work.authors, work.author))
  const [description, setDescription] = useState(work.description)
  const [categoryId, setCategoryId] = useState<string | null>(work.categoryId)
  const [tagIds, setTagIds] = useState<string[]>(work.tags.map((t) => t.id))

  const [versionName, setVersionName] = useState(version.name)
  const [followTitle, setFollowTitle] = useState(version.title === null)
  const [overrideTitle, setOverrideTitle] = useState(version.title ?? '')
  const [followAuthor, setFollowAuthor] = useState(version.authors === null)
  const [overrideAuthorsText, setOverrideAuthorsText] = useState(formatAuthorList(version.authors ?? [], version.author ?? ''))
  const [followDescription, setFollowDescription] = useState(version.description === null)
  const [overrideDescription, setOverrideDescription] = useState(version.description ?? '')

  const saving = updateBook.isPending || updateVersion.isPending
  const fallback = _('library.versionFallback', { n: versionIndex + 1 }) as string

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  async function handleSave() {
    const name = title.trim()
    if (!name) return
    const bookPatch: CatalogBookUpdateReq = {}
    if (name !== work.title) bookPatch.title = name
    const wantAuthors = parseAuthorList(authorsText)
    const initialAuthors = parseAuthorList(formatAuthorList(work.authors, work.author))
    if (wantAuthors.join('\n') !== initialAuthors.join('\n')) bookPatch.authors = wantAuthors
    if (description !== work.description) bookPatch.description = description
    if (categoryId !== work.categoryId) bookPatch.categoryId = categoryId
    const initialTagIds = work.tags.map((t) => t.id)
    if (tagIds.length !== initialTagIds.length || tagIds.some((id) => !initialTagIds.includes(id))) {
      bookPatch.tagIds = tagIds
    }
    const versionPatch: CatalogVersionUpdateReq = {}
    if (versionName.trim() !== version.name) versionPatch.name = versionName.trim()
    const wantTitle = followTitle ? null : overrideTitle.trim()
    if (wantTitle !== version.title) versionPatch.title = wantTitle || null
    if (followAuthor) {
      if (version.authors !== null) versionPatch.authors = null
    } else {
      const wantAuthors = parseAuthorList(overrideAuthorsText)
      const initialAuthors = parseAuthorList(formatAuthorList(version.authors ?? [], version.author ?? ''))
      if (wantAuthors.join('\n') !== initialAuthors.join('\n')) versionPatch.authors = wantAuthors
    }
    if (!followDescription && overrideDescription !== (version.description ?? '')) {
      versionPatch.description = overrideDescription
    } else if (followDescription && version.description !== null) {
      versionPatch.description = null
    }
    try {
      const requests: Promise<unknown>[] = []
      if (Object.keys(bookPatch).length > 0) {
        requests.push(updateBook.mutateAsync({ libraryId, libraryBookId: work.id, patch: bookPatch }))
      }
      if (Object.keys(versionPatch).length > 0) {
        requests.push(updateVersion.mutateAsync({ libraryId, libraryBookId: work.id, versionLinkId: version.id, patch: versionPatch }))
      }
      if (requests.length === 0) {
        onClose()
        return
      }
      await Promise.all(requests)
      notify.success(_('library.catalogWorkSaved'))
      onClose()
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.catalogWorkSaveFailed'))
    }
  }

  function overrideRow(label: string, follow: boolean, onFollow: (v: boolean) => void, value: string, onValue: (v: string) => void, effective: string, maxLength: number) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className={labelClass}>{label}</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => onFollow(e.target.checked)}
              className="h-3.5 w-3.5 accent-stone-900 dark:accent-stone-100"
            />
            {_('library.followWork')}
          </label>
        </div>
        {!follow && (
          <input
            value={value}
            onChange={(e) => onValue(e.target.value)}
            maxLength={maxLength}
            className={inputClass}
          />
        )}
        <p className="text-xs text-stone-400">
          {_('library.effectiveValue', { value: effective || _('library.unknown') })}
        </p>
      </div>
    )
  }

  return (
    <Modal
      title={_('library.editWork')}
      onClose={onClose}
      closeLabel={_('library.close')}
      size="wide"
      footer={(
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {_('library.cancel')}
          </Button>
          <Button disabled={title.trim().length === 0 || saving} onClick={() => void handleSave()}>
            {_('library.save')}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3 rounded-2xl border border-stone-200/80 bg-stone-50/30 p-4 dark:border-stone-800 dark:bg-stone-800/20">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
            {_('library.workInfo')}
          </h3>
          <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
            <span className={labelClass}>{_('library.libraryName')}</span>
            <input aria-label={_('library.libraryName')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
            <span className={labelClass}>{_('library.authorLabel')}</span>
            <input value={authorsText} onChange={(e) => setAuthorsText(e.target.value)} maxLength={500} placeholder={_('library.authorListHint')} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
            <span className={labelClass}>{_('library.libraryDescription')}</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} className={`${inputClass} resize-y`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
            <span className={labelClass}>{_('library.categoryLabel')}</span>
            <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)} className={inputClass}>
              <option value="">{_('library.uncategorized')}</option>
              {(categoriesData?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          {(tagsData?.data ?? []).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>{_('library.tagLabel')}</span>
              <div className="flex flex-wrap gap-1.5">
                {(tagsData?.data ?? []).map((tag) => (
                  <label
                    key={tag.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-all ${tagIds.includes(tag.id)
                      ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                      : 'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300'}`}
                  >
                    <input
                      type="checkbox"
                      checked={tagIds.includes(tag.id)}
                      onChange={() => toggleTag(tag.id)}
                      className="sr-only"
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-stone-200/80 bg-stone-50/30 p-4 dark:border-stone-800 dark:bg-stone-800/20">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
            {_('library.versionInfo', { name: versionTabLabel(version.name, fallback) })}
          </h3>
          <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
            <span className={labelClass}>{_('library.versionName')}</span>
            <input value={versionName} onChange={(e) => setVersionName(e.target.value)} maxLength={120} placeholder={fallback} className={inputClass} />
          </label>
          {overrideRow(_('library.libraryName'), followTitle, setFollowTitle, overrideTitle, setOverrideTitle, version.effective.title, 300)}
          {overrideRow(_('library.authorLabel'), followAuthor, setFollowAuthor, overrideAuthorsText, setOverrideAuthorsText, formatAuthorList(version.effective.authors, version.effective.author), 500)}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className={labelClass}>{_('library.libraryDescription')}</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                <input
                  type="checkbox"
                  checked={followDescription}
                  onChange={(e) => setFollowDescription(e.target.checked)}
                  className="h-3.5 w-3.5 accent-stone-900 dark:accent-stone-100"
                />
                {_('library.followWork')}
              </label>
            </div>
            {!followDescription && (
              <textarea value={overrideDescription} onChange={(e) => setOverrideDescription(e.target.value)} maxLength={4000} rows={3} className={`${inputClass} resize-y`} />
            )}
            <p className="text-xs text-stone-400">
              {_('library.effectiveValue', { value: version.effective.description || _('library.unknown') })}
            </p>
          </div>
        </section>
      </div>
    </Modal>
  )
}
