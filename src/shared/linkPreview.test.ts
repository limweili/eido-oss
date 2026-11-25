import { describe, expect, it } from 'vitest'
import {
  explicitWebUrlFromClipboardText,
  firstWebUrlInText,
  LINK_PREVIEW_MAX_PER_NOTE,
  localHtmlDisplayNameFromClipboardText,
  localHtmlPathFromClipboardText,
  mightBeSchemeLessWebUrl,
  webUrlFromClipboardText,
  webUrlsInText,
} from './linkPreview'

describe('shared link preview URL parsing', () => {
  it('keeps explicit HTTP(S) validation local and rejects credentials or other schemes', () => {
    expect(explicitWebUrlFromClipboardText(' https://example.com/path ')).toBe(
      'https://example.com/path',
    )
    expect(explicitWebUrlFromClipboardText('http://example.com')).toBe('http://example.com')
    expect(explicitWebUrlFromClipboardText('https://user:secret@example.com')).toBeNull()
    expect(explicitWebUrlFromClipboardText('ftp://example.com/file')).toBeNull()
  })

  it('finds the first explicit http(s) url anywhere in a Note body', () => {
    expect(firstWebUrlInText('This is a note with a link http://example.com/x and more text')).toBe(
      'http://example.com/x',
    )
    expect(firstWebUrlInText('Two links: https://a.example/one then https://b.example/two')).toBe(
      'https://a.example/one',
    )
    expect(firstWebUrlInText('No link in this note at all.')).toBeNull()
    // Deliberately narrower than the scheme-less clipboard path: ordinary
    // prose full of dots ("v1.2", "e.g.") must not be mistaken for a url.
    expect(firstWebUrlInText('See v1.2 of the doc, e.g. the changelog.')).toBeNull()
  })

  it('takes only the target from every Markdown link shape a reader can click', () => {
    // THE DEFECT THIS PINS. A body carrying `[text](url)` was scanned as if it
    // were bare text, so the address ran from the first `http` through the
    // `](` and into the second copy:
    //   http://site/page](http://site/page
    // No fetch can resolve that, so the tile showed a raw url with no title,
    // no description, no image and no favicon.
    const url = 'http://gizmodo.com/how-computer-chips-work-1645654993'
    expect(firstWebUrlInText(`[${url}](${url})`)).toBe(url)
    expect(firstWebUrlInText('Read [how chips work](http://example.com/chips) tonight'))
      .toBe('http://example.com/chips')
    expect(firstWebUrlInText('An autolink: <http://example.com/chips>'))
      .toBe('http://example.com/chips')

    // The Markdown editor escapes a URL's punctuation on the way back out.
    expect(firstWebUrlInText('[x](https://example.com/w?v\\=1\\&pp\\=2)'))
      .toBe('https://example.com/w?v=1&pp=2')
    expect(firstWebUrlInText('bare https://example.com/w?v\\=1\\&pp\\=2 here'))
      .toBe('https://example.com/w?v=1&pp=2')
    expect(firstWebUrlInText('A bare one http://example.com/chips, then prose'))
      .toBe('http://example.com/chips')
    expect(firstWebUrlInText('[titled](http://example.com/chips "The page")'))
      .toBe('http://example.com/chips')
    expect(firstWebUrlInText('[angled](<http://example.com/chips>)'))
      .toBe('http://example.com/chips')
    // The words of a link are not its address, so a url written inside the
    // link text never becomes the preview's target.
    expect(firstWebUrlInText('[see https://decoy.example/x](https://real.example/y)'))
      .toBe('https://real.example/y')
    // A destination Eido would never fetch yields no preview at all.
    expect(firstWebUrlInText('[a card](eido://card/note_1)')).toBeNull()
    expect(firstWebUrlInText('[a file](./notes.md)')).toBeNull()
  })

  it('lists every distinct link a Note body carries, in body order', () => {
    const body = [
      'Start with [one](https://one.example/a).',
      'Then <https://two.example/b> and bare https://three.example/c here.',
      'The first one again: https://one.example/a',
      '```',
      'curl https://code.example/secret',
      '```',
      '[four](https://four.example/d) and [five](https://five.example/e)',
    ].join('\n')

    expect(webUrlsInText(body, 10)).toEqual([
      'https://one.example/a',
      'https://two.example/b',
      'https://three.example/c',
      'https://four.example/d',
      'https://five.example/e',
    ])
    // A Note is a thought, not a link farm: the body keeps every link, the
    // previews stop at the cap.
    expect(webUrlsInText(body)).toHaveLength(LINK_PREVIEW_MAX_PER_NOTE)
    expect(LINK_PREVIEW_MAX_PER_NOTE).toBe(4)
  })

  it('reads only the prose, so a pasted code sample never sends Eido fetching', () => {
    // renderMarkdown never autolinks inside code, and this must ask the same
    // question the reader's eye asks: a url in a code sample is a code sample.
    expect(firstWebUrlInText([
      'Here is the call:',
      '```sh',
      'curl https://internal.example/secret',
      '```',
    ].join('\n'))).toBeNull()
    expect(firstWebUrlInText('Call `https://internal.example/secret` from the shell')).toBeNull()
    expect(firstWebUrlInText([
      '```',
      'curl https://internal.example/secret',
      '```',
      'The docs are at https://example.com/docs',
    ].join('\n'))).toBe('https://example.com/docs')
  })

  it('uses an injected registrable-domain decision for scheme-less normalization', () => {
    expect(webUrlFromClipboardText('example.test/path', () => true)).toBe(
      'https://example.test/path',
    )
    expect(webUrlFromClipboardText('example.test/path', () => false)).toBeNull()
  })

  it('only sends plausible host-shaped values to the suffix classifier boundary', () => {
    for (const value of [
      'hello@example.com',
      `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(80)}.signature`,
      'v1.2.3',
      '192.168.1.1',
      'Fig.4',
      'README.md',
    ]) {
      expect(mightBeSchemeLessWebUrl(value), value).toBe(false)
    }
    for (const value of [
      'www.example.co',
      'example.co.uk/path?q=1',
      'bücher.de/katalog',
      'sub.example.com:8443/path',
      'www.readme.md',
    ]) {
      expect(mightBeSchemeLessWebUrl(value), value).toBe(true)
    }
  })

  it('recognizes complete local HTML paths without confusing prose or web URLs', () => {
    expect(localHtmlPathFromClipboardText(
      '/Users/example/Visual Reviews/image-generation-card-explained.html',
    )).toBe('/Users/example/Visual Reviews/image-generation-card-explained.html')
    expect(localHtmlPathFromClipboardText(
      '"C:\\Users\\Wei Li\\Visual Reviews\\board.htm"',
    )).toBe('C:\\Users\\Wei Li\\Visual Reviews\\board.htm')
    expect(localHtmlPathFromClipboardText(
      'file:///Users/example/Visual%20Reviews/board.html',
    )).toBe('/Users/example/Visual Reviews/board.html')
    expect(localHtmlDisplayNameFromClipboardText(
      '/Users/example/Visual Reviews/image-generation-card-explained.html',
    )).toBe('image-generation-card-explained.html')
    expect(localHtmlDisplayNameFromClipboardText(
      '"C:\\Users\\Wei Li\\Visual Reviews\\board.htm"',
    )).toBe('board.htm')

    for (const value of [
      'reviews/board.html',
      '/Users/example/reviews/board.pdf',
      'open /Users/example/reviews/board.html please',
      'https://example.com/board.html',
      '/Users/example/reviews/board.html\n/Users/example/reviews/other.html',
      '\\\\server\\share\\board.html',
    ]) {
      expect(localHtmlPathFromClipboardText(value), value).toBeNull()
    }
  })
})
