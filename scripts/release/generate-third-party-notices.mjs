// Generates release/packaged/THIRD_PARTY_NOTICES.txt — the license attribution
// file shipped inside packaged builds (MIT and similar licenses require their
// notice text to accompany distributed binaries; OFL requires it for fonts).
// Re-run after changing production dependencies or bundled fonts:
//   node scripts/release/generate-third-party-notices.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUTPUT_PATH = path.join(ROOT, 'release', 'packaged', 'THIRD_PARTY_NOTICES.txt')
const FONTS_DIR = path.join(ROOT, 'src', 'assets', 'fonts')
const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice)(\.|$)/i
// The 0.2.2 tarball omits its MIT license. Retain the upstream text from
// https://github.com/samsonjs/format/blob/0094c51372790ca342da4b90c519edd3380deee1/License.md
const MISSING_LICENSE_FILES = new Map([
  ['format@0.2.2', path.join(ROOT, 'scripts/release/licenses/format-0.2.2.txt')],
])

function productionPackageDirs() {
  const stdout = execFileSync(
    'npm',
    ['ls', '--omit=dev', '--all', '--parseable'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return [...new Set(stdout.split('\n').filter(
    (line) => line.includes(`node_modules${path.sep}`),
  ))]
}

function licenseText(packageDir, packageKey) {
  const candidates = readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const licensePath = candidates.length > 0
    ? path.join(packageDir, candidates[0])
    : MISSING_LICENSE_FILES.get(packageKey)
  return licensePath
    ? readFileSync(licensePath, 'utf8').trim()
    : undefined
}

function collectPackages() {
  const packages = new Map()
  for (const packageDir of productionPackageDirs()) {
    const manifest = JSON.parse(
      readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
    )
    const key = `${manifest.name}@${manifest.version}`
    if (packages.has(key)) continue
    packages.set(key, {
      name: manifest.name,
      version: manifest.version,
      license: typeof manifest.license === 'string'
        ? manifest.license
        : manifest.licenses?.map((license) => license.type).join(' OR ') || 'see license text',
      text: licenseText(packageDir, key),
    })
  }
  return [...packages.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  )
}

function fontNotices() {
  return readdirSync(FONTS_DIR)
    .filter((name) => /^OFL-.*\.txt$/.test(name))
    .sort()
    .map((name) => ({
      name: name.replace(/^OFL-/, '').replace(/\.txt$/, ''),
      text: readFileSync(path.join(FONTS_DIR, name), 'utf8').trim(),
    }))
}

const divider = '='.repeat(72)
const sections = []
sections.push([
  'Eido — Third-Party Software Notices',
  '',
  'Eido bundles the open-source packages and fonts listed below. Each is the',
  'property of its respective authors and is provided under its own license,',
  'reproduced here as those licenses require. These notices apply only to the',
  'listed third-party components, not to Eido itself.',
].join('\n'))

for (const pkg of collectPackages()) {
  sections.push([
    divider,
    `${pkg.name} ${pkg.version} — ${pkg.license}`,
    divider,
    pkg.text ?? `License: ${pkg.license} (license text not distributed with the package)`,
  ].join('\n'))
}

for (const font of fontNotices()) {
  sections.push([
    divider,
    `${font.name} (font) — SIL Open Font License 1.1`,
    divider,
    font.text,
  ].join('\n'))
}

const output = `${sections.join('\n\n')}\n`
  .replace(/\r\n?/g, '\n')
  .replace(/[\t ]+$/gm, '')
writeFileSync(OUTPUT_PATH, output)
console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)} (${sections.length - 1} notices)`)
