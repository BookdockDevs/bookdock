import { inputBaseClass } from '@/components/ui/Input'
import { textareaBaseClass } from '@/components/ui/Textarea'

// Field colors are semantic tokens (see index.css): the app axis supplies the
// light/dark values and reader surfaces override them with reading-theme
// derivatives, so forms look native on both kinds of surface.
export const settingsFormClass = 'flex flex-col gap-4'

export const settingsInputClass = `${inputBaseClass} h-9 px-2.5 text-sm`

export const settingsTextareaClass = textareaBaseClass
