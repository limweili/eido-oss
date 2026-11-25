import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DESIGN_TOKENS } from '../../src/ui/tokens.ts'

const siteRoot = fileURLToPath(new URL('../../site/', import.meta.url))
const sourceFontRoot = fileURLToPath(new URL('../../src/assets/fonts/', import.meta.url))

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`
    return entry.isDirectory() ? filesBelow(path) : [path]
  }))
  return nested.flat()
}

function exactlyOne(source, pattern) {
  return [...source.matchAll(pattern)].length === 1
}

function customProperties(block) {
  return Object.fromEntries(
    [...block.matchAll(/^\s*(--e-[\w-]+):\s*([^;]+);/gm)]
      .map((match) => [match[1], match[2].trim()]),
  )
}

function compact(value) {
  return value.replace(/\s+/g, '')
}

async function siteFileForHref(href) {
  const pathname = href.split(/[?#]/, 1)[0]
  if (!pathname || !pathname.startsWith('/')) return null

  const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  const candidates = relative.endsWith('/')
    ? [`${relative}index.html`]
    : [relative, `${relative}.html`, `${relative}/index.html`]

  for (const candidate of candidates) {
    try {
      const path = `${siteRoot}${candidate}`
      if ((await stat(path)).isFile()) return path
    } catch {
      // Try the next clean-URL shape.
    }
  }
  return undefined
}

test('the public site is static, semantic, and internally complete', async () => {
  const htmlFiles = (await filesBelow(siteRoot)).filter((path) => path.endsWith('.html'))
  assert.ok(htmlFiles.some((path) => path.endsWith('/legal.html')))
  assert.ok(htmlFiles.some((path) => path.endsWith('/privacy.html')))
  assert.ok(htmlFiles.some((path) => path.endsWith('/terms.html')))
  assert.ok(!htmlFiles.some((path) => path.includes('/legal/')), 'legal routes must stay top-level')
  assert.ok(htmlFiles.some((path) => path.endsWith('/404.html')))

  for (const path of htmlFiles) {
    const source = await readFile(path, 'utf8')
    assert.match(source, /<title>[^<]+<\/title>/, `${path} needs a title`)
    assert.match(source, /<meta name="viewport"/, `${path} needs a viewport`)
    assert.ok(exactlyOne(source, /<main\b/g), `${path} needs exactly one main`)
    assert.ok(exactlyOne(source, /<h1\b/g), `${path} needs exactly one h1`)
    assert.doesNotMatch(source, /<(?:script|iframe|form|style)\b/i, `${path} must stay non-executable`)
    assert.doesNotMatch(source, /\sstyle=/i, `${path} must not use inline styles`)
    assert.doesNotMatch(source, /<img[^>]+src="https?:/i, `${path} must not load remote images`)
    assert.doesNotMatch(source, /<link[^>]+rel="(?:stylesheet|icon)"[^>]+href="https?:/i, `${path} must not load remote styles or icons`)
    assert.doesNotMatch(source, /mailto:|[\w.+-]+@eido\.so/i, `${path} must not advertise an unavailable email channel`)
    assert.doesNotMatch(source, /<mark>|\b(?:TODO|REPLACE_ME)\b/i, `${path} contains a drafting placeholder`)

    const links = [...source.matchAll(/\shref="([^"]+)"/g)].map((match) => match[1])
    for (const href of links) {
      const resolvedPath = await siteFileForHref(href)
      assert.notEqual(resolvedPath, undefined, `${path} has an unresolved internal link: ${href}`)

      const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : ''
      if (fragment && (href.startsWith('#') || href.startsWith('/'))) {
        const target = resolvedPath ? await readFile(resolvedPath, 'utf8') : source
        const ids = new Set([...target.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
        assert.ok(ids.has(decodeURIComponent(fragment)), `${path} has an unresolved fragment: ${href}`)
      }
    }
  }
})

test('the homepage links to standalone legal pages and the source build', async () => {
  const home = await readFile(`${siteRoot}index.html`, 'utf8')
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8')
  assert.match(home, /href="\/privacy"/)
  assert.match(home, /href="\/terms"/)
  assert.match(home, /href="\/legal"/)
  assert.match(home, /<img class="logo"[^>]+aria-hidden="true"[^>]+alt=""/)
  assert.match(home, /href="https:\/\/github\.com\/limweili\/eido-oss"/)
  assert.match(home, /href="https:\/\/github\.com\/limweili\/eido-oss#run-from-source"/)
  assert.match(readme, /^git clone https:\/\/github\.com\/limweili\/eido-oss\.git\ncd eido-oss$/m)
  assert.match(readme, /^## Run from source$/m)
  assert.doesNotMatch(home, /<meta name="robots"[^>]*noindex/i)
})

test('the homepage offers the stable installer for each supported platform', async () => {
  const home = await readFile(`${siteRoot}index.html`, 'utf8')
  const downloads = home.match(/<section\b[^>]*\bid="download"[^>]*>([\s\S]*?)<\/section>/)?.[1]
  assert.ok(downloads, 'the homepage needs a download section')
  assert.deepEqual(
    [...downloads.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
      .map(([, href, label]) => [href, label]),
    [
      ['https://updates.eido.so/Eido-latest-arm64.dmg', 'Download for Apple silicon Mac'],
      ['https://updates.eido.so/Eido-latest-x64.exe', 'Download for Windows x64'],
    ],
  )
})

test('the privacy policy describes data handling in the open-source release', async () => {
  const privacy = await readFile(`${siteRoot}privacy.html`, 'utf8')
  assert.match(privacy, /<h1>Privacy policy<\/h1>/)
  assert.match(privacy, /href="#leaves"/)
  assert.match(privacy, /covers the open-source desktop app/)
  assert.match(privacy, /Eido collects no product analytics\./)
  assert.match(privacy, /your own (?:provider )?API keys/)
  assert.match(privacy, /CLI and MCP access work offline/)
  assert.match(privacy, /request the public page and its preview images/)
  assert.match(privacy, /Codex/)
  assert.match(privacy, /signed update files for older app versions/)
  assert.doesNotMatch(privacy, /check for updates/i)
  assert.doesNotMatch(privacy, /PostHog|managed-route|Account snapshot|opaque Eido Account ID/i)
})

test('the homepage publishes the intended URL-preview metadata', async () => {
  const home = await readFile(`${siteRoot}index.html`, 'utf8')
  const title = home.match(/<title>(Eido \| open-source thinking whiteboard)<\/title>/)?.[1]
  const description = home.match(/<meta name="description" content="(A free, open-source canvas[^"]+)">/)?.[1]
  assert.ok(title)
  assert.ok(description)
  assert.ok(home.includes(`<meta property="og:title" content="${title}">`))
  assert.ok(home.includes(`<meta property="og:description" content="${description}">`))
  assert.match(home, /<meta property="og:url" content="https:\/\/eido\.so\/">/)
  assert.match(home, /<meta name="twitter:card" content="summary">/)
  assert.ok(home.includes(`<meta name="twitter:title" content="${title}">`))
  assert.ok(home.includes(`<meta name="twitter:description" content="${description}">`))
})

test('the public site mirrors canonical design tokens and self-hosts licensed fonts', async () => {
  const css = await readFile(`${siteRoot}assets/site.css`, 'utf8')
  assert.doesNotMatch(css, /@import\b/i)
  assert.doesNotMatch(css, /url\(["']?https?:/i)
  const lightMatch = css.match(/:root\s*\{([^}]*)\}/s)
  const darkMatch = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/s)
  assert.ok(lightMatch, 'site CSS needs a light token block')
  assert.ok(darkMatch, 'site CSS needs a dark token block')

  const light = customProperties(lightMatch[1])
  const dark = customProperties(darkMatch[1])
  const mirroredNames = [
    '--e-surface-recessed',
    '--e-surface-ground',
    '--e-surface-panel',
    '--e-surface-card',
    '--e-surface-floating',
    '--e-surface-field',
    '--e-ink',
    '--e-ink-soft',
    '--e-line',
    '--e-line-strong',
    '--e-go',
    '--e-go-ink',
    '--e-on-solid',
    '--e-attention',
    '--e-attention-ink',
    '--e-grid-dot',
  ]

  for (const name of mirroredNames) {
    assert.equal(compact(light[name]), compact(DESIGN_TOKENS.light[name]), `${name} light token drifted`)
    assert.equal(compact(dark[name]), compact(DESIGN_TOKENS.dark[name]), `${name} dark token drifted`)
  }
  assert.equal(compact(light['--e-mono']), compact(DESIGN_TOKENS.light['--e-mono']))
  assert.equal(compact(light['--e-sans']), compact(DESIGN_TOKENS.light['--e-sans']))

  for (const file of [
    'jetbrains-mono-latin-wght-400-700.woff2',
    'open-sans-latin-variable-normal.woff2',
    'open-sans-latin-variable-italic.woff2',
    'OFL-JetBrainsMono.txt',
    'OFL-OpenSans.txt',
  ]) {
    const deployedPath = `${siteRoot}assets/fonts/${file}`
    assert.ok((await stat(deployedPath)).isFile(), `${file} must ship with the site`)
    assert.deepEqual(
      await readFile(deployedPath),
      await readFile(`${sourceFontRoot}${file}`),
      `${file} must remain byte-identical to the licensed source asset`,
    )
  }

  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    const assetPath = await siteFileForHref(match[1])
    assert.ok(assetPath, `site CSS has an unresolved local asset: ${match[1]}`)
  }
})

test('legal pages remain non-indexed before publication facts are confirmed', async () => {
  for (const file of ['legal.html', 'privacy.html', 'terms.html']) {
    const source = await readFile(`${siteRoot}${file}`, 'utf8')
    assert.match(source, /<meta name="robots" content="noindex, nofollow">/)
    assert.match(source, /<body data-publication-state="draft">/)
    assert.doesNotMatch(source, /\bEffective\s+\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\b/)
  }

  for (const file of ['legal.html', 'privacy.html', 'terms.html']) {
    const source = await readFile(`${siteRoot}${file}`, 'utf8')
    assert.doesNotMatch(source, /Publication draft|Not yet in force|Draft dated|complete draft/i)
  }
})

test('the launch site points to GPL source and exposes no commercial service routes', async () => {
  const files = await filesBelow(siteRoot)
  assert.ok(!files.some((path) => /\/(?:checkout|account)\//.test(path)))
  const home = await readFile(`${siteRoot}index.html`, 'utf8')
  const terms = await readFile(`${siteRoot}terms.html`, 'utf8')
  assert.match(home, /Eido is free and open source under GPLv3\./)
  assert.match(terms, /GNU General Public License version 3/)
  assert.match(terms, /Download and install a newer release from eido\.so/)
  assert.match(terms, /href="https:\/\/github\.com\/limweili\/eido-oss"/)
  assert.match(terms, /href="https:\/\/github\.com\/limweili\/eido-oss\/blob\/main\/LICENSE"/)
  assert.doesNotMatch(terms, /non-transferable licence|must not sell|later introduces a paid plan|paid entitlement/)

  for (const file of files.filter((path) => /\.(?:html|css)$/.test(path))) {
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(source, /posthog|stripe|clerk|checkout|account\/billing|managed-route/i)
    assert.doesNotMatch(source, /Eido-\d+\.\d+\.\d+/, 'installer links must use stable release aliases')
  }
})

test('Cloudflare Pages headers keep the site non-executable', async () => {
  const headers = await readFile(`${siteRoot}_headers`, 'utf8')
  assert.match(headers, /Content-Security-Policy: default-src 'none'/)
  assert.match(headers, /style-src 'self'/)
  assert.match(headers, /form-action 'none'/)
  assert.match(headers, /frame-ancestors 'none'/)
  assert.doesNotMatch(headers, /'unsafe-(?:inline|eval)'/)
  assert.match(headers, /X-Content-Type-Options: nosniff/)
  assert.match(headers, /Referrer-Policy: no-referrer/)
})
