import { describe, expect, it } from 'vitest'
import { markdownTextFromClipboard } from './clipboardText'

function clipboardData(
  values: Partial<Record<'text/markdown' | 'text/plain', string>>,
  fileCount = 0,
) {
  return {
    files: { length: fileCount },
    getData: (type: string) => values[type as keyof typeof values] ?? '',
  }
}

describe('markdownTextFromClipboard', () => {
  it('prefers Markdown source and falls back to interoperable plain text', () => {
    expect(markdownTextFromClipboard(clipboardData({
      'text/markdown': '## Markdown',
      'text/plain': 'Markdown',
    }))).toBe('## Markdown')
    expect(markdownTextFromClipboard(clipboardData({
      'text/plain': '**plain Markdown**',
    }))).toBe('**plain Markdown**')
  })

  it('leaves clipboard payloads containing files to asset ingest', () => {
    expect(markdownTextFromClipboard(clipboardData({
      'text/plain': 'image caption',
    }, 1))).toBeNull()
  })
})
