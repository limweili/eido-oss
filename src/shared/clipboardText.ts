export type ClipboardTextWriter = (text: string) => Promise<boolean>

type ClipboardTextData = {
  files?: ArrayLike<unknown>
  getData: (type: string) => string
}

// Markdown-card editors own a Markdown document, so pasted Markdown must cross
// their boundary as source rather than as literal rich-text characters.
// Prefer the standard Markdown flavor when a clipboard provides it, with plain
// text as the interoperable fallback used by Eido's copy commands. Asset
// payloads remain owned by the card asset-ingest path.
export function markdownTextFromClipboard(data: ClipboardTextData): string | null {
  if ((data.files?.length ?? 0) > 0) return null
  return data.getData('text/markdown') || data.getData('text/plain') || null
}

// One browser clipboard boundary for every text-copy command. The async API is
// preferred, while execCommand keeps the existing fallback for restricted
// browser contexts and packaged shells.
export const writeTextToClipboard: ClipboardTextWriter = async (text) => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the older browser copy path */
  }

  if (typeof document === 'undefined') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
