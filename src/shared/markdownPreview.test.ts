import { describe, expect, it } from 'vitest'
import { markdownPreviewText } from './markdownPreview'

describe('markdownPreviewText', () => {
  it('keeps short passive markdown intact', () => {
    expect(markdownPreviewText('short note', false)).toBe('short note')
  })

  it('caps long passive markdown', () => {
    const text = 'a'.repeat(7000)
    const preview = markdownPreviewText(text, false)

    expect(preview.length).toBeLessThan(text.length)
    expect(preview.endsWith('\n\n...')).toBe(true)
  })

  it('keeps long expanded markdown intact', () => {
    const text = 'a'.repeat(7000)

    expect(markdownPreviewText(text, true)).toBe(text)
  })

  it('keeps long passive markdown intact when the card has an explicit height', () => {
    const text = 'a'.repeat(7000)

    expect(markdownPreviewText(text, false, true)).toBe(text)
  })

  it('still caps long passive markdown on auto-sized cards', () => {
    const text = 'a'.repeat(7000)
    const preview = markdownPreviewText(text, false, false)

    expect(preview.length).toBeLessThan(text.length)
    expect(preview.endsWith('\n\n...')).toBe(true)
  })
})
