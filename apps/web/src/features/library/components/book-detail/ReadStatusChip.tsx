import type { BookListItem, ReadStatus } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import { useUpdateBook } from '../../hooks'
import { READ_STATUS_OPTIONS, STATUS_DOT, statusLabelKey } from '../read-status'
import DetailFieldMenu from './DetailFieldMenu'

interface ReadStatusChipProps {
  book: BookListItem
  readOnly: boolean
  onFilter: () => void
}

export default function ReadStatusChip({ book, readOnly, onFilter }: ReadStatusChipProps) {
  const _ = useTranslation()
  const updateBook = useUpdateBook()

  return (
    <DetailFieldMenu
      key={book.id}
      label={<><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[book.readStatus]}`} />{_(statusLabelKey(book.readStatus))}</>}
      editLabel={_('library.editReadStatus')}
      value={book.readStatus}
      options={READ_STATUS_OPTIONS.map((option) => ({
        value: option.value,
        label: _(option.labelKey),
        icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={option.iconClass} aria-hidden="true">{option.icon}</svg>,
      }))}
      editable={!readOnly}
      disabled={updateBook.isPending}
      onFilter={onFilter}
      onSelect={(value) => updateBook.mutate({ bookId: book.id, readStatus: value as ReadStatus })}
    />
  )
}
