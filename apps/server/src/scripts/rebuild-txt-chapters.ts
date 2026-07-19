import { eq } from 'drizzle-orm'
import type { Readable } from 'node:stream'
import { getDb } from '../db/client'
import { getStorage } from '../storage'
import { books } from '../db/schema'
import { detectTxtChapters } from '../formats/txt'

async function bufferFromStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function main() {
  const db = getDb()
  const storage = getStorage()

  const txtBooks = db.select().from(books).where(eq(books.format, 'txt')).all()
  console.log(`Found ${txtBooks.length} TXT books`)

  for (const book of txtBooks) {
    if (!(await storage.exists(book.filePath))) {
      console.warn(`Skip missing file: ${book.id}`)
      continue
    }
    const stream = await storage.get(book.filePath)
    const buffer = await bufferFromStream(stream)
    const content = buffer.toString('utf-8')
    const chapters = detectTxtChapters(content).map((c) => ({
      id: `ch-${c.startOffset}`,
      title: c.title,
      level: c.level,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
    }))

    const meta = { ...(book.meta ?? {}), chapters }
    db.update(books).set({ meta }).where(eq(books.id, book.id)).run()
    console.log(`Updated ${book.id}: ${chapters.length} chapters`)
  }

  console.log('Done')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
