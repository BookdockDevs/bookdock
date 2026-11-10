import SourceBookCover from '@/features/reading-data/SourceBookCover'
import { isDeviceBook } from '@/features/reading-data/book-source'

import BookCoverImage from './BookCoverImage'
import type { BookCoverProps } from './BookCoverImage'

export type { CoverSource, BookCoverProps } from './BookCoverImage'

export default function BookCover(props: BookCoverProps) {
  if (isDeviceBook(props.book.ref) && props.coverSrc === undefined) return <SourceBookCover {...props} />
  return <BookCoverImage {...props} />
}
