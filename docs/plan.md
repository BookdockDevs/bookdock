# Bookdock Roadmap

> Bookdock is a self-hosted Web library and reader for EPUB and TXT. This public roadmap contains the current product direction, not the internal feature history. Detailed decisions live in `docs/local/plan.md`.

## Product direction

- Web is the current primary platform.
- EPUB and TXT remain the main formats.
- Near-term mobile work means responsive layout and touch usability, not Android-only features.
- Online book sources are out of scope.
- Android and browser extensions are later-stage work. WebDAV and S3-compatible storage connections and tiered book storage are implemented for v0.5.0. AI currently provides a deliberately small, read-only reader workflow.

## Current release track

- [x] Close the current reader regression pass
- [x] Make in-book search respect visible text replacements, including Simplified/Traditional conversion
- [x] Publish v0.2 with a reproducible Docker image, Compose setup, health check, CI smoke test, and `DATA_DIR` persistence
- [x] Deliver the read-only AI reading workflow with provider profiles, bounded tools, retrieval, citations, durable history, retry, and cancellation
- [x] Start v0.2 from a clean database baseline without the 0.1 schema upgrade path
- [x] Document manual volume backup and restore

The private v0.2 release does not include an in-app backup center or online restore. The image can be built locally or published to the operator's chosen registry.

## Next Web milestones

- [x] Basic mobile Web usability: responsive library, reader panels, touch targets, table of contents, progress, annotations, login, and upload
- [x] Author and series navigation using existing book metadata
- [x] Annotation output with selection, Markdown/plain-text copy, Markdown/plain-text/CSV downloads, and optional private deep links
- [x] Close EPUB footnote compatibility using the existing foliate footnote support
- [x] Add minimal structured server logs and request context for self-hosted troubleshooting
- [x] Web TTS R09 baseline: visible-text-consistent playback, chapter/selection start, voice/rate controls, sentence highlighting, follow decoupling, chapter continuation, online prefetch, and user-owned AI voice services
- [x] Legado book source integration: expose the user's own library to the Legado app as a read-only source with explore/search, replacement-aware chapters, media projection, and optional login-free scoped access keys (distinct from the out-of-scope online book-source engines)
- [ ] Web TTS follow-up: word-boundary highlighting, adaptive audible-time prefetch/backpressure, persistent/offline cache, background/media controls, sleep timer, pitch-preserving rate change, and multi-role narration

The following are intentionally excluded from this Web milestone: brightness control, volume-key navigation, E-Ink mode, native-style PWA behavior, and deep 3×3 gesture customization.

## Medium term

- Further EPUB/TXT quality improvements after the current TTS/AI queue: vertical-writing feasibility, annotation UX, and demand-driven settings coverage
- Library organization: two-level shared categories and hierarchical subtree counts delivered in v0.4.3; batch metadata editing remains demand-driven
- Rule JSON import/export: delivered for replacement rules and TOC presets in v0.4.3
- Structured search expressions: delivered in v0.4.4
- Reader idea discussions: source-bound public comments, replies and likes delivered in v0.4.4
- External storage: WebDAV and S3-compatible browsing/import, tiered book storage with a bounded local cache, historical-book migration, and restore-to-local controls implemented for v0.5.0
- AI retrieval: on-demand chapter search within spoiler prevention bounds replaces persistent chunk indexes in v0.5.0
- Browser extension after the Web library and reader are stable: first milestone is a lightweight local EPUB/TXT reader with a flat local library, plus Bookdock Instance connection, drag-to-upload, and automatic opening by `bookId`; Web-only custom fonts/themes/TOC rules, annotations, AI, TTS, and web clipping remain out of scope.
- Open API, feed, and note-taking integrations based on real consumers
- Additional deployment examples where operational use justifies them

FTS5 is conditional: it will be considered only if real library scale shows that title/author search is insufficient. Virtual scrolling is also demand-driven because the current reader already uses on-demand loading, Range requests, and caches.

## Long-term reserve

- Android client and native capabilities such as brightness, E-Ink, hardware keys, wake lock, and system TTS
- Advanced TTS engines/offline audio, dictionary, translation, advanced annotation, custom CSS, code highlighting, and bionic reading
- Whole-book or cross-book AI retrieval, autonomous agents, knowledge graphs, and advanced reading knowledge tools
- Additional storage providers beyond the implemented WebDAV and S3-compatible connections, based on operational demand
- Feed compatibility and broader synchronization

## Not planned for the current product phase

- Online book-source engines and rule marketplaces
- PDF/OCR, MOBI/AZW3, and CBZ/CBR support
- Kubernetes/Helm and complex self-healing orchestration
- Full public social networks, external community ratings/reviews, and public discovery feeds (source-bound idea discussion within shared libraries is supported as of v0.4.4)
- An in-app backup center before its data scope, consistency, security, and rollback model are designed

