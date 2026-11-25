import { describe, expect, it } from 'vitest'
import { isLocalHtmlPreviewStaticImage } from './localHtmlPreview'

describe('local HTML static image contract', () => {
  it('admits a bounded high-DPI JPEG consistently', () => {
    expect(isLocalHtmlPreviewStaticImage({
      kind: 'image',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      size: 4,
      width: 2400,
      height: 1350,
    })).toBe(true)
  })

  it('rejects mislabeled, truncated, and size-mismatched image bytes', () => {
    expect(isLocalHtmlPreviewStaticImage({
      kind: 'image',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,YQ==',
      size: 1,
      width: 1200,
      height: 675,
    })).toBe(false)
    expect(isLocalHtmlPreviewStaticImage({
      kind: 'image',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      size: 5,
      width: 1200,
      height: 675,
    })).toBe(false)
  })
})
