// Field colors are semantic tokens (see index.css): the app axis supplies the
// light/dark values and reader surfaces override them with reading-theme
// derivatives, so forms look native on both kinds of surface.
export const settingsFormClass = 'flex flex-col gap-4'

export const settingsInputClass = 'h-9 w-full rounded-lg border border-(--bd-field-border) bg-(--bd-field-bg) px-2.5 text-sm text-(--bd-field-text) outline-none transition-colors placeholder:text-(--bd-hint-text) focus:border-(--bd-field-focus-border) disabled:cursor-not-allowed disabled:opacity-50'

export const settingsTextareaClass = 'w-full resize-none rounded-lg border border-(--bd-field-border) bg-(--bd-field-bg) px-2.5 py-2 text-sm leading-relaxed text-(--bd-field-text) outline-none transition-colors placeholder:text-(--bd-hint-text) focus:border-(--bd-field-focus-border) disabled:cursor-not-allowed disabled:opacity-50'
