import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

// Skill content has one source of truth: .agents/skills/<name>/. A skill that
// must also be discoverable by the Claude harness gets a pointer stub at
// .claude/skills/<name>/SKILL.md carrying only the source's frontmatter, so a
// mirrored skill can never drift from the skill it names.

const PRIMARY_ROOT = '.agents/skills'
const MIRROR_ROOT = '.claude/skills'

const FRONTMATTER = /^---\n.*?\n---\n/s

async function skillDirectories(root) {
  const entries = await readdir(root, { withFileTypes: true })
  assertOrdinaryEntries(root, entries)
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

async function mirrorFiles(skill) {
  const root = join(MIRROR_ROOT, skill)
  const entries = await readdir(root, { withFileTypes: true, recursive: true })
  assertOrdinaryEntries(root, entries)
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
}

function assertOrdinaryEntries(root, entries) {
  for (const entry of entries) {
    assert.ok(!entry.isSymbolicLink(), `${root}/${entry.name} is a symbolic link`)
  }
}

test('every mirrored skill points at an existing source skill', async () => {
  const sources = new Set(await skillDirectories(PRIMARY_ROOT))
  for (const skill of await skillDirectories(MIRROR_ROOT)) {
    assert.ok(sources.has(skill), `${MIRROR_ROOT}/${skill} has no source under ${PRIMARY_ROOT}`)
  }
})

test('a mirrored skill carries a pointer stub and no content of its own', async () => {
  for (const skill of await skillDirectories(MIRROR_ROOT)) {
    assert.deepEqual(
      await mirrorFiles(skill),
      ['SKILL.md'],
      `${MIRROR_ROOT}/${skill} holds content beyond its pointer stub; content belongs in ${PRIMARY_ROOT}/${skill}`,
    )

    const stub = await readFile(join(MIRROR_ROOT, skill, 'SKILL.md'), 'utf8')
    const body = stub.replace(FRONTMATTER, '')
    assert.ok(
      body.includes(`${PRIMARY_ROOT}/${skill}/SKILL.md`),
      `${MIRROR_ROOT}/${skill}/SKILL.md does not point at ${PRIMARY_ROOT}/${skill}/SKILL.md`,
    )
    assert.doesNotMatch(
      body,
      /^#/m,
      `${MIRROR_ROOT}/${skill}/SKILL.md has grown headings; a stub only names its source`,
    )
  }
})

test('a mirrored skill declares the same identity as its source', async () => {
  for (const skill of await skillDirectories(MIRROR_ROOT)) {
    const [source, mirror] = await Promise.all([
      readFile(join(PRIMARY_ROOT, skill, 'SKILL.md'), 'utf8'),
      readFile(join(MIRROR_ROOT, skill, 'SKILL.md'), 'utf8'),
    ])
    const sourceFrontmatter = source.match(FRONTMATTER)
    const mirrorFrontmatter = mirror.match(FRONTMATTER)
    assert.ok(sourceFrontmatter, `${PRIMARY_ROOT}/${skill}/SKILL.md has no frontmatter`)
    assert.ok(mirrorFrontmatter, `${MIRROR_ROOT}/${skill}/SKILL.md has no frontmatter`)
    assert.equal(
      mirrorFrontmatter[0],
      sourceFrontmatter[0],
      `${skill} frontmatter drifted between runtime roots; the stub must copy the source's name and description`,
    )
  }
})
