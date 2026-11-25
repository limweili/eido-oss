import { describe, expect, it } from 'vitest'
import { researchDepthOf } from '../brain/researchDepth'
import { researchJobOf } from '../brain/researchJobMeta'
import { reachModeOf } from '../brain/reachMode'
import { effectiveCardCreatorKind } from '../graph/cardAuthorship'
import { noteFontSizeOf } from '../graph/noteFontSize'
import {
  linkPreviewAttempted,
  linkPreviewDismissed,
  noteLinkPreviews,
} from '../shared/linkPreview'
import type { IntentLogEvent } from '../graph/types'
import { snapshotModValues } from '../mods'
import {
  createCompleteProfileFixture,
  createProfileAgentEventFixture,
  CURRENT_ASSET_DIGEST,
  HISTORICAL_ASSET_DIGEST,
} from './fixtures/profileLogicalProjectionFixture'
import {
  SYNTHETIC_MAIN_BOARD,
} from './fixtures/profileFixtureCorpus'
import {
  enumerateProfileAssetDigests,
  enumerateProfileLogicalAssetIds,
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
  ProfileLogicalProjectionError,
  stampProfileCardAuthorship,
  validateProfileLogicalDocument,
  type ProfileLogicalDocument,
  type ProfileLogicalRecordSpec,
} from './profileLogicalProjection'
import { PROFILE_CONTRACT_VERSIONS } from './profileServiceContract'
import { toProfileLogicalAssetPayload } from './profileAssetKernel'

describe('Profile logical projection (#594)', () => {
  it('round-trips explicit managed Run provenance while legacy routes remain readable', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const run = snapshot.boards['idea-main']!.runs[0]!
    run.aiAccessPhases = [
      { routeClass: 'byok', policyRevision: null },
      { routeClass: 'managed', policyRevision: 'managed-openrouter-v1' },
      { routeClass: 'hosted-free', policyRevision: 'hosted-free-v1' },
      { routeClass: 'hosted-paid', policyRevision: null },
    ]

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)

    expect(hydrated.boards['idea-main']!.runs[0]!.aiAccessPhases).toEqual(
      snapshot.boards['idea-main']!.runs[0]!.aiAccessPhases,
    )
  })

  it('rejects route provenance that could reinterpret funding authority', () => {
    const fixture = createCompleteProfileFixture()
    const byokWithManagedPolicy = clone(fixture.snapshot)
    byokWithManagedPolicy.boards['idea-main']!.runs[0]!.aiAccessPhases = [{
      routeClass: 'byok',
      policyRevision: 'managed-openrouter-v1',
    } as never]
    const managedWithoutPolicy = clone(fixture.snapshot)
    managedWithoutPolicy.boards['idea-main']!.runs[0]!.aiAccessPhases = [{
      routeClass: 'managed',
      policyRevision: null,
    } as never]

    expect(() => projectProfileSnapshot(byokWithManagedPolicy, fixture.projectAsset))
      .toThrow(/not a current Run/)
    expect(() => projectProfileSnapshot(managedWithoutPolicy, fixture.projectAsset))
      .toThrow(/not a current Run/)
  })

  it('round-trips provider-specific model catalogs as logical Idea settings', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    snapshot.boards['idea-main']!.aiSettings = {
      provider: 'claude-code',
      model: 'claude-fable-5',
      models: ['sonnet', 'claude-fable-5'],
      providerModels: {
        openrouter: { model: 'openai/gpt-4o-mini', models: ['openai/gpt-4o-mini'] },
        'claude-code': { model: 'claude-fable-5', models: ['sonnet', 'claude-fable-5'] },
        codex: { model: 'default', models: ['default'] },
        antigravity: { model: 'auto', models: ['auto'] },
      },
      reasoningEffort: 'high',
    }

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)

    expect(hydrated.boards['idea-main']?.aiSettings).toEqual(snapshot.boards['idea-main']?.aiSettings)
  })

  it('carries a reach mode in card.meta through a build that predates it, and reads older saves as Web', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const cards = snapshot.boards['idea-main']!.cards!
    const ask = cards.find((card) => card.kind === 'askAi')!
    ask.meta = { reachMode: 'research' }

    // The persistence validator is untouched, so the projection and hydration
    // below run byte-for-byte the code of the build that predates the mode:
    // this is a real save opening in yesterday's app, not an inspection of
    // the validator. `card.agentic` stays the boolean carrying "reach is on",
    // so the Board's reach survives even where the mode is unread.
    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)

    const hydratedAsk = hydrated.boards['idea-main']!.cards!
      .find((card) => card.kind === 'askAi')!
    expect(hydratedAsk.meta).toEqual({ reachMode: 'research' })
    expect(reachModeOf(hydratedAsk)).toBe('research')

    // An older save carries no mode at all, and a value from a build this one
    // has never met is a preference it cannot read: both are Web, never a
    // refused Board.
    expect(reachModeOf({ meta: undefined })).toBe('web')
    expect(reachModeOf({ meta: { reachMode: 'exhaustive' } })).toBe('web')
  })

  it('writes no Card key the previously shipped build would refuse', () => {
    // WHY THIS PIN EXISTS. A top level Card key an older validator has never
    // heard of does not fail one Card. hasOnlyKeys refuses the Card, and that
    // refusal raises ProfileRevisionCorruptionError for the WHOLE revision, so
    // a founder who dismissed one preview or enlarged one Note and then
    // reinstalled the previous version could not open ANY Board. Presentation
    // and preference state therefore travels in `meta`, which every shipped
    // build carries through untouched.
    //
    // This list is the previous shipped build's allowlist, copied verbatim. It
    // is a pin, not a mirror of the current validator: never widen it to make
    // a new field pass.
    const PREVIOUSLY_SHIPPED_CARD_KEYS = [
      'id', 'kind', 'createdBy', 'lastModifiedBy', 'title', 'headerColor',
      'headerFill', 'blocks', 'assets', 'linkPreview', 'localHtmlPreview',
      'compressionPrompt', 'mod', 'modV2', 'model', 'conversationStyle',
      'conversationTurns', 'fontSize', 'source', 'agentic', 'zIndex',
      'position', 'size', 'groupId', 'meta',
      // Projection bookkeeping, never part of the Card itself.
      'assetIds',
    ]
    const PREVIOUSLY_SHIPPED_FONT_SIZES = ['small', 'medium', 'large']

    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const cards = snapshot.boards['idea-main']!.cards!
    const note = cards.find((card) => card.kind === 'note')!
    // A Note whose body carries three links, sized past the retired Large, with
    // one address dismissed and one already tried. Only the first preview may
    // reach disk as a top level key; everything else rides in the envelope.
    note.linkPreview = { url: 'https://one.example/a', status: 'ready', title: 'One' }
    note.meta = {
      noteFontSize: 5,
      linkPreviewExtras: [
        { url: 'https://two.example/b', status: 'ready', title: 'Two' },
        { url: 'https://three.example/c', status: 'loading' },
      ],
      linkPreviewDismissedUrls: ['https://drybread.studio/'],
      linkPreviewAttemptedUrls: ['https://drybread.studio/'],
    }
    snapshot.boards['idea-main']!.intentLog = [{
      id: 'event-note-deleted',
      type: 'card.deleted',
      at: '2026-08-26T00:00:00.000Z',
      cardId: note.id,
      data: { card: clone(note), connections: [] },
    } as unknown as IntentLogEvent]

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const storedCards = document.records
      .filter((record) => record.kind === 'card')
      .map((record) => record.payload as Record<string, unknown>)
    const storedHistoricalCards = document.records
      .filter((record) => record.kind === 'intent-event')
      .flatMap((record) => {
        const data = (record.payload as Record<string, unknown>).data as Record<string, unknown>
        return data?.card ? [data.card as Record<string, unknown>] : []
      })

    // History embeds a whole Card, so a deleted step 5 Note must not leave an
    // unreadable size in an older build's Intent Log either.
    expect(storedHistoricalCards).toHaveLength(1)
    for (const stored of [...storedCards, ...storedHistoricalCards]) {
      expect(Object.keys(stored).filter((key) => !PREVIOUSLY_SHIPPED_CARD_KEYS.includes(key)))
        .toEqual([])
      // Nothing writes the retired top-level field any more, and the value the
      // old build's strict union would refuse never appears there.
      if (stored.fontSize !== undefined) {
        expect(PREVIOUSLY_SHIPPED_FONT_SIZES).toContain(stored.fontSize)
      }
    }

    // The envelope reaches disk exactly as the runtime held it, and the one
    // key the old build reads for a preview still holds a preview it
    // understands, so that build shows this Note with its first tile at its
    // own default size.
    const storedNote = storedCards.find((stored) => stored.id === note.id)!
    expect(storedNote).not.toHaveProperty('fontSize')
    expect(storedNote.meta).toEqual(note.meta)
    expect(storedNote.linkPreview).toEqual(note.linkPreview)

    // This build reads the exact step, all three previews, and the untouched
    // envelope straight back.
    const hydratedNote = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
      .boards['idea-main']!.cards!.find((card) => card.id === note.id)!
    expect(noteFontSizeOf(hydratedNote)).toBe(5)
    expect(hydratedNote.meta).toEqual(note.meta)
    expect(noteLinkPreviews(hydratedNote)).toHaveLength(3)
    expect(linkPreviewDismissed(hydratedNote, 'https://drybread.studio/')).toBe(true)
    expect(linkPreviewAttempted(hydratedNote, 'https://drybread.studio/')).toBe(true)
  })

  it('degrades an unreadable extra preview list to the one preview it can show', () => {
    const fixture = createCompleteProfileFixture()
    const first = { url: 'https://one.example/a', status: 'ready' as const, title: 'One' }

    // A bag value this build cannot read is a Board written by another build,
    // not a corrupt Profile. It rides through untouched, the Note shows the
    // preview it does understand, and nothing around it is refused.
    for (const meta of [
      { linkPreviewExtras: 'not a list' },
      { linkPreviewExtras: [{ url: 'not-a-url', status: 'ready' }] },
      { linkPreviewExtras: [] },
    ]) {
      const snapshot = clone(fixture.snapshot)
      const note = snapshot.boards['idea-main']!.cards!.find((card) => card.kind === 'note')!
      note.linkPreview = first
      note.meta = meta
      const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
      const reloaded = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
        .boards['idea-main']!.cards!.find((card) => card.id === note.id)!
      expect(reloaded.meta).toEqual(meta)
      expect(noteLinkPreviews(reloaded)).toEqual([first])
    }

    // Extras without a first preview are the same story: no preview at all,
    // and the Board still opens.
    expect(noteLinkPreviews({
      meta: { linkPreviewExtras: [{ url: 'https://two.example/b', status: 'ready' }] },
    })).toEqual([])
  })

  it('carries a research job id in card.meta through a quit, with the validator unchanged (#963)', () => {
    // A submitted research job cannot be cancelled and bills whether Eido is
    // listening or not, so the id stashed at submission must survive the app
    // closing mid-poll. This is that survival at its authoritative seam: the
    // projection and hydration below run byte-for-byte the code of a build
    // that has never heard of research jobs, and the stash rides through.
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const cards = snapshot.boards['idea-main']!.cards!
    const ask = cards.find((card) => card.kind === 'askAi')!
    ask.meta = { researchJob: { id: 'job-42', submittedAt: '2026-08-18T00:00:00.000Z' } }

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)

    const hydratedAsk = hydrated.boards['idea-main']!.cards!
      .find((card) => card.kind === 'askAi')!
    expect(hydratedAsk.meta).toEqual({
      researchJob: { id: 'job-42', submittedAt: '2026-08-18T00:00:00.000Z' },
    })
    expect(researchJobOf(hydratedAsk)).toEqual({
      id: 'job-42',
      submittedAt: '2026-08-18T00:00:00.000Z',
    })

    // A half-written or foreign value is no handle at all, never a crash.
    expect(researchJobOf({ meta: { researchJob: { id: '' } } })).toBeNull()
    expect(researchJobOf({ meta: { researchJob: 'job-42' } })).toBeNull()
    expect(researchJobOf({ meta: undefined })).toBeNull()
  })

  it('carries the chosen research depth in card.meta through a build that predates it, and reads older saves as S (#971)', () => {
    // The depth the person paying pressed is per Card and survives a reload.
    // Like the reach mode and the job id before it, it rides in `card.meta`,
    // the one open record, so the projection and hydration below run
    // byte-for-byte the code of a build that has never heard of the choice
    // and the Board is carried, not refused.
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const cards = snapshot.boards['idea-main']!.cards!
    const ask = cards.find((card) => card.kind === 'askAi')!
    ask.meta = { researchDepth: 'L' }

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)

    const hydratedAsk = hydrated.boards['idea-main']!.cards!
      .find((card) => card.kind === 'askAi')!
    expect(hydratedAsk.meta).toEqual({ researchDepth: 'L' })
    expect(researchDepthOf(hydratedAsk)).toBe('L')

    // An older save carries no depth, and a value from a build this one has
    // never met is a choice it cannot trust: both read as S, the cheapest,
    // because an unrecognised choice must never submit a dearer job than the
    // person would have picked.
    expect(researchDepthOf({ meta: undefined })).toBe('S')
    expect(researchDepthOf({ meta: { researchDepth: 'XXL' } })).toBe('S')
    expect(researchDepthOf(undefined)).toBe('S')
  })

  it('keeps accepting the retired top-level Note scale while the live scale rides in card.meta (#1308)', () => {
    // The Note scale moved into the settings envelope, but `fontSize` MUST
    // stay on the validator's key allowlist. Every Profile already saved
    // carries the field, and `hasOnlyKeys` fails a Card on a key it does not
    // recognise, which fails the projection and reports the whole revision as
    // corrupt. Dropping the key would therefore break exactly the Profiles the
    // envelope exists to protect. It is legacy and READ-ONLY: still accepted,
    // never written.
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const cards = snapshot.boards['idea-main']!.cards!
    const legacyNote = cards.find((card) => card.kind === 'note')!
    ;(legacyNote as { fontSize?: unknown }).fontSize = 'large'

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
    const hydratedNote = hydrated.boards['idea-main']!.cards!
      .find((card) => card.kind === 'note')!

    // Carried through untouched, and the one reader still resolves it, so a
    // Profile written before the move opens with the scale the person picked.
    expect(hydratedNote).toHaveProperty('fontSize', 'large')
    expect(noteFontSizeOf(hydratedNote)).toBe(3)

    // The legacy field keeps the strict union it shipped with, because that is
    // what every installed build enforces. A scale outside the union still
    // fails closed there, which is the reason the live scale had to move.
    const forged = clone(snapshot)
    const forgedNote = forged.boards['idea-main']!.cards!.find((card) => card.kind === 'note')!
    ;(forgedNote as { fontSize?: unknown }).fontSize = 'x-large'
    expect(() => projectProfileSnapshot(forged, fixture.projectAsset))
      .toThrow(ProfileLogicalProjectionError)

    // The envelope is where a scale from a build this one has never met is
    // safe: it is carried, not refused, and reads as the default.
    const enveloped = clone(snapshot)
    const envelopedNote = enveloped.boards['idea-main']!.cards!.find((card) => card.kind === 'note')!
    envelopedNote.meta = { noteFontSize: 'x-large' }
    expect(() => projectProfileSnapshot(enveloped, fixture.projectAsset)).not.toThrow()
    expect(noteFontSizeOf({ meta: { noteFontSize: 'x-large' } })).toBe(2)
  })

  it('derives Group authorship from membership changes without treating member content as Group content', () => {
    const fixture = createCompleteProfileFixture()
    const actor = {
      kind: 'user' as const,
      client: 'eido-desktop',
      sessionId: 'profile-gui-session',
    }
    const currentSnapshot = clone(fixture.snapshot)
    const current = projectProfileSnapshot(currentSnapshot, fixture.projectAsset)

    const membershipTargetSnapshot = clone(currentSnapshot)
    delete membershipTargetSnapshot.boards['idea-main']!.cards
      .find((card) => card.id === 'card-note')!.groupId
    const membershipTarget = projectProfileSnapshot(membershipTargetSnapshot, fixture.projectAsset)
    const membershipStamped = stampProfileCardAuthorship(current, membershipTarget, actor)

    expect(membershipStamped.records.find((record) => record.recordId === 'card-group')?.payload)
      .toMatchObject({ lastModifiedBy: actor })
    expect(membershipStamped.records.find((record) => record.recordId === 'card-note')?.payload)
      .toMatchObject({ lastModifiedBy: actor })

    const contentTargetSnapshot = clone(currentSnapshot)
    contentTargetSnapshot.boards['idea-main']!.cards
      .find((card) => card.id === 'card-note')!.blocks[0]!.text = 'User-revised member text'
    const contentTarget = projectProfileSnapshot(contentTargetSnapshot, fixture.projectAsset)
    const contentStamped = stampProfileCardAuthorship(current, contentTarget, actor)

    expect(contentStamped.records.find((record) => record.recordId === 'card-note')?.payload)
      .toMatchObject({ lastModifiedBy: actor })
    expect(contentStamped.records.find((record) => record.recordId === 'card-group')?.payload)
      .not.toHaveProperty('lastModifiedBy')
  })

  it('attributes member order to the Group without adopting reordered member Cards', () => {
    const fixture = createCompleteProfileFixture()
    const actor = {
      kind: 'user' as const,
      client: 'eido-desktop',
      sessionId: 'profile-gui-session',
    }
    const currentSnapshot = clone(fixture.snapshot)
    const currentCards = currentSnapshot.boards['idea-main']!.cards
    currentCards.find((card) => card.id === 'card-ask')!.groupId = 'card-group'
    const current = projectProfileSnapshot(currentSnapshot, fixture.projectAsset)
    const targetSnapshot = clone(currentSnapshot)
    const targetCards = targetSnapshot.boards['idea-main']!.cards
    const noteIndex = targetCards.findIndex((card) => card.id === 'card-note')
    const askIndex = targetCards.findIndex((card) => card.id === 'card-ask')
    ;[targetCards[noteIndex], targetCards[askIndex]] = [targetCards[askIndex]!, targetCards[noteIndex]!]

    const stamped = stampProfileCardAuthorship(
      current,
      projectProfileSnapshot(targetSnapshot, fixture.projectAsset),
      actor,
    )

    expect(stamped.records.find((record) => record.recordId === 'card-group')?.payload)
      .toMatchObject({ lastModifiedBy: actor })
    expect(stamped.records.find((record) => record.recordId === 'card-note')?.payload)
      .not.toHaveProperty('lastModifiedBy')
    expect(stamped.records.find((record) => record.recordId === 'card-ask')?.payload)
      .not.toHaveProperty('lastModifiedBy')
  })

  it('does not adopt Cards whose only change is a top-level projection reindex', () => {
    const fixture = createCompleteProfileFixture()
    const actor = {
      kind: 'user' as const,
      client: 'eido-desktop',
      sessionId: 'profile-gui-session',
    }
    const currentSnapshot = clone(fixture.snapshot)
    const current = projectProfileSnapshot(currentSnapshot, fixture.projectAsset)
    const targetSnapshot = clone(currentSnapshot)
    const targetCards = targetSnapshot.boards['idea-main']!.cards
    const askIndex = targetCards.findIndex((card) => card.id === 'card-ask')
    const resultIndex = targetCards.findIndex((card) => card.id === 'card-result')
    ;[targetCards[askIndex], targetCards[resultIndex]] = [targetCards[resultIndex]!, targetCards[askIndex]!]

    const stamped = stampProfileCardAuthorship(
      current,
      projectProfileSnapshot(targetSnapshot, fixture.projectAsset),
      actor,
    )

    expect(stamped.records.find((record) => record.recordId === 'card-ask')?.payload)
      .not.toHaveProperty('lastModifiedBy')
    expect(stamped.records.find((record) => record.recordId === 'card-result')?.payload)
      .not.toHaveProperty('lastModifiedBy')
  })

  it.each([
    ['latest deletion', 'card.deleted', true],
    ['legacy deletion', 'card.deleted', false],
    ['creation fallback', 'card.created', true],
  ] as const)(
    'revives a Card from its %s snapshot without trusting target authorship',
    (_case, eventType, hasHistoricalCreator) => {
      const fixture = createCompleteProfileFixture()
      const actor = {
        kind: 'user' as const,
        client: 'eido-desktop',
        sessionId: 'profile-gui-session',
      }
      const historicalCreator = {
        kind: 'agent' as const,
        client: 'codex',
        sessionId: 'historical-agent-session',
      }
      const forgedTargetActor = {
        kind: 'agent' as const,
        client: 'forged-target',
        sessionId: 'forged-target-session',
      }
      const currentSnapshot = clone(fixture.snapshot)
      const currentBoard = currentSnapshot.boards['idea-main']!
      const cardIndex = currentBoard.cards.findIndex((card) => card.id === 'card-title')
      const [historicalCard] = currentBoard.cards.splice(cardIndex, 1)
      if (hasHistoricalCreator) historicalCard!.createdBy = historicalCreator
      historicalCard!.lastModifiedBy = actor
      const event = eventType === 'card.deleted'
        ? {
            id: `event-revival-${eventType}-${hasHistoricalCreator}`,
            at: '2026-07-22T00:00:00.000Z',
            type: eventType,
            cardId: historicalCard!.id,
            data: { card: clone(historicalCard!), connections: [] },
          } satisfies IntentLogEvent
        : {
            id: `event-revival-${eventType}-${hasHistoricalCreator}`,
            at: '2026-07-22T00:00:00.000Z',
            type: eventType,
            cardId: historicalCard!.id,
            data: { card: clone(historicalCard!) },
          } satisfies IntentLogEvent
      currentBoard.intentLog ??= []
      currentBoard.intentLog.push(event)
      const targetSnapshot = clone(currentSnapshot)
      targetSnapshot.boards['idea-main']!.cards.push({
        ...historicalCard!,
        createdBy: forgedTargetActor,
        lastModifiedBy: forgedTargetActor,
      })

      const stamped = stampProfileCardAuthorship(
        projectProfileSnapshot(currentSnapshot, fixture.projectAsset),
        projectProfileSnapshot(targetSnapshot, fixture.projectAsset),
        actor,
      )
      const revived = stamped.records.find((record) => record.recordId === historicalCard!.id)?.payload

      expect(revived).toMatchObject({ lastModifiedBy: actor })
      if (hasHistoricalCreator) {
        expect(revived).toMatchObject({ createdBy: historicalCreator })
      } else {
        expect(revived).not.toHaveProperty('createdBy')
      }
    },
  )

  it('normalizes forged GUI deletion history before using it for a later revival', () => {
    const fixture = createCompleteProfileFixture()
    const actor = {
      kind: 'user' as const,
      client: 'eido-desktop',
      sessionId: 'profile-gui-session',
    }
    const historicalCreator = {
      kind: 'agent' as const,
      client: 'codex',
      sessionId: 'historical-agent-session',
    }
    const forgedActor = {
      kind: 'agent' as const,
      client: 'forged-target',
      sessionId: 'forged-target-session',
    }
    const beforeSnapshot = clone(fixture.snapshot)
    const beforeBoard = beforeSnapshot.boards['idea-main']!
    const historicalCard = beforeBoard.cards.find((card) => card.id === 'card-title')!
    historicalCard.createdBy = historicalCreator
    historicalCard.lastModifiedBy = historicalCreator
    const current = projectProfileSnapshot(beforeSnapshot, fixture.projectAsset)

    const deleteSnapshot = clone(beforeSnapshot)
    const deleteBoard = deleteSnapshot.boards['idea-main']!
    deleteBoard.cards = deleteBoard.cards.filter((card) => card.id !== historicalCard.id)
    deleteBoard.intentLog ??= []
    deleteBoard.intentLog.push({
      id: 'event-forged-card-delete',
      at: '2026-07-22T00:00:00.000Z',
      type: 'card.deleted',
      cardId: historicalCard.id,
      data: {
        card: { ...historicalCard, createdBy: forgedActor, lastModifiedBy: forgedActor },
        connections: [],
      },
    })
    const deleted = stampProfileCardAuthorship(
      current,
      projectProfileSnapshot(deleteSnapshot, fixture.projectAsset),
      actor,
    )
    const deletionEvent = deleted.records.find((record) => record.recordId === 'event-forged-card-delete')!
    const deletedCardSnapshot = (
      (deletionEvent.payload as Record<string, unknown>).data as Record<string, unknown>
    ).card
    expect(deletedCardSnapshot).toMatchObject({
      createdBy: historicalCreator,
      lastModifiedBy: actor,
    })

    const revivalSnapshot = clone(deleteSnapshot)
    const trustedDeletionEvent = (revivalSnapshot.boards['idea-main']!.intentLog ?? [])
      .find((event) => event.id === 'event-forged-card-delete')!
    if (trustedDeletionEvent.type !== 'card.deleted') throw new Error('Expected synthetic deletion event')
    trustedDeletionEvent.data.card = clone(deletedCardSnapshot) as typeof historicalCard
    revivalSnapshot.boards['idea-main']!.cards.push({
      ...historicalCard,
      createdBy: forgedActor,
      lastModifiedBy: forgedActor,
    })
    const revived = stampProfileCardAuthorship(
      deleted,
      projectProfileSnapshot(revivalSnapshot, fixture.projectAsset),
      actor,
    )

    expect(revived.records.find((record) => record.recordId === historicalCard.id)?.payload)
      .toMatchObject({ createdBy: historicalCreator, lastModifiedBy: actor })
  })

  it.each([
    ['unsourceable delete suffix', false],
    ['coalesced create then delete', true],
  ] as const)('normalizes %s snapshots to native user authorship', (_case, includeCreate) => {
    const fixture = createCompleteProfileFixture()
    const actor = {
      kind: 'user' as const,
      client: 'eido-desktop',
      sessionId: 'profile-gui-session',
    }
    const forgedActor = {
      kind: 'agent' as const,
      client: 'forged-target',
      sessionId: 'forged-target-session',
    }
    const currentSnapshot = clone(fixture.snapshot)
    const current = projectProfileSnapshot(currentSnapshot, fixture.projectAsset)
    const targetSnapshot = clone(currentSnapshot)
    const targetBoard = targetSnapshot.boards['idea-main']!
    targetBoard.intentLog ??= []
    const historicalCard = {
      ...clone(targetBoard.cards.find((card) => card.id === 'card-title')!),
      id: 'card-coalesced-history-only',
      blocks: [{ id: 'block-coalesced-history-only', text: 'History only' }],
      createdBy: forgedActor,
      lastModifiedBy: forgedActor,
    }
    const events: IntentLogEvent[] = [
      ...(includeCreate
        ? [{
            id: 'event-coalesced-create',
            at: '2026-07-22T00:00:00.000Z',
            type: 'card.created' as const,
            cardId: historicalCard.id,
            data: { card: clone(historicalCard) },
          }]
        : []),
      {
        id: 'event-coalesced-delete',
        at: '2026-07-22T00:00:01.000Z',
        type: 'card.deleted',
        cardId: historicalCard.id,
        data: { card: clone(historicalCard), connections: [] },
      },
    ]
    targetBoard.intentLog.push(...events)

    const stamped = stampProfileCardAuthorship(
      current,
      projectProfileSnapshot(targetSnapshot, fixture.projectAsset),
      actor,
    )

    for (const event of events) {
      const record = stamped.records.find((candidate) => candidate.recordId === event.id)!
      const snapshot = ((record.payload as Record<string, unknown>).data as Record<string, unknown>).card
      expect(snapshot).toMatchObject({ createdBy: actor, lastModifiedBy: actor })
    }
  })

  it('does not let a creator-free tombstone shadow older trusted creator evidence', () => {
    const fixture = createCompleteProfileFixture()
    const actor = {
      kind: 'user' as const,
      client: 'eido-desktop',
      sessionId: 'profile-gui-session',
    }
    const historicalCreator = {
      kind: 'agent' as const,
      client: 'codex',
      sessionId: 'historical-agent-session',
    }
    const currentSnapshot = clone(fixture.snapshot)
    const board = currentSnapshot.boards['idea-main']!
    const cardIndex = board.cards.findIndex((card) => card.id === 'card-title')
    const [historicalCard] = board.cards.splice(cardIndex, 1)
    historicalCard!.createdBy = historicalCreator
    historicalCard!.lastModifiedBy = actor
    const creatorFreeSnapshot = clone(historicalCard!)
    delete creatorFreeSnapshot.createdBy
    board.intentLog ??= []
    board.intentLog.push(
      {
        id: 'event-agent-delete-with-creator',
        at: '2026-07-22T00:00:00.000Z',
        type: 'card.deleted',
        cardId: historicalCard!.id,
        data: { card: clone(historicalCard!), connections: [] },
      },
      {
        id: 'event-later-delete-without-creator',
        at: '2026-07-22T00:00:01.000Z',
        type: 'card.deleted',
        cardId: historicalCard!.id,
        data: {
          card: creatorFreeSnapshot,
          connections: [],
        },
      },
    )
    const targetSnapshot = clone(currentSnapshot)
    targetSnapshot.boards['idea-main']!.cards.push(clone(historicalCard!))

    const revived = stampProfileCardAuthorship(
      projectProfileSnapshot(currentSnapshot, fixture.projectAsset),
      projectProfileSnapshot(targetSnapshot, fixture.projectAsset),
      actor,
    )

    expect(revived.records.find((record) => record.recordId === historicalCard!.id)?.payload)
      .toMatchObject({ createdBy: historicalCreator, lastModifiedBy: actor })
  })

  it('round-trips structured Card authorship while legacy Cards remain unstamped user work', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const authored = snapshot.boards['idea-main']!.cards.find((card) => card.id === 'card-note')!
    authored.createdBy = {
      kind: 'agent',
      client: 'claude-code',
      sessionId: 'session-projection-agent',
    }
    authored.lastModifiedBy = {
      kind: 'user',
      client: 'eido-desktop',
      sessionId: 'session-projection-user',
    }

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    expect(document.records.find((record) => record.recordId === authored.id)?.payload)
      .toMatchObject({
        createdBy: authored.createdBy,
        lastModifiedBy: authored.lastModifiedBy,
      })
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
    expect(hydrated.boards['idea-main']!.cards.find((card) => card.id === authored.id))
      .toEqual(authored)

    const legacy = hydrated.boards['idea-second']!.cards[0]!
    expect(legacy).not.toHaveProperty('createdBy')
    expect(legacy).not.toHaveProperty('lastModifiedBy')
    expect(effectiveCardCreatorKind(legacy)).toBe('user')
  })

  it('round-trips a local HTML preview as an opaque source plus static logical asset', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const previewAsset = {
      id: 'asset-local-html-preview',
      kind: 'image' as const,
      name: 'review.html preview.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      size: 4,
      createdAt: '2026-08-14T10:00:00.000Z',
      width: 1200,
      height: 675,
    }
    snapshot.boards['idea-main']!.cards.push({
      id: 'card-local-html-preview',
      kind: 'note',
      blocks: [{ id: 'block-local-html-preview', text: 'review.html' }],
      assets: [previewAsset],
      localHtmlPreview: {
        sourceId: 'source-opaque',
        name: 'review.html',
        status: 'ready',
        title: 'Review',
        assetId: previewAsset.id,
      },
      position: { x: 100, y: 100 },
    })
    const projectAsset = (asset: typeof previewAsset | Parameters<typeof fixture.projectAsset>[0]) => (
      asset.id === previewAsset.id
        ? toProfileLogicalAssetPayload(previewAsset, '3'.repeat(64))
        : fixture.projectAsset(asset)
    )
    const hydrateAsset = (payload: Parameters<typeof fixture.hydrateAsset>[0]) => (
      payload.id === previewAsset.id ? previewAsset : fixture.hydrateAsset(payload)
    )

    const document = projectProfileSnapshot(snapshot, projectAsset)
    expect(JSON.stringify(document)).not.toContain('/Users/')
    expect(hydrateProfileLogicalDocument(document, hydrateAsset)).toEqual(snapshot)

    const conflicting = clone(snapshot)
    const conflictingCards = conflicting.boards['idea-main']!.cards
    conflictingCards[conflictingCards.length - 1]!.linkPreview = {
      url: 'https://example.com/',
      status: 'fallback',
    }
    expect(() => projectProfileSnapshot(conflicting, projectAsset)).toThrow(/current Card/)

    const nonStatic = clone(snapshot)
    const nonStaticAsset = nonStatic.boards['idea-main']!.cards
      .find((card) => card.id === 'card-local-html-preview')!.assets![0]!
    nonStaticAsset.name = 'review.html preview.png'
    nonStaticAsset.mimeType = 'image/png'
    nonStaticAsset.dataUrl = 'data:image/png;base64,YQ=='
    expect(() => projectProfileSnapshot(nonStatic, projectAsset)).toThrow(/matching static image asset/)

    const corruptJpeg = clone(snapshot)
    const corruptAsset = corruptJpeg.boards['idea-main']!.cards
      .find((card) => card.id === 'card-local-html-preview')!.assets![0]!
    corruptAsset.dataUrl = 'data:image/jpeg;base64,YQ=='
    corruptAsset.size = 1
    expect(() => projectProfileSnapshot(corruptJpeg, projectAsset)).toThrow(/matching static image asset/)
  })

  it('validates historical local HTML preview assets without inventing blob bytes', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const previewAsset = {
      id: 'asset-deleted-local-html-preview',
      kind: 'image' as const,
      name: 'deleted.html preview.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      size: 4,
      createdAt: '2026-08-14T10:00:00.000Z',
      width: 1200,
      height: 675,
    }
    const deletedCard = {
      id: 'card-deleted-local-html-preview',
      kind: 'note' as const,
      blocks: [{ id: 'block-deleted-local-html-preview', text: 'deleted.html' }],
      assets: [previewAsset],
      localHtmlPreview: {
        sourceId: 'source-deleted-opaque',
        name: 'deleted.html',
        status: 'ready' as const,
        assetId: previewAsset.id,
      },
      position: { x: 100, y: 100 },
    }
    snapshot.boards['idea-main']!.intentLog = [{
      id: 'intent-deleted-local-html-preview',
      type: 'card.deleted',
      at: '2026-08-14T10:01:00.000Z',
      ideaId: 'idea-main',
      cardId: deletedCard.id,
      data: {
        card: deletedCard,
        connections: [],
      },
    }]
    const projectAsset = (asset: typeof previewAsset | Parameters<typeof fixture.projectAsset>[0]) => (
      asset.id === previewAsset.id
        ? toProfileLogicalAssetPayload(previewAsset, '4'.repeat(64))
        : fixture.projectAsset(asset)
    )

    const document = projectProfileSnapshot(snapshot, projectAsset)

    expect(validateProfileLogicalDocument(document)).toEqual(document)
    expect(enumerateProfileAssetDigests(document)).toContain('4'.repeat(64))
  })

  it('round-trips immutable Profile Agent events as Profile-owned logical records', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot) as typeof fixture.snapshot & {
      profileAgentEvents: unknown[]
    }
    snapshot.profileAgentEvents = [{
      kind: 'profile-agent-event',
      recordId: 'profile-agent-event-1',
      ownerId: snapshot.profileId,
      parentId: snapshot.profileId,
      recordVersion: 1,
      payload: {
        version: 1,
        id: 'profile-agent-event-1',
        seq: 1,
        at: '2026-07-20T00:00:00.000Z',
        profileId: snapshot.profileId,
        commitId: 'agent:profile-event-txn',
        actorId: 'local-agent',
        clientTxnId: 'profile-event-txn',
        type: 'mod-template.deleted',
        templateId: 'mod-template-retired',
        deletedTemplateVersion: 2,
        claimedTransitionEvidence: { version: 1, count: 0, sha256: '0'.repeat(64) },
      },
    }]

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    expect(document.records).toContainEqual(expect.objectContaining({
      kind: 'profile-agent-event',
      recordId: 'profile-agent-event-1',
      ownerId: snapshot.profileId,
      parentId: snapshot.profileId,
      ordinal: 0,
      recordVersion: 2,
    }))
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
    expect(hydrated.profileAgentEvents).toEqual([expect.objectContaining({
      recordVersion: 1,
      payload: expect.objectContaining({ version: 1 }),
    })])
    expect(hydrated).toEqual(snapshot)
  })

  it('round-trips exact research-control Intent events and rejects extended event data', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const evidence = {
      version: 1 as const,
      count: 2,
      sha256: 'a'.repeat(64),
    }
    const events = [
      {
        id: 'event-agent-model', at: '2026-08-05T00:00:00.000Z', type: 'card.content.edited',
        cardId: 'card-ask', data: { field: 'model', claimedTransitionEvidence: evidence },
      },
      {
        id: 'event-agent-identity', at: '2026-08-05T00:00:01.000Z', type: 'card.content.edited',
        cardId: 'card-note', data: { field: 'identity', claimedTransitionEvidence: evidence },
      },
      {
        id: 'event-agent-moved', at: '2026-08-05T00:00:02.000Z', type: 'card.moved',
        cardId: 'card-note',
        data: {
          moves: [{
            cardId: 'card-note', from: { x: 0, y: 0 }, to: { x: 10, y: 20 },
            previousGroupId: 'card-group',
          }],
          claimedTransitionEvidence: evidence,
        },
      },
      {
        id: 'event-agent-resized', at: '2026-08-05T00:00:03.000Z', type: 'card.resized',
        cardId: 'card-note',
        data: {
          from: { width: 260, height: 180 }, to: { width: 300, height: 200 },
          claimedTransitionEvidence: evidence,
        },
      },
      {
        id: 'event-agent-arranged', at: '2026-08-05T00:00:04.000Z', type: 'cards.arranged',
        cardId: 'card-note',
        data: {
          changes: [{
            cardId: 'card-note',
            before: {
              position: { x: 0, y: 0 }, size: { width: 260, height: 180 },
              groupId: 'card-group',
            },
            after: { position: { x: 10, y: 20 }, size: { width: 300, height: 200 } },
          }],
          claimedTransitionEvidence: evidence,
        },
      },
      {
        id: 'event-agent-layer', at: '2026-08-05T00:00:05.000Z', type: 'card.layer.changed',
        cardId: 'card-note',
        data: {
          direction: 'front',
          changes: [{ cardId: 'card-note', from: 0, to: 1 }],
          claimedTransitionEvidence: evidence,
        },
      },
      {
        id: 'event-agent-members', at: '2026-08-05T00:00:06.000Z', type: 'group.members.changed',
        cardId: 'card-group',
        data: {
          memberChanges: { 'card-note': { from: 'card-group' } },
          claimedTransitionEvidence: evidence,
        },
      },
      {
        id: 'event-agent-chosen', at: '2026-08-05T00:00:07.000Z', type: 'version.chosen',
        versionId: 'version-new',
        data: {
          outputId: 'output-agent', previousVersionId: 'version-old', nextVersionId: 'version-new',
          claimedTransitionEvidence: evidence,
        },
      },
      {
        id: 'event-agent-acceptance', at: '2026-08-05T00:00:08.000Z',
        type: 'version.acceptance.changed', versionId: 'version-new',
        data: {
          outputId: 'output-agent', from: false, to: true,
          claimedTransitionEvidence: evidence,
        },
      },
    ] satisfies IntentLogEvent[]
    const board = snapshot.boards['idea-main']!
    board.intentLog = [...(board.intentLog ?? []), ...events]

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)

    expect(hydrated.boards['idea-main']!.intentLog?.slice(-events.length)).toEqual(events)

    const extended = mutableDocument(document)
    const arranged = extended.records.find((record) => record.recordId === 'event-agent-arranged')!
    ;((arranged.payload as Record<string, unknown>).data as Record<string, unknown>).unexpected = true
    expect(() => hydrateProfileLogicalDocument(extended, fixture.hydrateAsset))
      .toThrow(/Intent event payload/)

    const extendedModel = mutableDocument(document)
    const model = extendedModel.records.find((record) => record.recordId === 'event-agent-model')!
    ;((model.payload as Record<string, unknown>).data as Record<string, unknown>).textLength = 7
    expect(() => hydrateProfileLogicalDocument(extendedModel, fixture.hydrateAsset))
      .toThrow(/Intent event payload/)
  })

  it.each([
    ['duplicate', [7, 7]],
    ['non-monotonic', [7, 6]],
  ] as const)(
    'rejects %s Profile Agent event sequences at projection and hydration',
    (_case, sequences) => {
      const fixture = createCompleteProfileFixture()
      const invalidSnapshot = clone(fixture.snapshot)
      invalidSnapshot.profileAgentEvents = profileAgentEventsWithSequences(
        invalidSnapshot.profileId,
        sequences,
      )

      expect(() => projectProfileSnapshot(invalidSnapshot, fixture.projectAsset))
        .toThrow(/strictly increasing/)

      const validSnapshot = clone(fixture.snapshot)
      validSnapshot.profileAgentEvents = profileAgentEventsWithSequences(
        validSnapshot.profileId,
        [7, 8],
      )
      const invalidDocument = mutableDocument(
        projectProfileSnapshot(validSnapshot, fixture.projectAsset),
      )
      const events = invalidDocument.records.filter((record) => (
        record.kind === 'profile-agent-event'
      ))
      ;(events[1]!.payload as { seq: number }).seq = sequences[1]

      expect(() => hydrateProfileLogicalDocument(invalidDocument, fixture.hydrateAsset))
        .toThrow(/strictly increasing/)
    },
  )

  it('round-trips every owned logical class without storing asset bytes or losing empty containers', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    expect(document.records.every((record) => record.recordVersion === 2)).toBe(true)
    expect(document.records.find((record) => record.recordId === 'card-mod')?.payload)
      .not.toHaveProperty('modV2')
    expect(document.records.find((record) => record.recordId === 'mod-stamp-1')).toMatchObject({
      kind: 'mod-instance',
      parentId: 'card-mod',
      recordVersion: 2,
    })

    expect(new Set(document.records.map((record) => record.kind))).toEqual(new Set([
      'profile',
      'compatibility-state',
      'idea',
      'board',
      'card',
      'block',
      'logical-asset',
      'mod-template',
      'mod-instance',
      'connection',
      'output',
      'output-version',
      'transcript-message',
      'follow-up-message',
      'run',
      'intent-event',
      'board-settings',
      'highlight',
      'highlight-tag',
      'compaction-summary',
      'profile-setting',
      'migration-ledger-entry',
    ]))
    expect(document.records.find((record) => record.kind === 'board')?.payload).toEqual({
      version: 1,
      updatedAt: SYNTHETIC_MAIN_BOARD.updatedAt,
    })
    expect(document.records.find((record) => (
      record.kind === 'output-version' && record.recordId === 'version-empty-containers'
    ))?.payload).toMatchObject({
      transcript: { present: true },
      followUpThread: { present: true, collapsed: true },
    })

    const storedJson = JSON.stringify(document)
    expect(storedJson).not.toContain('data:image/png;base64,')
    expect(storedJson).not.toContain('dataUrl')
    expect(enumerateProfileAssetDigests(document)).toEqual([
      CURRENT_ASSET_DIGEST,
      HISTORICAL_ASSET_DIGEST,
    ])
    expect(enumerateProfileLogicalAssetIds(document.records)).toEqual([
      'asset-note-image',
      'asset-retired-image',
    ])

    expect(hydrateProfileLogicalDocument(document, fixture.hydrateAsset)).toEqual(fixture.snapshot)
  })

  it('rejects hostile or unsupported logical documents before executable data can run', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    const unsupported = mutableDocument(document)
    ;(unsupported.records[0] as unknown as { recordVersion: number }).recordVersion = 3
    expect(() => hydrateProfileLogicalDocument(unsupported, fixture.hydrateAsset)).toThrow(/version is unsupported/)

    const sparse = mutableDocument(document)
    delete sparse.records[1]
    expect(() => hydrateProfileLogicalDocument(sparse, fixture.hydrateAsset)).toThrow(/sparse or extended array/)

    const lossyNumber = mutableDocument(document)
    lossyNumber.records.find((record) => record.kind === 'highlight')!.ordinal = -0
    expect(() => hydrateProfileLogicalDocument(lossyNumber, fixture.hydrateAsset)).toThrow(/lossy JSON number/)

    const accessor = mutableDocument(document)
    const profilePayload = accessor.records[0]!.payload as Record<string, unknown>
    let getterReads = 0
    Object.defineProperty(profilePayload, 'profileId', {
      enumerable: true,
      configurable: true,
      get() {
        getterReads += 1
        return 'profile-synthetic'
      },
    })
    expect(() => hydrateProfileLogicalDocument(accessor, fixture.hydrateAsset)).toThrow(/not inert JSON data/)
    expect(getterReads).toBe(0)

    const malformedIntent = mutableDocument(document)
    const runEvent = malformedIntent.records.find((record) => record.recordId === 'event-run-completed')!
    ;(runEvent.payload as Record<string, unknown>).data = {}
    expect(() => hydrateProfileLogicalDocument(malformedIntent, fixture.hydrateAsset)).toThrow(/Intent event payload/)

    const malformedCard = mutableDocument(document)
    ;(malformedCard.records.find((record) => record.recordId === 'card-note')!.payload as Record<string, unknown>)
      .title = 42
    expect(() => hydrateProfileLogicalDocument(malformedCard, fixture.hydrateAsset)).toThrow(/current Card/)

    const malformedHistoricalBlock = mutableDocument(document)
    const historicalEvent = malformedHistoricalBlock.records.find((record) => record.recordId === 'event-retired-asset')!
    const historicalCard = ((historicalEvent.payload as Record<string, unknown>).data as Record<string, unknown>)
      .card as Record<string, unknown>
    ;(historicalCard.blocks as Array<Record<string, unknown>>)[0]!.text = 42
    expect(() => hydrateProfileLogicalDocument(malformedHistoricalBlock, fixture.hydrateAsset)).toThrow(/current Block/)

    const malformedRun = mutableDocument(document)
    ;(malformedRun.records.find((record) => record.kind === 'run')!.payload as Record<string, unknown>)
      .usedCardIds = [42]
    expect(() => hydrateProfileLogicalDocument(malformedRun, fixture.hydrateAsset)).toThrow(/current Run/)

    const legacyCardMod = clone(fixture.snapshot)
    ;(legacyCardMod.boards['idea-main']!.cards[0] as unknown as Record<string, unknown>).mod = {
      id: 'legacy-mod',
      label: 'Legacy',
      controls: [],
    }
    expect(() => projectProfileSnapshot(legacyCardMod, fixture.projectAsset))
      .toThrow(/retired legacy Mod payload/)
  })

  it('fails closed on ownership, ordering, global identity, consumption, and hard-reference breaks', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    const duplicateOrdinal = mutableDocument(document)
    const connections = duplicateOrdinal.records.filter((record) => record.kind === 'connection')
    connections[1]!.ordinal = connections[0]!.ordinal
    expect(() => hydrateProfileLogicalDocument(duplicateOrdinal, fixture.hydrateAsset)).toThrow(/ordinals are duplicated/)

    const wrongOwner = mutableDocument(document)
    wrongOwner.records.find((record) => record.kind === 'highlight')!.ownerId = 'board:idea-second'
    expect(() => hydrateProfileLogicalDocument(wrongOwner, fixture.hydrateAsset)).toThrow(/invalid Board containment/)

    const unconsumed = mutableDocument(document)
    unconsumed.records.push({
      recordId: 'profile-setting-unowned',
      kind: 'profile-setting',
      ownerId: 'profile-other',
      parentId: 'profile-other',
      ordinal: 0,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      payload: {
        id: 'profile-setting-unowned',
        recordVersion: 1,
        classification: 'portable-profile',
        value: null,
      },
    })
    expect(() => hydrateProfileLogicalDocument(unconsumed, fixture.hydrateAsset)).toThrow(/unconsumed record/)

    const duplicateId = clone(fixture.snapshot)
    duplicateId.profileSettings[0]!.id = 'card-note'
    expect(() => projectProfileSnapshot(duplicateId, fixture.projectAsset)).toThrow(/globally unique/)

    const danglingEndpoint = clone(fixture.snapshot)
    danglingEndpoint.boards['idea-main']!.connections[0]!.from.cardId = 'card-missing'
    expect(() => projectProfileSnapshot(danglingEndpoint, fixture.projectAsset)).toThrow(/dangling Card endpoint/)

    const danglingGroup = clone(fixture.snapshot)
    danglingGroup.boards['idea-main']!.cards.find((card) => card.id === 'card-note')!.groupId = 'card-missing-group'
    expect(() => projectProfileSnapshot(danglingGroup, fixture.projectAsset)).toThrow(/dangling group/)

    const mismatchedMod = clone(fixture.snapshot)
    mismatchedMod.boards['idea-main']!.cards.find((card) => card.id === 'card-mod')!.modV2!.title = 'CHANGED ONLY ON CARD'
    expect(() => projectProfileSnapshot(mismatchedMod, fixture.projectAsset)).toThrow(/does not match its Mod instance/)
  })

  it('round-trips retired historical and provenance references without treating them as corruption', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const board = snapshot.boards['idea-main']!
    snapshot.modTemplates = []
    board.connections[0]!.from.blockId = 'block-retired-anchor'
    board.runs[0]!.askAiCardId = 'card-retired-run-origin'
    board.runs[0]!.usedCardIds = ['card-retired-source']
    board.runs[0]!.usedConnectionIds = ['connection-retired-source']
    board.runs[0]!.producedVersionId = 'version-retired-produced'
    board.outputs[0]!.versions[0]!.fromRunId = 'run-retired-version-source'
    board.outputs[0]!.versions[0]!.sourceContext!.sources[0]!.cardId = 'card-retired-context-source'
    board.outputs[1]!.versions[0]!.transcript![0]!.participantCardId = 'card-retired-participant'
    board.compactionSummaries![0]!.cardId = 'card-retired-compaction-source'

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    expect(hydrateProfileLogicalDocument(document, fixture.hydrateAsset)).toEqual(snapshot)
  })

  it('round-trips v2 run provenance while retaining the legacy AppliedMod arm', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const board = snapshot.boards['idea-main']!
    const run = board.runs[0]!
    const mod = board.cards.find((card) => card.id === 'card-mod')?.modV2
    if (!mod) throw new Error('Synthetic v2 Mod is missing')
    run.provider = 'claude-code'
    run.appliedMods = [{
      modVersion: 2,
      modCardId: 'card-mod',
      controlValues: snapshotModValues(mod),
      appliedInstructions: ['Keep the v2 provenance exact.'],
    }]

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    expect(hydrateProfileLogicalDocument(document, fixture.hydrateAsset)).toEqual(snapshot)

    const malformed = clone(snapshot)
    const applied = malformed.boards['idea-main']!.runs[0]!.appliedMods[0]!
    if (applied.modVersion !== 2) throw new Error('Expected v2 AppliedMod')
    ;(applied.controlValues as unknown as { schema: string }).schema = 'future-mod'
    expect(() => projectProfileSnapshot(malformed, fixture.projectAsset)).toThrow(/current Run/)

    const invalidProvider = clone(snapshot)
    ;(invalidProvider.boards['idea-main']!.runs[0]! as unknown as { provider: string }).provider = 'browser-chat'
    expect(() => projectProfileSnapshot(invalidProvider, fixture.projectAsset)).toThrow(/current Run/)
  })

  it('round-trips only bounded route and policy phases for AI access provenance', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    snapshot.boards['idea-main']!.runs[0]!.aiAccessPhases = [{
      routeClass: 'hosted-free',
      policyRevision: 'hosted-free-v1',
    }]

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)

    expect(hydrated.boards['idea-main']!.runs[0]!.aiAccessPhases).toEqual([{
      routeClass: 'hosted-free',
      policyRevision: 'hosted-free-v1',
    }])
    expect(JSON.stringify(hydrated.boards['idea-main']!.runs[0]!.aiAccessPhases)).not.toMatch(
      /account|credential|operation|quota|reservation/i,
    )
  })
})

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function profileAgentEventsWithSequences(
  profileId: string,
  sequences: readonly [number, number],
) {
  const fixture = createProfileAgentEventFixture(profileId)
  const secondId = 'profile-agent-event-second'
  return [{
    ...fixture,
    payload: { ...fixture.payload, seq: sequences[0] },
  }, {
    ...fixture,
    recordId: secondId,
    payload: {
      ...fixture.payload,
      id: secondId,
      seq: sequences[1],
      commitId: 'agent:second-event',
      clientTxnId: 'second-event',
    },
  }]
}

type MutableLogicalRecord = {
  -readonly [Key in keyof ProfileLogicalRecordSpec]: ProfileLogicalRecordSpec[Key]
}

function mutableDocument(document: ProfileLogicalDocument): {
  head: ProfileLogicalDocument['head']
  records: MutableLogicalRecord[]
} {
  return clone(document) as unknown as {
    head: ProfileLogicalDocument['head']
    records: MutableLogicalRecord[]
  }
}
