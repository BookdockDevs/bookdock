# Bookdock Product Context

Bookdock is a self-hosted e-book library and reader. This context defines the canonical product language for user feedback, books, table-of-contents rules, and reading behavior so the same concept is named consistently across the library, reader, settings, and authentication flows.

## User Feedback

**Notification**:
A user-visible explanation of an operation or system state. A notification may be transient, inline, or attached to a longer-running task.
_Avoid_: treating every notification as a toast.

**Toast**:
A transient, global notification shown near the edge of the current page for a completed action or an immediately actionable problem.
_Avoid_: using a toast as the only status for page-loading failures or long-running work.

**Inline error**:
A persistent error state rendered beside the page, panel, or field whose content failed to load or validate.
_Avoid_: hiding a recoverable page error in a disappearing toast.

**Task status**:
The persistent progress and final outcome of work that may outlive the initiating interaction, such as an upload or index build.
_Avoid_: representing ongoing progress with repeated toasts.

## Books and Table of Contents

**TOC rule**:
A user-configurable preset that determines how TXT content is recognized and organized into volumes, chapters, and sections in the table of contents.
_Avoid_: chapter rule when referring to the complete table-of-contents structure.

**Built-in rule**:
A rule supplied by Bookdock that users may edit or delete. “Built-in” describes the rule’s origin, not whether its contents are immutable.
_Avoid_: system rule.

**Custom rule**:
A rule created by the user rather than supplied by Bookdock.
_Avoid_: user rule when the distinction from a built-in rule matters.

**Restore defaults**:
An action that restores missing built-in rules or resets recoverable built-in configuration to the product defaults. Unless stated otherwise, it does not affect custom rules.
_Avoid_: reset all rules.

**Automatic chaptering**:
The selection of the most suitable enabled TOC rule based on the book’s content. It is not a fixed rule selected by the user.
_Avoid_: automatic rule selection when describing the resulting chapter structure.

**Rechaptering**:
Regenerating a book’s table of contents after the user explicitly switches its TOC rule. The book content remains unchanged, but the reading position may need to be relocated when chapter boundaries change.
_Avoid_: reparsing when the user-facing result is a new chapter structure.

**Prologue**:
A chapter explicitly labeled “Prologue,” or preliminary content before the first TOC title that has not yet been assigned to another chapter. It is not present in every book.
_Avoid_: assuming every book has a prologue.

## Reader Concepts

**EPUB format**:
The e-book format that packages a book’s metadata, table of contents, and content resources. It is not a renderer and does not define how pages are laid out.
_Avoid_: using EPUB to mean the reading engine.

**Reading core**:
The general reading capability that loads book content and lays chapters out as readable pages. It includes the format-specific parsing, resource loading, pagination, fixed-layout handling, and chapter navigation needed to read a book.
_Avoid_: using engine as a separate architectural layer.

**Engine**:
A user-facing shorthand for the reading core, not a separate product concept.
_Avoid_: treating the engine and reading core as two different systems.

**Closed scrolling**:
The reading setting in which scrolling stays within the current chapter. Moving to another chapter requires explicit navigation, such as the TOC, progress bar, chapter controls, or left/right keyboard navigation.
_Avoid_: continuous scrolling.

**Chapter-boundary scrolling**:
The reading setting in which chapters remain separate while scrolling. Reaching a chapter boundary stops at that boundary first; another deliberate movement in the same direction changes to the next or previous chapter.
_Avoid_: chapter jumping when describing the scrolling behavior.

**Long-form scrolling**:
The continuous reading setting in which later chapters are loaded and appended while reading forward. Scrolling backward is for revisiting already loaded content and must not endlessly append history or destabilize the reading position.
_Avoid_: infinite scroll when the behavior is limited to book content.

**Viewport scrolling**:
The behavior of vertical arrow keys in a scrolling reading mode: each press moves approximately one viewport with a small overlap, while left and right arrows remain chapter navigation controls.
_Avoid_: treating left and right arrows as ordinary iframe scrolling.
