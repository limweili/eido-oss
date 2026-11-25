import { describe, expect, it } from 'vitest'
import {
  isDirectMarkdownHref,
  neutralizeMarkdownAngles,
  neutralizeUnsafeMarkdownLinks,
  normalizeMarkdownTransport,
  renderMarkdown,
  restoreMarkdownAngles,
} from './markdown'

describe('renderMarkdown', () => {
  it('renders the complete paper hierarchy as one safe document', () => {
    const markdown = [
      '# Heading one',
      '',
      '## Heading two',
      '',
      '### Heading three',
      '',
      'Paper with **weight**, *emphasis*, ~~a retired thought~~, ==a mark==, `inline code`, and [a link](https://eido.test/prose).',
      '',
      '- An ordinary item',
      '- [ ] An open task',
      '- [x] A finished task',
      '',
      '1. First numbered thought',
      '',
      '> A quoted thought',
      '',
      '```txt',
      'const paper = true',
      '```',
      '',
      '| Voice | Face |',
      '| --- | --- |',
      '| Paper | Open Sans |',
      '',
      '---',
    ].join('\n')

    expect(renderMarkdown(markdown)).toBe([
      '<h1>Heading one</h1>',
      '<h2>Heading two</h2>',
      '<h3>Heading three</h3>',
      '<p>Paper with <strong>weight</strong>, <em>emphasis</em>, <del>a retired thought</del>, <mark>a mark</mark>, <code>inline code</code>, and <a href="https://eido.test/prose" target="_blank">a link</a>.</p>',
      '<ul>',
      '<li>An ordinary item</li>',
      '<li class="task"><label><input type="checkbox" disabled />An open task</label></li>',
      '<li class="task done"><label><input type="checkbox" checked disabled />A finished task</label></li>',
      '</ul>',
      '<ol>',
      '<li>First numbered thought</li>',
      '</ol>',
      '<blockquote><p>A quoted thought</p></blockquote>',
      '<pre><code>const paper = true</code></pre>',
      '<table>',
      '<thead><tr><th>Voice</th><th>Face</th></tr></thead>',
      '<tbody>',
      '<tr><td>Paper</td><td>Open Sans</td></tr>',
      '</tbody>',
      '</table>',
      '<hr />',
    ].join('\n'))
  })

  it('restores Markdown that arrived through an escaped rich-text transport', () => {
    const transported = '\\\\### Design Brief\\n\\\\**Goal\\\\** &#x20;\\nCreate a visual control surface.'
    const expected = '<h3>Design Brief</h3>\n<p><strong>Goal</strong> Create a visual control surface.</p>'

    expect(renderMarkdown(transported)).toBe(expected)
  })

  it('restores transported numeric spaces in otherwise plain card text', () => {
    expect(renderMarkdown('Hello, how are you&#x20;\n\nhello hello???')).toBe(
      '<p>Hello, how are you</p>\n<p>hello hello???</p>',
    )
  })

  it('does not expose transported numeric whitespace entities as visible card text', () => {
    const rendered = renderMarkdown(
      ['Context:', '', '* Cards', '* Node Connections', '  * Connection type', '  * &#x9;', '* Save File'].join('\n'),
    )

    expect(rendered).toBe([
      '<p>Context:</p>',
      '<ul>',
      '<li>Cards</li>',
      '<li>Node Connections',
      '<ul>',
      '<li>Connection type</li>',
      '</ul>',
      '</li>',
      '<li>Save File</li>',
      '</ul>',
    ].join('\n'))
    expect(renderMarkdown('* Before\r\n* &#xA0;\r\n* After')).toBe(
      '<ul>\n<li>Before</li>\n<li>After</li>\n</ul>',
    )
  })

  it('normalizes decimal and hexadecimal character references throughout prose', () => {
    expect(normalizeMarkdownTransport('Tab: &#9; / &#x9;; quote: &#8217;; emoji: &#x1F642;')).toBe(
      'Tab: \t / \t; quote: ’; emoji: 🙂',
    )
    expect(normalizeMarkdownTransport('Invalid: &#0; &#xD800; &#x110000;')).toBe(
      'Invalid: � � �',
    )
  })

  it('preserves numeric character references inside inline and fenced code', () => {
    expect(normalizeMarkdownTransport('`&#x9;`\n\n```txt\n&#9;\n```')).toBe(
      '`&#x9;`\n\n```txt\n&#9;\n```',
    )
  })

  it('preserves explicit user-authored line breaks inside a paragraph', () => {
    expect(renderMarkdown('First line  \nSecond line\n\nThird line')).toBe(
      '<p>First line<br />Second line</p>\n<p>Third line</p>',
    )
  })

  it('keeps ordinary Markdown soft breaks as spaces', () => {
    expect(renderMarkdown('First soft line\nSecond soft line')).toBe(
      '<p>First soft line Second soft line</p>',
    )
  })

  it('restores escaped list markers from the same rich-text transport', () => {
    expect(
      renderMarkdown(['### Requirements', '\\- First requirement', '\\- Second requirement', '1\\. First concept'].join('\n')),
    ).toBe(
      '<h3>Requirements</h3>\n<ul>\n<li>First requirement</li>\n<li>Second requirement</li>\n</ul>\n<ol>\n<li>First concept</li>\n</ol>',
    )
  })

  it('renders escaped opening brackets as literal brackets without a visible slash', () => {
    expect(
      renderMarkdown(
        'How to read my instructions below: \\[Component]: \\[core gameplay upgrade] - \\[(unit label)]',
      ),
    ).toBe(
      '<p>How to read my instructions below: [Component]: [core gameplay upgrade] - [(unit label)]</p>',
    )
  })

  it('preserves bracket escapes inside code spans', () => {
    expect(renderMarkdown('`\\[literal]`')).toBe('<p><code>\\[literal]</code></p>')
  })

  it('consumes escaped Markdown punctuation in prose without activating it or changing code', () => {
    expect(renderMarkdown('**\\|Explore Context\\|** and \\*literal emphasis\\*')).toBe(
      '<p><strong>|Explore Context|</strong> and *literal emphasis*</p>',
    )
    expect(renderMarkdown('`\\|code\\|`')).toBe('<p><code>\\|code\\|</code></p>')
    expect(renderMarkdown(['```md', '\\|code\\|', '```'].join('\n'))).toBe(
      '<pre><code>\\|code\\|</code></pre>',
    )
    expect(renderMarkdown('\\ordinary text')).toBe('<p>\\ordinary text</p>')
  })

  it('renders rich block forms as one byte-stable document', () => {
    const markdown = [
      '# Heading',
      '',
      'A paragraph with a [link](https://eido.test/path).',
      '',
      '- Alpha',
      '- Beta',
      '',
      '1. One',
      '2. Two',
      '',
      '| Name | Score |',
      '| --- | --- |',
      '| Ada | 10 |',
      '',
      '```ts',
      'const answer = 42',
      '```',
    ].join('\n')
    const expected = [
      '<h1>Heading</h1>',
      '<p>A paragraph with a <a href="https://eido.test/path" target="_blank">link</a>.</p>',
      '<ul>',
      '<li>Alpha</li>',
      '<li>Beta</li>',
      '</ul>',
      '<ol>',
      '<li>One</li>',
      '<li>Two</li>',
      '</ol>',
      '<table>',
      '<thead><tr><th>Name</th><th>Score</th></tr></thead>',
      '<tbody>',
      '<tr><td>Ada</td><td>10</td></tr>',
      '</tbody>',
      '</table>',
      '<pre><code>const answer = 42</code></pre>',
    ].join('\n')

    expect(renderMarkdown(markdown)).toBe(expected)
  })

  it('renders markdown pipe tables', () => {
    expect(
      renderMarkdown([
        '| Name | Score |',
        '| --- | ---: |',
        '| Ada | 10 |',
        '| Linus | 7 |',
      ].join('\n')),
    ).toBe(
      [
        '<table>',
        '<thead><tr><th>Name</th><th>Score</th></tr></thead>',
        '<tbody>',
        '<tr><td>Ada</td><td>10</td></tr>',
        '<tr><td>Linus</td><td>7</td></tr>',
        '</tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('keeps table cell markdown escaped and formatted', () => {
    expect(
      renderMarkdown([
        '| Thing | Note |',
        '| --- | --- |',
        '| `<tag>` | **safe** |',
      ].join('\n')),
    ).toContain('<tr><td><code>&lt;tag&gt;</code></td><td><strong>safe</strong></td></tr>')
  })

  it('renders restrained highlight marks inline', () => {
    expect(renderMarkdown('This is ==important== now.')).toContain('This is <mark>important</mark> now.')
  })

  it('keeps loose ordered lists in one list so numbering continues', () => {
    expect(renderMarkdown(['1. Alpha', '', '2. Beta', '', '3. Gamma'].join('\n'))).toBe(
      ['<ol>', '<li>Alpha</li>', '<li>Beta</li>', '<li>Gamma</li>', '</ol>'].join('\n'),
    )
  })

  it('preserves nested unordered and ordered list indentation', () => {
    expect(
      renderMarkdown([
        '- Parent',
        '  - Child',
        '    1. Grandchild',
        '- Sibling',
      ].join('\n')),
    ).toBe(
      [
        '<ul>',
        '<li>Parent',
        '<ul>',
        '<li>Child',
        '<ol>',
        '<li>Grandchild</li>',
        '</ol>',
        '</li>',
        '</ul>',
        '</li>',
        '<li>Sibling</li>',
        '</ul>',
      ].join('\n'),
    )
  })

  it('escapes highlighted text before rendering the mark', () => {
    expect(renderMarkdown('Keep ==<script>alert(1)</script>== safe.')).toContain(
      '<mark>&lt;script&gt;alert(1)&lt;/script&gt;</mark>',
    )
  })

  it('turns a pasted bare URL into a link, keeping its underscores out of italics', () => {
    expect(renderMarkdown('see https://eido.test/?idea=idea_1&card=note_2&x=1 now')).toBe(
      '<p>see <a href="https://eido.test/?idea=idea_1&amp;card=note_2&amp;x=1" target="_blank">https://eido.test/?idea=idea_1&amp;card=note_2&amp;x=1</a> now</p>',
    )
  })

  it('leaves trailing punctuation outside an autolinked URL', () => {
    expect(renderMarkdown('Go to https://eido.test/board. Then rest.')).toContain(
      '<a href="https://eido.test/board" target="_blank">https://eido.test/board</a>.',
    )
  })

  it('links a Markdown autolink to the address inside the angles, and nothing more', () => {
    expect(renderMarkdown('Docs at <https://eido.test/board> today')).toBe(
      '<p>Docs at <a href="https://eido.test/board" target="_blank">https://eido.test/board</a> today</p>',
    )
  })

  it('does not autolink URLs inside code spans', () => {
    expect(renderMarkdown('`https://eido.test/raw`')).toBe('<p><code>https://eido.test/raw</code></p>')
  })

  it('reads a link whose punctuation the editor escaped as one link', () => {
    const escaped = '[https://eido.test/w?v\\=1\\&pp\\=2](https://eido.test/w?v=1\\&pp=2)'
    expect(renderMarkdown(escaped)).toBe(
      '<p><a href="https://eido.test/w?v=1&amp;pp=2" target="_blank">' +
      'https://eido.test/w?v=1&amp;pp=2</a></p>',
    )
  })

  it('autolinks a bare URL whose punctuation the editor escaped', () => {
    expect(renderMarkdown('see https://eido.test/w?v\\=1\\&pp\\=2 ok')).toBe(
      '<p>see <a href="https://eido.test/w?v=1&amp;pp=2" target="_blank">' +
      'https://eido.test/w?v=1&amp;pp=2</a> ok</p>',
    )
  })

  it('keeps markdown links intact and formats their text', () => {
    expect(renderMarkdown('[**bold** name](https://eido.test/x)')).toBe(
      '<p><a href="https://eido.test/x" target="_blank"><strong>bold</strong> name</a></p>',
    )
  })

  it('renders safe path destinations while leaving unsafe schemes as literal Markdown', () => {
    expect(renderMarkdown('[Board.tsx (line 1562)](/Users/example/Projects/eido/src/canvas/Board.tsx:1562)')).toBe(
      '<p><a href="/Users/example/Projects/eido/src/canvas/Board.tsx:1562" target="_blank">Board.tsx (line 1562)</a></p>',
    )
    expect(renderMarkdown('[Do not open](javascript:alert(1))')).toBe(
      '<p>[Do not open](javascript:alert(1))</p>',
    )
    expect(renderMarkdown('[Encoded](javascript&#x3A;alert(1))')).toBe(
      '<p>[Encoded](javascript:alert(1))</p>',
    )
    expect(renderMarkdown('[Function](https://example.com/Function_(mathematics))')).toBe(
      '<p><a href="https://example.com/Function_(mathematics)" target="_blank">Function</a></p>',
    )
  })

  it('classifies only safe, browser-ready destinations as direct pasted links', () => {
    expect(isDirectMarkdownHref('https://example.com')).toBe(true)
    expect(isDirectMarkdownHref('mailto:hello@example.com')).toBe(true)
    expect(isDirectMarkdownHref('/Users/example/Projects/eido/README.md')).toBe(true)
    expect(isDirectMarkdownHref('www.example.com')).toBe(false)
    expect(isDirectMarkdownHref('javascript:alert(1)')).toBe(false)
    expect(isDirectMarkdownHref('javascript&#x3A;alert(1)')).toBe(false)
    expect(isDirectMarkdownHref('https://example.com/has a space')).toBe(false)
  })

  it('neutralizes unsafe stored links before they enter the rich editor', () => {
    const markdown = [
      '[Safe](https://example.com) [Unsafe](javascript:alert(1))',
      '`[Inline](javascript:alert(2))`',
      '~~~md',
      '[Fenced](javascript:alert(3))',
      '~~~',
    ].join('\n')
    const neutralized = neutralizeUnsafeMarkdownLinks(markdown)
    expect(neutralized).toBe(
      [
        '[Safe](https://example.com) \\[Unsafe](javascript:alert(1))',
        '`[Inline](javascript:alert(2))`',
        '~~~md',
        '[Fenced](javascript:alert(3))',
        '~~~',
      ].join('\n'),
    )
    expect(neutralizeUnsafeMarkdownLinks(neutralized)).toBe(neutralized)
  })

  it('neutralizes prose angle brackets and restores the body unchanged', () => {
    const markdown = [
      '"fast" no LLM.\t<1s',
      'Use the <div> element.',
      '`a <1s` stays code',
      '~~~md',
      '<1s fenced',
      '~~~',
    ].join('\n')
    const neutralized = neutralizeMarkdownAngles(markdown)
    expect(neutralized).toBe(
      [
        '"fast" no LLM.\t\\<1s',
        'Use the \\<div> element.',
        '`a <1s` stays code',
        '~~~md',
        '<1s fenced',
        '~~~',
      ].join('\n'),
    )
    expect(neutralizeMarkdownAngles(neutralized)).toBe(neutralized)
    expect(restoreMarkdownAngles(neutralized)).toBe(markdown)
    // The escape is transport, so the reader cannot tell which form was stored.
    expect(renderMarkdown(neutralized)).toBe(renderMarkdown(markdown))
  })

  it('draws the empty paragraphs a writer typed instead of collapsing them', () => {
    // The Markdown editor writes one empty paragraph as two extra blank lines,
    // so the passive Card must read a run the same way. One blank line stays an
    // ordinary paragraph break, and a run at the foot of a Note is spacing the
    // writer left there, not trailing whitespace to trim.
    expect(renderMarkdown('First\n\nSecond')).toBe('<p>First</p>\n<p>Second</p>')
    expect(renderMarkdown('First\n\n\n\nSecond')).toBe(
      '<p>First</p>\n<p><br /></p>\n<p>Second</p>',
    )
    expect(renderMarkdown('First\n\n\n\n\n\nSecond')).toBe(
      '<p>First</p>\n<p><br /></p>\n<p><br /></p>\n<p>Second</p>',
    )
    expect(renderMarkdown('Only line\n\n\n\n')).toBe(
      '<p>Only line</p>\n<p><br /></p>\n<p><br /></p>',
    )
    expect(renderMarkdown('# Heading\n\n\n\n- item')).toBe(
      '<h1>Heading</h1>\n<p><br /></p>\n<ul>\n<li>item</li>\n</ul>',
    )
    // A fenced block owns its own blank lines; they are code, not spacing.
    expect(renderMarkdown('```txt\na\n\n\n\nb\n```')).toBe(
      '<pre><code>a\n\n\n\nb</code></pre>',
    )
  })

  it('escapes quotes so URLs cannot break out of link attributes', () => {
    expect(renderMarkdown('say "hi" at https://eido.test/a"onmouseover="alert(1)')).not.toContain('onmouseover="alert(1)"')
  })
})
