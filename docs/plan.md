# Bookdock Roadmap

> Bookdock is a self-hosted Web library and reader for EPUB and TXT. This public roadmap contains the current product direction, not the internal feature history. Detailed decisions live in `docs/local/plan.md`.

## Product direction

- Web is the current primary platform.
- EPUB and TXT remain the main formats.
- Near-term mobile work means responsive layout and touch usability, not Android-only features.
- Online book sources are out of scope.
- AI, Android, browser extensions, and additional storage backends are later-stage work.

## Current release track

- [x] Close the current reader compatibility patch and regression pass
- [x] Make in-book search respect visible text transforms, including Simplified/Traditional conversion
- [x] Publish v0.1 with a reproducible Docker image, Compose setup, health check, CI smoke test, and `DATA_DIR` persistence
- [x] Document manual volume backup and restore

v0.1 does not include an in-app backup center or online restore. Docker Hub is the planned public image registry, but the image can also be built locally.

## Next Web milestones

- [x] Basic mobile Web usability: responsive library, reader panels, touch targets, table of contents, progress, annotations, login, and upload
- [ ] Author and series navigation using existing book metadata
- [ ] A small annotation output feature: Markdown export or Markdown deep links

The following are intentionally excluded from this Web milestone: brightness control, volume-key navigation, E-Ink mode, native-style PWA behavior, and deep 3×3 gesture customization.

## Medium term

- EPUB/TXT quality improvements: footnotes, vertical-writing feasibility, annotation UX, and demand-driven settings coverage
- Library organization: shelf grouping and batch metadata editing when the need is demonstrated
- JSON import/export after the backup data model is defined
- Browser extension after the Web library and reader are stable
- Open API, OPDS, Calibre, and note-taking integrations based on real consumers
- Structured logs and deployment examples where operational use justifies them

FTS5 is conditional: it will be considered only if real library scale shows that title/author search is insufficient. Virtual scrolling is also demand-driven because the current reader already uses on-demand loading, Range requests, and caches.

## Long-term reserve

- Android client and native capabilities such as brightness, E-Ink, hardware keys, wake lock, and system TTS
- TTS, dictionary, translation, advanced annotation, custom CSS, code highlighting, and bionic reading
- AI summaries, translation, contextual Q&A, and reading knowledge tools
- S3/MinIO, WebDAV, and other storage drivers
- OPDS/Calibre compatibility and broader synchronization

## Not planned for the current product phase

- Online book-source engines and rule marketplaces
- PDF/OCR, MOBI/AZW3, and CBZ/CBR support
- Kubernetes/Helm and complex self-healing orchestration
- Social ratings, comments, and public shared shelves
- An in-app backup center before its data scope, consistency, security, and rollback model are designed
