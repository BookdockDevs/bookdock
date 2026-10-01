/**
 * Stage 4 acceptance matrix (8.1/8.2/8.7 + 9.6/9.7): boots a REAL isolated
 * instance (migrations -> Phase 2 backfill -> book-id retarget) on localfs
 * storage, then drives publish -> collect -> appendix -> acknowledge -> fork ->
 * revoke end to end. Run: DATA_DIR=<empty dir> pnpm dlx tsx scripts/acceptance-revision-matrix.ts
 */
import { sql } from 'drizzle-orm'

import { getDb, runMigrations } from '../src/db/client.js'
import { runPhase2StartupBackfill } from '../src/modules/libraries/startup-backfill.js'
import { setupUser } from '../src/modules/auth/auth.service.js'
import { createUser } from '../src/modules/users/users.service.js'
import {
  addMember,
  createLibrary,
  removeMember,
  updateLibrary,
} from '../src/modules/libraries/libraries.service.js'
import {
  acknowledgeReadRevision,
  appendCityVersionContent,
  appendTxtBookContent,
  attachPublishedTo,
  attachUnreadUpdate,
  getActiveBook,
  pushPrivateToVersion,
  reTocCityVersion,
  uploadBook,
  uploadCatalogBook,
} from '../src/modules/books/books.service.js'
import { deleteCatalogVersion, getCatalogBook } from '../src/modules/libraries/catalog.service.js'
import { publishPrivateBook } from '../src/modules/libraries/publish.service.js'
import { addToPrivateLibrary } from '../src/modules/libraries/collect.service.js'
import { updateCatalogVersion } from '../src/modules/libraries/catalog.service.js'
import { forkLocalBook } from '../src/modules/libraries/fork.service.js'
import { getStorage } from '../src/storage/index.js'
import { registerParser } from '../src/formats/registry.js'
import { TxtParser } from '../src/formats/txt.js'

registerParser(new TxtParser())

let failures = 0
function step(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`PASS  ${name}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}`, extra ?? '')
  }
}
async function rejectsCode(fn: () => Promise<unknown>) {
  try {
    await fn()
    return null
  } catch (err) {
    return (err as { code?: string }).code ?? String(err)
  }
}
async function readBytes(key: string) {
  const stream = await getStorage().get(key)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

const txt = (body: string, name: string) => new File([body], name, { type: 'text/plain' })

async function main() {
  // 1. Real boot chain on an isolated DATA_DIR.
  await runMigrations({ beforeRetarget: runPhase2StartupBackfill })
  const db = getDb()
  const violations = db.all(sql.raw('PRAGMA foreign_key_check')) as Array<unknown>
  step('fresh boot leaves zero foreign-key violations', violations.length === 0, violations)
  const refs = db.all(sql.raw(`PRAGMA foreign_key_list("ai_book_indexes")`)) as Array<{
    from: string
    table: string
  }>
  step(
    'book-id retarget applied at boot',
    refs.some((r) => r.from === 'book_id' && r.table === 'book_versions'),
    refs,
  )

  // 2. Owner setup + member + public city.
  const setup = await setupUser('owner', 'password123')
  const ownerId = setup.user.id
  const member = await createUser('member', 'password123')
  const memberId = member.id
  const city = await createLibrary({ userId: ownerId, isGuest: false }, { name: 'City', visibility: 'public' })
  step('owner setup and member creation', Boolean(ownerId && memberId && city.id))

  // 3. Upload + publish snapshot.
  const up = await uploadBook(ownerId, txt('第一章\n正文内容', 'novel.txt'))
  const pub = await publishPrivateBook(ownerId, city.id, { bookId: up.book.id })
  step('publish creates an independent city version', pub.bookVersionId !== up.book.id && Boolean(pub.versionLinkId))

  // 4. Collect pins rev 1; city appendix publishes rev 2 and moves every
  // holder's pin at once — no follow-up action.
  await addToPrivateLibrary(memberId, city.id, pub.versionLinkId)
  const rev1Path = (await getActiveBook(memberId, pub.bookVersionId)).filePath
  const rev1Bytes = await readBytes(rev1Path)
  // City content updates go through the manager city-append action (books
  // routes require a private link, which a city version never has).
  const published2 = await appendCityVersionContent(
    ownerId, city.id, pub.libraryBookId, pub.versionLinkId, '第二章\n新增内容',
  )
  step('city update appends rev 2', published2.revisionNo === 2)
  step('appendix moves the B to the new bytes', (await getActiveBook(memberId, pub.bookVersionId)).filePath !== rev1Path)
  step('appendix marks an unread update', 'hasUnreadUpdate' in (await attachUnreadUpdate(memberId, { id: pub.bookVersionId, kind: 'shared' as const })))

  // 5. Acknowledge follows explicitly; old bytes stay servable; both blobs retained.
  const rev2 = (await getActiveBook(memberId, pub.bookVersionId)).revisionId
  await acknowledgeReadRevision(memberId, pub.bookVersionId, rev2)
  step('acknowledge clears the unread mark', !('hasUnreadUpdate' in (await attachUnreadUpdate(memberId, { id: pub.bookVersionId, kind: 'shared' as const }))))
  const rev2Path = (await getActiveBook(memberId, pub.bookVersionId)).filePath
  step('post-acknowledge reads the new bytes', !(await readBytes(rev2Path)).equals(rev1Bytes))
  step('old revision bytes still servable', (await readBytes(rev1Path)).equals(rev1Bytes))
  step('both blobs retained', (await getStorage().exists(rev1Path)) && (await getStorage().exists(rev2Path)))
  const head = await getStorage().get(rev2Path, { start: 0, end: 1 })
  const headChunks: Buffer[] = []
  for await (const chunk of head) headChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  step('range read serves EPUB magic', Buffer.concat(headChunks).toString('binary').startsWith('PK'))

  // 6. Fork to an independent C; source untouched afterwards.
  const forked = await forkLocalBook(memberId, pub.bookVersionId)
  step('fork yields a new version', forked.bookVersionId !== pub.bookVersionId)
  await appendTxtBookContent(memberId, forked.bookVersionId, '第三章\n分叉内容')
  step(
    'post-fork source bytes unchanged',
    (await readBytes(rev2Path)).length > 0 &&
      (await getActiveBook(ownerId, pub.bookVersionId)).filePath === rev2Path,
  )
  await expectRejectsOnC(memberId, forked.bookVersionId)

  // 6b. Push + owns-source: draft on, push to the city, own-collect refused.
  const upA = await uploadBook(ownerId, txt('第一章\n原稿', 'draft.txt'))
  const pubA = await publishPrivateBook(ownerId, city.id, { bookId: upA.book.id })
  await appendTxtBookContent(ownerId, upA.book.id, '第二章\n续写')
  const pushed = await pushPrivateToVersion(ownerId, city.id, pubA.libraryBookId, pubA.versionLinkId)
  step('push appends the draft as rev 2', pushed.revisionNo === 2 && pushed.alreadyUpToDate === false && pushed.diverged === false)
  const publishedTo = await attachPublishedTo(ownerId, { id: upA.book.id })
  step(
    'published-to lists the city target in sync',
    'publishedTo' in publishedTo
    && (publishedTo as { publishedTo: Array<{ inSync: boolean }> }).publishedTo.some((e) => e.inSync),
  )
  step(
    'collecting own published source is refused',
    (await rejectsCode(() => addToPrivateLibrary(ownerId, city.id, pubA.versionLinkId))) === 'ALREADY_OWNS_SOURCE',
  )
  const detailA = await getCatalogBook(ownerId, city.id, pubA.libraryBookId)
  step(
    'verdict marks owns-source',
    detailA.versions.find((v) => v.id === pubA.versionLinkId)?.ownsSource === true,
  )
  // Same bytes the owner already holds, but this account does not, so the
  // owns-source verdict must not block it.
  const nonHolderCollect = await addToPrivateLibrary(memberId, city.id, pubA.versionLinkId)
  step(
    'non-holder collects normally',
    nonHolderCollect.bookVersionId === pubA.bookVersionId && !nonHolderCollect.alreadyExists,
    nonHolderCollect,
  )
  await appendCityVersionContent(ownerId, city.id, pubA.libraryBookId, pubA.versionLinkId, '第三章\n馆主修订')
  const recollect = await addToPrivateLibrary(ownerId, city.id, pubA.versionLinkId)
  step('collect allowed after the city moved', recollect.alreadyExists === false)

  // 6c. Member lane: switch on, member uploads + maintains own versions.
  await updateLibrary(ownerId, city.id, { allowMemberUpload: true })
  await addMember(ownerId, city.id, { userId: memberId, role: 'member' })
  const memberWork = await uploadCatalogBook(city.id, memberId, txt('第一章\n成员稿', 'member.txt'), { title: 'Member Work' })
  const memberAppend = await appendCityVersionContent(memberId, city.id, memberWork.libraryBookId, memberWork.versionLinkId, '第二章\n续')
  step('member appends own version', memberAppend.revisionNo === 2)
  const memberRetoc = await reTocCityVersion(memberId, city.id, memberWork.libraryBookId, memberWork.versionLinkId, null, [
    { level: 1, regex: '^第(.+)$', replacement: '$1' },
  ])
  step('member re-splits own version', memberRetoc.revisionNo === 3)
  step(
    "member cannot touch others' versions",
    (await rejectsCode(() => appendCityVersionContent(memberId, city.id, pubA.libraryBookId, pubA.versionLinkId, 'x'))) === 'FORBIDDEN',
  )
  // The member's only version on this work: the library trash takes the whole
  // work rather than deleting the row, so the assertion is on that outcome.
  const memberDelete = await deleteCatalogVersion(memberId, city.id, memberWork.libraryBookId, memberWork.versionLinkId)
  const memberWorkRow = getDb()
    .all(sql`SELECT deleted_at AS "deletedAt" FROM library_books WHERE id = ${memberWork.libraryBookId}`)
  step(
    'member deletes own version',
    memberDelete.trashed === true && memberWorkRow.length === 1 && memberWorkRow[0]!.deletedAt !== null,
    { memberDelete, memberWorkRow },
  )
  await updateLibrary(ownerId, city.id, { allowMemberUpload: false })
  step(
    'switch-off closes member uploads',
    (await rejectsCode(() => uploadCatalogBook(city.id, memberId, txt('x', 'x.txt'), {}))) === 'FORBIDDEN',
  )

  // 7. Private-library revoke flow on a second work.
  const club = await createLibrary({ userId: ownerId, isGuest: false }, { name: 'Club', visibility: 'private' })
  const up2 = await uploadBook(ownerId, txt('第一章\n另一正文', 'other.txt'))
  const pub2 = await publishPrivateBook(ownerId, club.id, { bookId: up2.book.id })
  await addMember(ownerId, club.id, { userId: memberId, role: 'member' })
  await addToPrivateLibrary(memberId, club.id, pub2.versionLinkId)
  await removeMember(ownerId, club.id, memberId)
  step('revoked source refuses acknowledge', (await rejectsCode(() => acknowledgeReadRevision(memberId, pub2.bookVersionId, 'missing'))) !== null)
  step('revoked source refuses fork', (await rejectsCode(() => forkLocalBook(memberId, pub2.bookVersionId))) === 'BOOK_NOT_FOUND')

  // 8. Unlisted source refuses fork on a live B (separate member card).
  const member2 = await createUser('member2', 'password123')
  await addMember(ownerId, city.id, { userId: member2.id, role: 'member' })
  await addToPrivateLibrary(member2.id, city.id, pub.versionLinkId)
  await updateCatalogVersion(ownerId, city.id, pub.libraryBookId, pub.versionLinkId, { status: 'unlisted' })
  step('unlisted source refuses fork', (await rejectsCode(() => forkLocalBook(member2.id, pub.bookVersionId))) === 'BOOK_NOT_FOUND')

  const tail = db.all(sql.raw('PRAGMA foreign_key_check')) as Array<unknown>
  step('matrix leaves zero foreign-key violations', tail.length === 0, tail)

  if (failures > 0) {
    console.log(`\n${failures} step(s) FAILED`)
    process.exitCode = 1
  } else {
    console.log('\nAll acceptance steps passed')
  }
}

async function expectRejectsOnC(memberId: string, versionId: string) {
  step('no unread mark on a C', !('hasUnreadUpdate' in (await attachUnreadUpdate(memberId, { id: versionId, kind: 'personal' as const }))))
  step('fork on a C is refused', (await rejectsCode(() => forkLocalBook(memberId, versionId))) === 'FORBIDDEN')
}

await main()
