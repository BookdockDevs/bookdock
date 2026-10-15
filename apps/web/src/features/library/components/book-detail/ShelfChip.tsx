import { useTranslation } from '@/hooks/useTranslation'

import { useShelves, useUpdateBookMembership } from '../../hooks'
import DetailFieldMenu from './DetailFieldMenu'

interface ShelfChipProps {
  bookId: string
  shelfId: string | null
  shelfName?: string
  membershipReady: boolean
  membershipError?: boolean
  onFilter: () => void
}

export default function ShelfChip({ bookId, shelfId, shelfName, membershipReady, membershipError = false, onFilter }: ShelfChipProps) {
  const _ = useTranslation()
  const shelves = useShelves()
  const updateMembership = useUpdateBookMembership()
  const options: Array<{ value: string | null; label: string }> = [
    { value: null, label: _('library.uncategorized') },
    ...(shelves.data?.data ?? []).map((shelf) => ({ value: shelf.id, label: shelf.name })),
  ]
  if (shelfId && !options.some((option) => option.value === shelfId)) {
    options.push({ value: shelfId, label: shelfName ?? _('library.shelves') })
  }

  const labelText = shelfName
    ? shelfName
    : shelfId
      ? (shelfName ?? _('library.shelves'))
      : membershipError
        ? _('library.shelfUnavailable')
        : membershipReady
          ? _('library.uncategorized')
          : _('library.shelves')

  const isBusy = !membershipError && !shelves.isError && (!membershipReady || shelves.isLoading || updateMembership.isPending)

  return (
    <DetailFieldMenu
      key={bookId}
      label={<><span aria-hidden="true">📁</span>{labelText}</>}
      editLabel={_('library.editShelf')}
      value={shelfId}
      options={options}
      editable
      busy={isBusy}
      disabled={!membershipReady || !shelves.data || shelves.isError || updateMembership.isPending || membershipError}
      onFilter={onFilter}
      onSelect={(value) => updateMembership.mutate({ bookId, shelfId: value })}
    />
  )
}
