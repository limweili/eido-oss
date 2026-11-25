const PASSIVE_MARKDOWN_PREVIEW_CHARS = 1200

// The cap protects auto-sized cards from painting unbounded text. A card the
// user resized to an explicit height already bounds its own paint cost via
// overflow scrolling, so it shows its full body even when passive (#207).
export function markdownPreviewText(text: string, expanded: boolean, hasExplicitHeight = false): string {
  if (expanded || hasExplicitHeight || text.length <= PASSIVE_MARKDOWN_PREVIEW_CHARS) return text
  return `${text.slice(0, PASSIVE_MARKDOWN_PREVIEW_CHARS).trimEnd()}\n\n...`
}
