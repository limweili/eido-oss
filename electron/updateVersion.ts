// Pure update-version rules (#682). No imports — this module is shared by the
// sandboxed preload bundle (which cannot require node builtins) and the main
// process feed verifier alike.

// Strict SemVer (mirrors scripts/release/release-planning.mjs); the release
// planning lane refuses a 0.0.0 core, so the feed refuses it too.
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/
const MAX_VERSION_LENGTH = 64

export function isValidUpdateVersion(version: unknown): version is string {
  return typeof version === 'string'
    && version.length <= MAX_VERSION_LENGTH
    && semverPattern.test(version)
    && version.split(/[+-]/, 1)[0] !== '0.0.0'
}

export type UpdateVersionComparison = 'upgrade' | 'same' | 'downgrade' | 'invalid'

// Refuses anything that is not a strict upgrade over the running version:
// equal and older feed versions are refused explicitly even if the feed
// regresses (no downgrade, decision 8). Build metadata is ignored.
export function compareUpdateVersions(
  currentVersion: string,
  candidateVersion: string,
): UpdateVersionComparison {
  if (typeof currentVersion !== 'string'
    || currentVersion.length > MAX_VERSION_LENGTH
    || !semverPattern.test(currentVersion)
    || !isValidUpdateVersion(candidateVersion)) {
    return 'invalid'
  }
  const ordering = compareSemver(parseSemver(currentVersion), parseSemver(candidateVersion))
  if (ordering < 0) return 'upgrade'
  if (ordering === 0) return 'same'
  return 'downgrade'
}

interface ParsedSemver {
  readonly core: readonly [number, number, number]
  readonly prerelease: readonly string[]
}

function parseSemver(version: string): ParsedSemver {
  const withoutBuild = version.split('+', 1)[0]
  const dashIndex = withoutBuild.indexOf('-')
  const core = (dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex))
    .split('.')
    .map(Number) as [number, number, number]
  const prerelease = dashIndex === -1 ? [] : withoutBuild.slice(dashIndex + 1).split('.')
  return { core, prerelease }
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] < right.core[index] ? -1 : 1
    }
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const shared = Math.min(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < shared; index += 1) {
    const ordering = comparePrereleaseIdentifier(left.prerelease[index], right.prerelease[index])
    if (ordering !== 0) return ordering
  }
  if (left.prerelease.length === right.prerelease.length) return 0
  return left.prerelease.length < right.prerelease.length ? -1 : 1
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    const leftValue = Number(left)
    const rightValue = Number(right)
    if (leftValue === rightValue) return 0
    return leftValue < rightValue ? -1 : 1
  }
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  if (left === right) return 0
  return left < right ? -1 : 1
}
