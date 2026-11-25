import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { CardKind, RunRecord, SavedBoard } from '../../graph/types'
import {
  ALPHA_PROFILE_SCHEMA_FIXTURE_IDS,
  PROFILE_DURABLE_CLASS_COVERAGE,
  PROFILE_DURABLE_STRUCTURE_CHECKS,
  PROFILE_FIXTURE_CORPUS_SHA256,
  PROFILE_FIXTURE_SCHEMA_VERSION,
  PROFILE_FIXTURE_SEAMS,
  PROFILE_FIXTURE_VALIDATION_CODE_COVERAGE,
  PROFILE_FIXTURE_VALIDATION_CODES,
  SAVED_BOARD_DURABLE_CLASS_BRIDGE,
  SAVED_BOARD_SCHEMA_FIXTURE_IDS,
  canonicalProfileFixtureCorpusJson,
  profileFixtureCorpus,
  validateProfileFixtureCorpus,
  type ProfileFixtureCase,
  type ProfileFixtureId,
  type ProfileFixtureValidationCode,
  type SupportedProfileSource,
} from './profileFixtureCorpus'

type Corpus = readonly ProfileFixtureCase[]

function fixture<Id extends ProfileFixtureId>(id: Id): Extract<ProfileFixtureCase, { id: Id }> {
  const found = profileFixtureCorpus.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Missing fixture ${id}`)
  return found as Extract<ProfileFixtureCase, { id: Id }>
}

function replaceData(id: ProfileFixtureId, data: unknown, corpus: Corpus = profileFixtureCorpus): ProfileFixtureCase[] {
  return corpus.map((candidate) => candidate.id === id
    ? { ...candidate, data } as unknown as ProfileFixtureCase
    : candidate)
}

function replaceCase(id: ProfileFixtureId, replacement: unknown, corpus: Corpus = profileFixtureCorpus): ProfileFixtureCase[] {
  return corpus.map((candidate) => candidate.id === id ? replacement as ProfileFixtureCase : candidate)
}

function mutateSource(mutator: (source: SupportedProfileSource) => unknown): ProfileFixtureCase[] {
  const source = fixture('supported-multi-idea-source')
  return replaceData(source.id, mutator(source.data))
}

function mutateMainBoard(mutator: (board: SavedBoard) => unknown): ProfileFixtureCase[] {
  return mutateSource((source) => ({
    ...source,
    boards: {
      ...source.boards,
      'idea-main': mutator(source.boards['idea-main']),
    },
  }))
}

function validationCodes(corpus: Corpus): ProfileFixtureValidationCode[] {
  return validateProfileFixtureCorpus(corpus).map((issue) => issue.code)
}

describe('Profile fixture corpus', () => {
  it('contains a supported multi-Idea source with an active Idea', () => {
    const source = fixture('supported-multi-idea-source')

    expect(source).toMatchObject({
      schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
      kind: 'input',
      targetSeam: 'profile-source',
      privacyClass: 'synthetic-public',
    })
    expect(source.data.ideas).toHaveLength(2)
    expect(source.data.ideas.map((idea) => idea.id)).toContain(source.data.activeIdeaId)
    expect(source.expectedObservableOutcome).toMatch(/active Idea/i)
  })

  it('is self-consistent, referentially intact, privacy-safe, and free of executable Mod content', () => {
    expect(validateProfileFixtureCorpus()).toEqual([])
  })

  it('anchors every durable class and closed fixture seam to an exhaustive record', () => {
    const source = fixture('supported-multi-idea-source')

    expect(new Set(source.data.durableClasses)).toEqual(new Set(Object.keys(PROFILE_DURABLE_CLASS_COVERAGE)))
    for (const durableClass of Object.values(SAVED_BOARD_DURABLE_CLASS_BRIDGE)) {
      if (durableClass === 'schema-metadata') continue
      expect(PROFILE_DURABLE_CLASS_COVERAGE[durableClass]).toBe(true)
      expect(PROFILE_DURABLE_STRUCTURE_CHECKS[durableClass]).toBeTypeOf('function')
    }
    expect(new Set(profileFixtureCorpus.map((candidate) => candidate.targetSeam))).toEqual(new Set(PROFILE_FIXTURE_SEAMS))
    expect(profileFixtureCorpus.some((candidate) => (candidate.kind as string) === 'future-certification')).toBe(false)
  })

  it('provides concrete feedable adversarial, transaction, export, Gateway, and platform payloads without claiming certification', () => {
    const reordered = fixture('reordered-serialization-input').data
    const duplicateMissing = fixture('duplicate-and-missing-id-input').data
    const missingAsset = fixture('missing-asset-reference-input').data
    const imageHeavy = fixture('image-heavy-input').data
    const interrupted = fixture('interrupted-write-input').data
    const transaction = fixture('atomic-transaction-rollback-scenario').data
    const portable = fixture('portable-export-import-restore-duplicate-scenario').data
    const gateway = fixture('agent-gateway-allow-deny-scenario').data
    const platform = fixture('macos-arm64-windows-x64-evidence-scenario').data

    expect(reordered.profile.boards['idea-main'].cards).toHaveLength(fixture('supported-multi-idea-source').data.boards['idea-main'].cards.length)
    expect(reordered.expectedLogicalIds).toMatchObject({
      activeIdeaId: reordered.profile.activeIdeaId,
      ideaIds: reordered.profile.ideas.map((idea) => idea.id).sort(),
      boardIds: Object.keys(reordered.profile.boards).sort(),
      mainCardIds: reordered.profile.boards['idea-main'].cards.map((card) => card.id).sort(),
    })
    expect(duplicateMissing.profile.boards['idea-main'].cards.length).toBeGreaterThan(fixture('supported-multi-idea-source').data.boards['idea-main'].cards.length)
    const missingAssetRecord = missingAsset.profile.boards['idea-main'].cards
      .flatMap((card) => Array.isArray(card.assets) ? card.assets : [])
      .find((asset) => asset.id === missingAsset.missingAssetId)
    expect(missingAssetRecord).not.toHaveProperty('dataUrl')
    expect(imageHeavy.profile.boards['idea-main'].cards.flatMap((card) => card.assets ?? [])).toHaveLength(64)
    expect(interrupted.prior.revision).toBe(7)
    expect(interrupted.pending.revision).toBe(8)
    expect(transaction.before).toEqual(transaction.expected)
    expect(portable.archive.board.cards).toHaveLength(fixture('supported-multi-idea-source').data.boards['idea-main'].cards.length)
    expect(Object.keys(portable.duplicate.remapIds)).toEqual(expect.arrayContaining(Object.values(portable.manifest.logicalIds).flat()))
    expect(gateway.requests.map((request) => request.expected.admitted)).toEqual([true, true, false, false])
    expect(platform.platformEvidence).toEqual([
      expect.objectContaining({ platform: 'macos-arm64', evidenceKind: 'input-vector', certified: false }),
      expect.objectContaining({ platform: 'windows-x64', evidenceKind: 'input-vector', certified: false }),
    ])
  })

  it('carries real PNG bytes plus reciprocal Ask and Conversation provenance', () => {
    const board = fixture('supported-multi-idea-source').data.boards['idea-main']
    const portable = fixture('portable-export-import-restore-duplicate-scenario').data
    const image = board.cards.flatMap((card) => card.assets ?? [])[0]
    const decoded = atob(image.dataUrl.split(',')[1])
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    const manifestAsset = portable.manifest.assets.find((asset) => asset.id === image.id)
    const runByVersion = new Map(board.runs.map((run) => [run.producedVersionId, run]))
    const versions = board.outputs.flatMap((output) => output.versions)
    const conversationRun = board.runs.find((run) => run.kind === 'conversation')
    const createdEvent = board.intentLog?.find((event) => event.type === 'card.created')

    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes).toHaveLength(image.size)
    expect(manifestAsset?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(versions.every((version) => runByVersion.get(version.id)?.id === version.fromRunId)).toBe(true)
    expect(conversationRun?.conversation).toMatchObject({
      participants: [expect.objectContaining({ cardId: 'card-ask' })],
      sharedContext: [expect.objectContaining({ cardId: 'card-note' })],
      topLevelMods: [expect.objectContaining({ cardId: 'card-mod' })],
    })
    expect(board.outputs.flatMap((output) => output.versions).some((version) => version.transcript?.some((message) => message.participantCardId === 'card-ask'))).toBe(true)
    expect(createdEvent).toMatchObject({ data: { card: { id: 'card-note', kind: 'note' } } })
  })

  it('rejects values JSON serialization would silently erase or conceal', () => {
    const source = fixture('supported-multi-idea-source')
    const functionValue = { ...source.data, marker: () => 'synthetic' }
    const concealedPrivateValue = {
      ...source.data,
      concealed: {
        secret: 'private-user-home/' + '.' + 'eido',
        toJSON: () => ({ safe: true }),
      },
    }
    const nonEnumerableValue = { ...source.data }
    Object.defineProperty(nonEnumerableValue, 'concealed', { value: 'synthetic', enumerable: false })

    expect(validationCodes(replaceData(source.id, functionValue))).toContain('invalid-json-value')
    expect(validationCodes(replaceData(source.id, concealedPrivateValue))).toEqual(expect.arrayContaining(['invalid-json-value', 'private-material']))
    expect(validationCodes(replaceData(source.id, nonEnumerableValue))).toContain('invalid-json-value')
  })

  it('scans decoded data-URL bytes for executable or credential-shaped material', () => {
    const source = fixture('supported-multi-idea-source')
    const encodedExecutables = [
      'data:text/plain;charset=utf-8;base64,PHNjcmlwdD5zeW50aGV0aWM8L3NjcmlwdD4=',
      'data:text/plain;base64, PHNjcmlwdD5zeW50aGV0aWM8L3NjcmlwdD4= \n',
      'data:text/plain;base64,PHNjcmlwdD5zeW50aGV0aWM8L3NjcmlwdD4_Pz8',
    ]

    for (const marker of encodedExecutables) {
      expect(validationCodes(replaceData(source.id, { ...source.data, marker }))).toContain('executable-mod-content')
    }
  })

  it('fails closed when a data URL cannot be decoded', () => {
    const source = fixture('supported-multi-idea-source')

    expect(validationCodes(replaceData(source.id, { ...source.data, marker: 'data:text/plain;base64,%%%' }))).toContain('invalid-json-value')
  })

  it('fails closed for malformed compaction summaries instead of throwing', () => {
    const malformed = mutateMainBoard((board) => ({ ...board, compactionSummaries: [null, 42] }))

    expect(validationCodes(malformed)).toContain('invalid-compaction-reference')
  })

  it('requires decoded asset bytes, done-run provenance, and structural per-platform evidence', () => {
    const invalidAsset = mutateMainBoard((board) => ({
      ...board,
      cards: board.cards.map((card) => card.id === 'card-note'
        ? { ...card, assets: [{ ...(card.assets?.[0] ?? {}), dataUrl: 'data:image/png;base64,not-valid-base64' }] }
        : card),
    }))
    const unproducedRun = mutateMainBoard((board) => ({
      ...board,
      runs: board.runs.map((run) => {
        if (run.id !== 'run-main') return run
        const { producedVersionId: _removed, ...withoutProducedVersion } = run
        return withoutProducedVersion as RunRecord
      }),
    }))
    const platform = fixture('macos-arm64-windows-x64-evidence-scenario')
    const withoutOnePlatform = replaceData(platform.id, {
      ...platform.data,
      platformEvidence: platform.data.platformEvidence.filter((entry) => entry.platform !== 'windows-x64'),
    })

    expect(validationCodes(invalidAsset)).toContain('invalid-asset-reference')
    expect(validationCodes(unproducedRun)).toContain('invalid-run-reference')
    expect(validationCodes(withoutOnePlatform)).toContain('missing-platform-evidence')
  })

  it('canonicalizes nested object keys recursively, not just the fixture list', () => {
    const source = fixture('supported-multi-idea-source')
    const nestedReordered = {
      ...source.data,
      boards: {
        'idea-second': source.data.boards['idea-second'],
        'idea-main': source.data.boards['idea-main'],
      },
    }

    expect(canonicalProfileFixtureCorpusJson(replaceData(source.id, nestedReordered))).toBe(canonicalProfileFixtureCorpusJson(profileFixtureCorpus))
    expect(canonicalProfileFixtureCorpusJson([...profileFixtureCorpus].reverse())).toBe(canonicalProfileFixtureCorpusJson(profileFixtureCorpus))
  })

  it('pins recursive canonical bytes and every currently supported Board/Profile schema', () => {
    const canonical = canonicalProfileFixtureCorpusJson(profileFixtureCorpus)
    const digest = createHash('sha256').update(canonical).digest('hex')

    expect(PROFILE_FIXTURE_SCHEMA_VERSION).toBe(1)
    expect(SAVED_BOARD_SCHEMA_FIXTURE_IDS).toEqual({ 1: 'supported-multi-idea-source' })
    expect(ALPHA_PROFILE_SCHEMA_FIXTURE_IDS).toEqual({ 1: 'alpha-profile-v1-expected' })
    expect(digest).toBe(PROFILE_FIXTURE_CORPUS_SHA256)
  })

  it('has an exact negative mutation and validation result for every declared issue code', () => {
    const source = fixture('supported-multi-idea-source')
    const futureMod = fixture('future-declarative-mod-input')
    const platform = fixture('macos-arm64-windows-x64-evidence-scenario')

    const cases: ReadonlyArray<{ code: ProfileFixtureValidationCode; corpus: () => Corpus }> = [
      { code: 'duplicate-case-id', corpus: () => [...profileFixtureCorpus, source] },
      { code: 'missing-required-case', corpus: () => profileFixtureCorpus.filter((candidate) => candidate.id !== futureMod.id) },
      { code: 'invalid-case-metadata', corpus: () => replaceCase(source.id, { ...source, schemaVersion: 99 }) },
      { code: 'invalid-case-data', corpus: () => replaceData(futureMod.id, {}) },
      { code: 'invalid-json-value', corpus: () => replaceData(source.id, { ...source.data, erased: undefined }) },
      { code: 'missing-durable-class', corpus: () => mutateSource((data) => ({ ...data, durableClasses: data.durableClasses.filter((value) => value !== 'assets') })) },
      { code: 'missing-durable-structure', corpus: () => mutateMainBoard((board) => ({ ...board, compactionSummaries: [] })) },
      { code: 'invalid-active-idea', corpus: () => mutateSource((data) => ({ ...data, activeIdeaId: 'idea-absent' })) },
      { code: 'missing-board-reference', corpus: () => mutateSource((data) => ({ ...data, boards: { 'idea-main': data.boards['idea-main'] } })) },
      {
        code: 'duplicate-or-missing-id',
        corpus: () => mutateMainBoard((board) => ({
          ...board,
          cards: board.cards.map((card) => card.id === 'card-title' ? { ...card, id: 'card-note' } : card),
        })),
      },
      {
        code: 'invalid-closed-enum',
        corpus: () => mutateMainBoard((board) => ({
          ...board,
          cards: board.cards.map((card) => card.id === 'card-title' ? { ...card, kind: 'unknown-card-kind' as CardKind } : card),
        })),
      },
      {
        code: 'invalid-connection-reference',
        corpus: () => mutateMainBoard((board) => ({
          ...board,
          connections: board.connections.map((connection, index) => index === 0 ? { ...connection, from: { cardId: 'card-absent' } } : connection),
        })),
      },
      {
        code: 'invalid-asset-reference',
        corpus: () => mutateMainBoard((board) => ({
          ...board,
          cards: board.cards.map((card) => card.id === 'card-note'
            ? { ...card, assets: [{ ...(card.assets?.[0] ?? {}), dataUrl: 'data:image/png;base64,AAAA' }] }
            : card),
        })),
      },
      {
        code: 'invalid-output-reference',
        corpus: () => mutateMainBoard((board) => ({
          ...board,
          outputs: board.outputs.map((output) => output.id === 'output-result' ? { ...output, chosenVersionId: 'version-absent' } : output),
        })),
      },
      {
        code: 'invalid-run-reference',
        corpus: () => mutateMainBoard((board) => ({
          ...board,
          runs: board.runs.map((run) => {
            if (run.id !== 'run-main') return run
            const { producedVersionId: _removed, ...withoutProducedVersion } = run
            return withoutProducedVersion as RunRecord
          }),
        })),
      },
      {
        code: 'invalid-intent-reference',
        corpus: () => mutateMainBoard((board) => ({
          ...board,
          intentLog: board.intentLog?.map((event) => {
            if (event.type !== 'card.created') return event
            const { data: _removed, ...withoutData } = event
            return withoutData
          }),
        })),
      },
      {
        code: 'invalid-highlight-reference',
        corpus: () => mutateMainBoard((board) => ({
          ...board,
          highlights: board.highlights?.map((highlight) => ({ ...highlight, tagId: 'tag-absent' })),
        })),
      },
      {
        code: 'invalid-compaction-reference',
        corpus: () => mutateMainBoard((board) => ({
          ...board,
          compactionSummaries: board.compactionSummaries?.map((summary) => ({ ...summary, cardId: 'card-absent' })),
        })),
      },
      {
        code: 'missing-platform-evidence',
        corpus: () => replaceData(platform.id, { ...platform.data, platformEvidence: platform.data.platformEvidence.slice(0, 1) }),
      },
      { code: 'private-material', corpus: () => replaceData(source.id, { ...source.data, marker: 'private-user-home/' + '.' + 'eido' }) },
      { code: 'executable-mod-content', corpus: () => replaceData(source.id, { ...source.data, marker: 'function synthetic() {}' }) },
    ]

    const matrixCoverage = Object.fromEntries(cases.map(({ code }) => [code, true]))
    expect(matrixCoverage).toEqual(PROFILE_FIXTURE_VALIDATION_CODE_COVERAGE)
    expect(cases.map(({ code }) => code)).toEqual(PROFILE_FIXTURE_VALIDATION_CODES)
    for (const negative of cases) expect(validationCodes(negative.corpus()), negative.code).toEqual([negative.code])
  })
})
