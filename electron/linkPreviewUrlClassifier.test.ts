import { describe, expect, it } from 'vitest'
import { webUrlFromClipboardText } from './linkPreviewUrlClassifier'

describe('webUrlFromClipboardText', () => {
  it('recognises an entire clipboard value as one web URL and normalises domain-only forms', () => {
    expect(webUrlFromClipboardText('  https://drybread.studio/work#ideas\n')).toBe(
      'https://drybread.studio/work#ideas',
    )
    expect(webUrlFromClipboardText('www.drybread.studio/work')).toBe(
      'https://www.drybread.studio/work',
    )
    expect(webUrlFromClipboardText('drybread.studio/work')).toBe('https://drybread.studio/work')
  })

  it('leaves prose, multiple URLs, credentials, and non-web schemes as ordinary text', () => {
    expect(webUrlFromClipboardText('See https://drybread.studio')).toBeNull()
    expect(webUrlFromClipboardText('https://one.example\nhttps://two.example')).toBeNull()
    expect(webUrlFromClipboardText('mailto:hello@drybread.studio')).toBeNull()
    expect(webUrlFromClipboardText('ftp://drybread.studio/file')).toBeNull()
    expect(webUrlFromClipboardText('https://user:secret@drybread.studio')).toBeNull()
    expect(webUrlFromClipboardText('hello@example.com')).toBeNull()
    expect(webUrlFromClipboardText('192.168.1.1')).toBeNull()
  })

  it('leaves common dotted filenames as ordinary text unless they have an explicit scheme', () => {
    for (const filename of [
      'README.md',
      'index.html',
      'styles.css',
      'package.json',
      'main.py',
      'app.tsx',
      'data.csv',
      'schema.sql',
      'screenshot.png',
      'photo.jpg',
      'archive.zip',
      'notes.docx',
      'sheet.xlsx',
      'script.sh',
    ]) {
      expect(webUrlFromClipboardText(filename)).toBeNull()
    }
    expect(webUrlFromClipboardText('https://node.js')).toBe('https://node.js')
  })

  it('normalises only an empty root slash without changing path or query data', () => {
    expect(webUrlFromClipboardText('drybread.studio')).toBe('https://drybread.studio')
    expect(webUrlFromClipboardText('drybread.studio/work/')).toBe('https://drybread.studio/work/')
    expect(webUrlFromClipboardText('drybread.studio/?next=work/')).toBe(
      'https://drybread.studio/?next=work/',
    )
  })

  it('recognises registrable bare domains without treating arbitrary dotted words as websites', () => {
    expect(webUrlFromClipboardText('www.example.com')).toBe('https://www.example.com')
    expect(webUrlFromClipboardText('example.co')).toBe('https://example.co')
    expect(webUrlFromClipboardText('example.co.uk')).toBe('https://example.co.uk')
    expect(webUrlFromClipboardText('drybread.studio')).toBe('https://drybread.studio')

    expect(webUrlFromClipboardText('planning.local')).toBeNull()
    expect(webUrlFromClipboardText('release.unknown')).toBeNull()
    expect(webUrlFromClipboardText('co.uk')).toBeNull()
  })

  it('normalises internationalised bare domains through the platform URL parser', () => {
    expect(webUrlFromClipboardText('bücher.de')).toBe('https://xn--bcher-kva.de')
    expect(webUrlFromClipboardText('www.bücher.de/katalog')).toBe(
      'https://www.xn--bcher-kva.de/katalog',
    )
  })

  it('recognises a scheme-less registrable domain with a standard port and path', () => {
    expect(webUrlFromClipboardText('subdomain.example.com:443/path')).toBe(
      'https://subdomain.example.com/path',
    )
    expect(webUrlFromClipboardText('subdomain.example.com:8443/path')).toBe(
      'https://subdomain.example.com:8443/path',
    )
    expect(webUrlFromClipboardText('www.readme.md')).toBe('https://www.readme.md')
  })

  it('does not return an inferred URL that exceeds the preview contract limit', () => {
    expect(webUrlFromClipboardText(`example.com/${'a'.repeat(2_036)}`)).toBeNull()
  })
})
