// The AI models a user can pick per Ask AI card. OpenRouter exposes hundreds;
// we ship two and let the user add any other slug (Concept 6: aggressive
// simplicity). Nothing here is a whitelist: an added slug works the same way.

// Slug fragments read as letters rather than as a word. Deliberately tiny:
// every entry is a name that plain capitalisation would get wrong, and a long
// list would start guessing at names it has never seen.
const MODEL_NAME_ACRONYMS = new Set(['gpt', 'ai', 'llm'])

export const DEFAULT_MODEL = 'openai/gpt-5.6-luna'
export const MAX_OPENROUTER_SLUG_LENGTH = 160

// The release defaults for the device-local Recommended Model Catalog. Users
// add and remove entries in the AI settings modal; the catalog is not Board,
// Profile, or Account authority. A current Idea still carries its selected
// identity, which remains in the runtime picker even when absent here.
export const DEFAULT_MODEL_SLUGS = [
  DEFAULT_MODEL,
  'google/gemini-3.7-flash',
]

// Quotes and spaces wrapped around a pasted slug are packaging, not part of
// the name, so they never reach storage.
export function cleanModelSlug(value: string): string {
  return value.trim().replace(/^["'`‘’“”]+|["'`‘’“”]+$/g, '').trim()
}

// OpenRouter names every model vendor/model. A bare word is a local CLI's own
// name ('sonnet', 'pro') and will not resolve over the network, so it is worth
// saying so before it is saved. The optional '~' prefix is OpenRouter's latest
// family alias; local harnesses are never held to this.
export function isOpenRouterSlug(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_OPENROUTER_SLUG_LENGTH
    && /^~?[a-zA-Z0-9][a-zA-Z0-9._:-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)
}

// A plain name read out of the slug itself: drop the vendor, hyphens become
// spaces, words are capitalised. Derived rather than listed, so a model added
// next year reads the same as the two shipped today. A name with no vendor
// prefix is a local CLI's own name and is handled by the rule below; anything
// neither rule can make a name out of keeps the raw slug. One function names
// every model on every surface, so nothing has to grow a second scheme.
export function modelLabel(slug: string | undefined): string {
  if (!slug) return modelLabel(DEFAULT_MODEL)
  const separator = slug.indexOf('/')
  if (separator < 0) return localModelLabel(slug)
  const parts = slug.slice(separator + 1).split('-').filter(Boolean)
  if (parts.length === 0) return slug
  return parts.map(titleCaseModelWord).join(' ')
}

// A local CLI answers to two kinds of name. A word ('auto', 'sonnet') is prose
// and reads as a name, so it is capitalised. A version-style id
// ('gpt-5.6-sol') is not prose: capitalising part of it invents a name the
// tool never had, and a reader cannot tell an invented name from a real one.
// The digits and dots an id carries are the test, so an id nobody has written
// yet is left alone for the same reason as the ones shipped today.
function localModelLabel(slug: string): string {
  if (/[\d.]/.test(slug)) return slug
  return slug.split('-').map(titleCaseModelWord).join('-')
}

function titleCaseModelWord(word: string): string {
  const lower = word.toLowerCase()
  if (MODEL_NAME_ACRONYMS.has(lower)) return lower.toUpperCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}
