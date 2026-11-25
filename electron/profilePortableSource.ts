import type { IdeaExport } from '../src/graph/types'
import { readProfileIdeaClosure, type ProfileIdeaClosure } from '../src/persistence/profileIdeaClosure'
import type { ProfilePortableZipSource } from './profilePortableZip'

declare const profilePortableSourceBrand: unique symbol

export type ProfilePortableSource = Readonly<{
  [profilePortableSourceBrand]: true
}>

export type ProfileIdeaClosureBlobRequest = Readonly<{
  sha256: string
  size: number
}>

export type ProfileIdeaClosureBlobOpener = (
  request: ProfileIdeaClosureBlobRequest,
) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>

export type ProfileLegacyIdeaSource = Readonly<{
  idea?: unknown
  board: unknown
}>

export type ProfilePortableSourceState =
  | Readonly<{ kind: 'archive'; source: ProfilePortableZipSource }>
  | Readonly<{
      kind: 'idea-closure'
      closure: ProfileIdeaClosure
      openBlob: ProfileIdeaClosureBlobOpener
    }>
  | Readonly<{ kind: 'legacy-idea'; source: ProfileLegacyIdeaSource }>

type MutableSourceState = ProfilePortableSourceState & { consumed: boolean }

const sourceStates = new WeakMap<ProfilePortableSource, MutableSourceState>()

export class ProfilePortableSourceError extends Error {}

export function createProfilePortableArchiveSource(
  source: ProfilePortableZipSource,
): ProfilePortableSource {
  return issueSource({ kind: 'archive', source })
}

export function createProfileIdeaClosureSource(input: Readonly<{
  closure: unknown
  openBlob: ProfileIdeaClosureBlobOpener
}>): ProfilePortableSource {
  if (typeof input.openBlob !== 'function') throw new Error('Profile Idea blob opener is invalid')
  const closure = readProfileIdeaClosure(input.closure)
  return issueSource({ kind: 'idea-closure', closure, openBlob: input.openBlob })
}

export function createProfileLegacyIdeaSource(candidate: unknown): ProfilePortableSource {
  const cloned = cloneBoundedJson(candidate)
  if (isIdeaExportEnvelope(cloned)) {
    return issueSource({
      kind: 'legacy-idea',
      source: Object.freeze({ idea: cloned.idea, board: cloned.board }),
    })
  }
  return issueSource({
    kind: 'legacy-idea',
    source: Object.freeze({ board: cloned }),
  })
}

export function consumeProfilePortableSource(source: ProfilePortableSource): ProfilePortableSourceState {
  const state = sourceStates.get(source)
  if (!state || state.consumed) {
    throw new ProfilePortableSourceError('Portable Profile source capability is invalid or consumed')
  }
  state.consumed = true
  switch (state.kind) {
    case 'archive':
      return Object.freeze({ kind: state.kind, source: state.source })
    case 'idea-closure':
      return Object.freeze({ kind: state.kind, closure: state.closure, openBlob: state.openBlob })
    case 'legacy-idea':
      return Object.freeze({ kind: state.kind, source: state.source })
  }
}

function issueSource(state: ProfilePortableSourceState): ProfilePortableSource {
  const source = Object.freeze(Object.create(null)) as ProfilePortableSource
  sourceStates.set(source, { ...state, consumed: false } as MutableSourceState)
  return source
}

function isIdeaExportEnvelope(value: unknown): value is IdeaExport {
  if (!isPlainRecord(value)) return false
  const keys = Object.keys(value).sort().join(',')
  return keys === 'board,exportedAt,idea,version'
    && value.version === 1
    && typeof value.exportedAt === 'string'
    && isPlainRecord(value.idea)
    && isPlainRecord(value.board)
}

function cloneBoundedJson(candidate: unknown): unknown {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: candidate, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > 2_000_000 || current.depth > 128) {
      throw new Error('Legacy Idea JSON exceeds the v1 admission bound')
    }
    const value = current.value
    if (value === null || typeof value === 'boolean' || typeof value === 'string') continue
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Legacy Idea JSON contains a non-finite number')
      continue
    }
    if (Array.isArray(value)) {
      if (Object.keys(value).some((key, index) => key !== String(index))) {
        throw new Error('Legacy Idea JSON contains a non-canonical array')
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], depth: current.depth + 1 })
      }
      continue
    }
    if (!isPlainRecord(value)) throw new Error('Legacy Idea source is not inert JSON')
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('Legacy Idea source contains an active or hidden property')
      }
      stack.push({ value: descriptor.value, depth: current.depth + 1 })
      if (key.includes('\0')) throw new Error('Legacy Idea source contains an invalid key')
    }
  }
  return JSON.parse(JSON.stringify(candidate)) as unknown
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
