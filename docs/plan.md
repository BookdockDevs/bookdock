# Bookdock Roadmap

> Public overview of planned work. Detailed implementation tracking and gap analysis live in the private docs. This file keeps a curated, external-facing view.

---

## P0 — Current sprint

- [ ] **Reading-status filtering** — show unread / reading / finished in the library, filter by status
- [ ] **Book download** — download entry on the book card
- [ ] **Sorting enhancements** — sort by reading progress and last-read time
- [ ] **Reader error fallback** — friendly message + return-to-library when load fails

## P1 — Near term

**Reading**

- Regex filter rules (hide / replace content)
- Reading settings presets (one-click named configs)
- Large-chapter performance optimization
- Pagination wheel throttle
- WeRead—style progress strip (fine/coarse granularity)
- Annotation system (highlight / underline / squiggly + color + note)
- Settings panel (text direction, reading mode, brightness)
- Reading theme presets (multiple palettes + custom + background texture)
- Global vs per-book settings separation
- Simplified/Traditional conversion
- Configurable header/footer info bar (chapter/title, progress, time, battery)
- Custom tap zones for page turning

**Library**

- Book detail page
- Batch operations (multi-select → shelf/tag/delete/download)
- Author/series views
- Shelf grouping

**Search**

- FTS5 full-text search (title + author + content)
- Search history & suggestions

**Ops**

- DATA_DIR backup/restore doc

**Architecture**

- FoliateReader split
- foliate-js local-modification inventory

## P2 — Medium term

- Reading statistics (daily duration, cumulative words, heatmap)
- Vertical writing mode
- Bookmark ordering + on-page markers
- Dictionary lookup + selection translation
- Footnote popups
- Annotation export / import
- Reading ruler
- Enhanced full-text search (regex / case / whole-word)
- Custom CSS editor
- Code syntax highlighting
- Pdf re-layout support
- PWA mobile adaptation
- CLI tool
- JSON backup import/export

## P3 — Long-term / reserve

- MOBI/AZW3, CBZ/CBR
- OCR for scanned PDFs
- Configurable chapter-splitting rules
- TTS, paragraph mode, RSVP speed reading, auto-scroll
- Desktop client (Tauri), browser extension, E-Ink mode
- Multi-user + permissions, shared shelf/tag
- S3/MinIO, WebDAV/OneDrive storage drivers
- OPDS, Calibre Web compatible, Readwise/Notion/Anki sync
- AI assistance (summary / translation / Q&A)

## Notes

Full detail, gap analysis vs competitors, and decisions live in the private dev docs (`docs/local/plan.md`).