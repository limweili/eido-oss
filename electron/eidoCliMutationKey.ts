/**
 * Mutation identity derived from intent instead of chance.
 *
 * When `--idempotency-key` is omitted the key is a stable hash of the fully
 * resolved command: the positional words in order plus every remaining option,
 * with the flags in a stable order. Rerunning the exact same command therefore
 * reuses the same key, so a retry after a timeout is a safe retry rather than a
 * second Card. Changing any value changes the hash, so it becomes a new
 * operation. `--request-id` identifies the attempt, not the intent, so it stays
 * random and never feeds the hash.
 */

import { createHash } from 'node:crypto'

/** Options that stand alone. Everything else consumes the next token. */
export const EIDO_CLI_VALUELESS_OPTIONS: ReadonlySet<string> = Object.freeze(new Set([
  '--help',
  '-h',
  '--full',
  '--pretty',
  '--dry-run',
  '--apply',
  '--clear',
  '--clear-reason',
]))

/** Envelope identities and output formatting are not part of the intent. */
const EIDO_CLI_KEY_EXCLUDED_OPTIONS: ReadonlySet<string> = Object.freeze(new Set([
  '--request-id',
  '--command-id',
  '--idempotency-key',
  '--pretty',
  '--help',
  '-h',
]))

export function eidoCliOptionConsumesValue(argument: string | undefined): boolean {
  return argument?.startsWith('--') === true && !EIDO_CLI_VALUELESS_OPTIONS.has(argument)
}

export function deriveEidoCliIdempotencyKey(argv: readonly string[]): string {
  const positionals: string[] = []
  const options: Array<readonly [string, string]> = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    if (!eidoCliOptionConsumesValue(token)) {
      options.push([token, ''] as const)
      continue
    }
    options.push([token, argv[index + 1] ?? ''] as const)
    index += 1
  }
  const kept = options
    .filter(([flag]) => !EIDO_CLI_KEY_EXCLUDED_OPTIONS.has(flag))
    // Array.prototype.sort is stable, so repeated flags keep the given order.
    .sort((left, right) => left[0].localeCompare(right[0]))
  const canonical = JSON.stringify({
    version: 1,
    command: positionals,
    options: kept.map(([flag, value]) => [flag, value]),
  })
  return `derived:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}
