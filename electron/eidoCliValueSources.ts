/**
 * Large values reach the CLI without shell quoting hazards or argv length
 * limits. For the flags listed here a value of `-` reads that flag's value from
 * stdin, and a value of `@PATH` reads it from that file. A literal value is
 * escaped by doubling the marker: `--` is the literal `-`, and `@@name` is the
 * literal `@name`. One trailing newline is removed from what is read, because a
 * pipe or a text file almost always ends with one.
 *
 * `eido batch` is untouched: it keeps consuming raw stdin as one whole Gateway
 * envelope, so resolution never runs for it.
 */

import { readFile, stat } from 'node:fs/promises'
import { PROFILE_AGENT_COMMAND_LIMITS } from '../src/persistence/profileAgentCommandManifest'
import { eidoCliOptionConsumesValue } from './eidoCliMutationKey'
import { eidoCliUsageError, type EidoCliUsageError } from './eidoCliCommands'

/** Each resolvable flag keeps the byte bound it already had. */
export const EIDO_CLI_VALUE_SOURCE_FLAGS: Readonly<Record<string, number>> = Object.freeze({
  '--spec': PROFILE_AGENT_COMMAND_LIMITS.maxRequestBytes,
  '--frames': PROFILE_AGENT_COMMAND_LIMITS.maxRequestBytes,
  '--body': PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes,
  '--text': PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes,
  '--group-title': PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes,
  '--compression-prompt': PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes,
  '--topic': PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes,
  '--reason': PROFILE_AGENT_COMMAND_LIMITS.maxReasonBytes,
})

export type EidoCliValueResolution =
  | Readonly<{ ok: true; argv: readonly string[] }>
  | Readonly<{ ok: false; error: EidoCliUsageError }>

function isResolvableFlag(token: string): boolean {
  return Object.prototype.hasOwnProperty.call(EIDO_CLI_VALUE_SOURCE_FLAGS, token)
}

/** Help and `eido batch` must never consume stdin or touch the file system. */
function skipsResolution(argv: readonly string[]): boolean {
  return argv[0] === 'batch'
    || argv[0] === 'help'
    || argv.includes('--help')
    || argv.includes('-h')
    || !argv.some(token => isResolvableFlag(token))
}

export async function resolveEidoCliValueSources(
  argv: readonly string[],
  stdin: AsyncIterable<string | Uint8Array>,
): Promise<EidoCliValueResolution> {
  if (skipsResolution(argv)) return { ok: true, argv }
  const resolved: string[] = []
  let stdinFlag: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    resolved.push(token)
    if (!eidoCliOptionConsumesValue(token)) continue
    const value = argv[index + 1]
    if (value === undefined) continue
    index += 1
    if (!isResolvableFlag(token)) {
      resolved.push(value)
      continue
    }
    const maxBytes = EIDO_CLI_VALUE_SOURCE_FLAGS[token]!
    if (value === '-') {
      if (stdinFlag !== undefined) {
        return failure(argv, {
          code: 'cli.usage',
          message: `Only one option may read stdin. Both ${stdinFlag} and ${token} asked for it with -.`,
          hint: 'Read the second value from a file with @PATH.',
        })
      }
      stdinFlag = token
      const read = await readEidoCliStdin(stdin, token, maxBytes)
      if (!read.ok) return failure(argv, read.error)
      resolved.push(read.value)
      continue
    }
    if (value.startsWith('@') && !value.startsWith('@@')) {
      const read = await readEidoCliFile(value.slice(1), token, maxBytes)
      if (!read.ok) return failure(argv, read.error)
      resolved.push(read.value)
      continue
    }
    resolved.push(value === '--' ? '-' : value.startsWith('@@') ? value.slice(1) : value)
  }
  return { ok: true, argv: Object.freeze(resolved) }
}

function failure(
  argv: readonly string[],
  detail: EidoCliUsageError,
): Readonly<{ ok: false; error: EidoCliUsageError }> {
  return { ok: false, error: eidoCliUsageError(argv, detail) }
}

type ReadOutcome =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{ ok: false; error: EidoCliUsageError }>

async function readEidoCliStdin(
  stdin: AsyncIterable<string | Uint8Array>,
  flag: string,
  maxBytes: number,
): Promise<ReadOutcome> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    for await (const chunk of stdin) {
      const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
      byteLength += bytes.byteLength
      if (byteLength > maxBytes) {
        return {
          ok: false,
          error: {
            code: 'cli.usage',
            message: `Value read from stdin for ${flag} is over the ${maxBytes} byte limit.`,
            hint: 'Send a smaller value, or split the work into more than one command.',
          },
        }
      }
      chunks.push(bytes)
    }
  } catch {
    return {
      ok: false,
      error: { code: 'cli.usage', message: `Value for ${flag} could not be read from stdin.` },
    }
  }
  return { ok: true, value: withoutTrailingNewline(decodeChunks(chunks, byteLength)) }
}

async function readEidoCliFile(
  filePath: string,
  flag: string,
  maxBytes: number,
): Promise<ReadOutcome> {
  if (filePath.length === 0) {
    return {
      ok: false,
      error: {
        code: 'cli.usage',
        message: `Option ${flag} was given @ with no file path.`,
        hint: 'Write @PATH, or @@ to start a literal value with @.',
      },
    }
  }
  let byteLength: number
  try {
    const stats = await stat(filePath)
    if (!stats.isFile()) {
      return {
        ok: false,
        error: {
          code: 'cli.usage',
          message: `Path ${JSON.stringify(filePath)} for ${flag} is not a file.`,
        },
      }
    }
    byteLength = stats.size
  } catch {
    return {
      ok: false,
      error: {
        code: 'cli.usage',
        message: `File ${JSON.stringify(filePath)} for ${flag} could not be read.`,
        hint: 'Check the path exists and is readable by this user.',
      },
    }
  }
  if (byteLength > maxBytes) {
    return {
      ok: false,
      error: {
        code: 'cli.usage',
        message: `File ${JSON.stringify(filePath)} for ${flag} is ${byteLength} bytes, over the ${maxBytes} byte limit.`,
        hint: 'Send a smaller value, or split the work into more than one command.',
      },
    }
  }
  try {
    return { ok: true, value: withoutTrailingNewline(await readFile(filePath, 'utf8')) }
  } catch {
    return {
      ok: false,
      error: {
        code: 'cli.usage',
        message: `File ${JSON.stringify(filePath)} for ${flag} could not be read.`,
        hint: 'Check the path exists and is readable by this user.',
      },
    }
  }
}

function decodeChunks(chunks: readonly Uint8Array[], byteLength: number): string {
  const joined = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

function withoutTrailingNewline(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  return value.endsWith('\n') ? value.slice(0, -1) : value
}
