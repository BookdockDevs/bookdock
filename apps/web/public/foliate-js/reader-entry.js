import { View } from './view.js'
import { EPUB } from './epub.js'
import { Overlayer } from './overlayer.js'
import { configure, ZipReader, BlobReader, TextWriter, BlobWriter } from './vendor/zip.js'

globalThis.FoliateReader = {
  View,
  EPUB,
  Overlayer,
  configure,
  ZipReader,
  BlobReader,
  TextWriter,
  BlobWriter,
}
