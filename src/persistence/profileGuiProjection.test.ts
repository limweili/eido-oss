import { describe, expect, it } from 'vitest'
import type { IntentLogEvent, SavedBoard } from '../graph/types'
import { createSeedMod, remapModPartIdentities } from '../mods'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import {
  createDirectProfileModInstance,
  createUserProfileModTemplate,
  stampProfileModTemplate,
  updateProfileModTemplate,
} from './profileModRecords'
import {
  mergeGuiProfileProjection,
  ProfileGuiProjectionError,
  profileGuiProjectionFailure,
  type GuiNewModOrigin,
  type GuiNewModMaterialization,
  type GuiOrdinaryNewIdeaAuthorization,
  type GuiProfileProjection,
  type GuiProfileProjectionRequest,
  type ProfileGuiProjectionDependencies,
} from './profileGuiProjection'
import { PROFILE_CONTRACT_VERSIONS, type ProfileSnapshot } from './profileServiceContract'

describe('GUI-owned Profile projection (#595)', () => {
  it('merges the bounded active Board while preserving omitted and native-owned state', () => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    base.recoveryPoints = [{
      id: 'recovery-point-synthetic',
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      revision: base.revision - 1,
      verified: true,
      createdAt: '2026-07-18T00:00:00.000Z',
    }]
    base.profileAgentEvents = [profileAgentEvent()]
    const originalInactive = clone(base.boards['idea-second']!)
    const originalNative = {
      compatibility: clone(base.compatibility),
      migrationLedger: clone(base.migrationLedger),
      recoveryPoints: clone(base.recoveryPoints),
      profileAgentEvents: clone(base.profileAgentEvents),
    }
    const replacement = clone(base.boards['idea-main']!)
    replacement.updatedAt = '2026-07-19T00:00:01.000Z'
    const existingMod = replacement.cards.find((card) => card.id === 'card-mod')!.modV2!
    if (existingMod.kind !== 'slider') throw new Error('Synthetic fixture Mod must be a slider')
    existingMod.state.items[0]!.v = 7
    replacement.cards.push(newDirectModCard())
    const sourceTemplate = base.modTemplates.find(
      (template) => template.payload.provenance.kind === 'user',
    )!
    const stamped = newStampedModCard(sourceTemplate)
    replacement.cards.push(stamped.card)
    replacement.intentLog = [
      ...(replacement.intentLog ?? []),
      appendedIntent('idea-main'),
    ]
    const request = projectionRequest(base, {
      ideas: base.ideas.map((idea) => idea.id === 'idea-main'
        ? { ...idea, name: 'Renamed through the GUI' }
        : idea),
      boardReplacements: { 'idea-main': replacement },
      newModOrigins: {
        'card-new-direct-mod': { kind: 'direct', instanceId: 'mod-new-direct' },
        'card-new-stamped-mod': stamped.origin,
      },
      userModTemplates: base.modTemplates
        .filter((template) => template.payload.provenance.kind === 'user')
        .map((template) => ({
          templateId: template.recordId,
          mod: { ...clone(template.payload.mod), title: 'OWNER-RECONCILED TEMPLATE' },
        })),
    })

    const merged = mergeGuiProfileProjection(base, request, projectionDependencies(fixture))

    expect(merged.snapshot.revision).toBe(base.revision + 1)
    expect(merged.snapshot.ideas[0]?.name).toBe('Renamed through the GUI')
    expect(merged.snapshot.boards['idea-main']).toEqual(replacement)
    expect(merged.snapshot.boards['idea-second']).toEqual(originalInactive)
    expect({
      compatibility: merged.snapshot.compatibility,
      migrationLedger: merged.snapshot.migrationLedger,
      recoveryPoints: merged.snapshot.recoveryPoints,
      profileAgentEvents: merged.snapshot.profileAgentEvents,
    }).toEqual(originalNative)
    const previousStamped = base.modInstances.find((instance) => instance.recordId === 'mod-stamp-1')!
    const mergedStamped = merged.snapshot.modInstances.find((instance) => instance.recordId === 'mod-stamp-1')!
    expect({ ...mergedStamped, payload: undefined }).toEqual({ ...previousStamped, payload: undefined })
    expect(mergedStamped.payload.source).toEqual(previousStamped.payload.source)
    expect(mergedStamped.payload.mod).toEqual(
      replacement.cards.find((card) => card.id === 'card-mod')!.modV2,
    )
    expect(merged.snapshot.modInstances.find((instance) => instance.recordId === 'mod-new-direct'))
      .toMatchObject({
        ownerId: 'board:idea-main',
        parentId: 'card-new-direct-mod',
        payload: { source: { kind: 'direct' }, createdAt: '2026-07-19T00:00:01.000Z' },
      })
    expect(merged.snapshot.modInstances.find((instance) => instance.recordId === 'mod-new-stamped'))
      .toMatchObject({
        payload: {
          source: {
            kind: 'template',
            templateId: sourceTemplate.recordId,
            templateVersion: sourceTemplate.payload.templateVersion,
          },
        },
      })
    const previousTemplate = base.modTemplates.find((template) => template.payload.provenance.kind === 'user')!
    const mergedTemplate = merged.snapshot.modTemplates.find((template) => template.recordId === previousTemplate.recordId)!
    expect(mergedTemplate.payload).toMatchObject({
      templateVersion: previousTemplate.payload.templateVersion + 1,
      provenance: previousTemplate.payload.provenance,
      createdAt: previousTemplate.payload.createdAt,
      updatedAt: '2026-07-19T00:00:01.000Z',
      mod: { title: 'OWNER-RECONCILED TEMPLATE' },
    })
    expect(merged.logicalDocument.head.revision).toBe(base.revision + 1)
  })

  it('deletes an omitted Idea and its complete Board-owned Mod closure', () => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    const secondIdea = base.ideas.find((idea) => idea.id === 'idea-second')!
    const newIdea = ordinaryNewIdea()
    const newBoard = ordinaryNewBoard()
    const authorization = ordinaryAuthorization(base)
    const request = projectionRequest(base, {
      activeIdeaId: secondIdea.id,
      ideas: [secondIdea, newIdea],
      boardReplacements: { [newIdea.id]: newBoard },
    }, [authorization])

    const merged = mergeGuiProfileProjection(
      base,
      request,
      projectionDependencies(fixture),
    )

    expect(merged.snapshot.ideas).toEqual([secondIdea, newIdea])
    expect(Object.keys(merged.snapshot.boards)).toEqual(['idea-second', 'idea-ordinary-new'])
    expect(merged.snapshot.boards['idea-second']).toEqual(base.boards['idea-second'])
    expect(merged.snapshot.boards['idea-ordinary-new']).toEqual(newBoard)
    expect(merged.snapshot.modInstances).toEqual([])
    expect(merged.logicalDocument.records.some((record) => record.ownerId === 'board:idea-main')).toBe(false)
  })

  it('retains owner-derived Card authorship when the renderer appends after an acknowledged save', () => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    const ownerActor = {
      kind: 'user' as const,
      client: 'eido-desktop',
      sessionId: 'eido-desktop-gui:1',
    }
    const previousEvent = base.boards['idea-main']!.intentLog!.find(
      (event) => event.type === 'card.deleted',
    )
    if (previousEvent?.type !== 'card.deleted') {
      throw new Error('Synthetic fixture must contain a historical Card deletion')
    }
    previousEvent.data.card.createdBy = ownerActor
    previousEvent.data.card.lastModifiedBy = ownerActor

    const replacement = clone(base.boards['idea-main']!)
    const rendererEvent = replacement.intentLog!.find(
      (event) => event.id === previousEvent.id,
    )
    if (rendererEvent?.type !== 'card.deleted') {
      throw new Error('Renderer fixture must retain the historical Card deletion')
    }
    delete rendererEvent.data.card.createdBy
    delete rendererEvent.data.card.lastModifiedBy
    replacement.intentLog!.push(appendedIntent('idea-main'))

    const merged = mergeGuiProfileProjection(base, projectionRequest(base, {
      boardReplacements: { 'idea-main': replacement },
    }), projectionDependencies(fixture))

    expect(merged.snapshot.boards['idea-main']!.intentLog).toEqual([
      ...base.boards['idea-main']!.intentLog!,
      appendedIntent('idea-main'),
    ])
  })

  it('rejects an unbounded create, Intent rewrite, and excluded device or session state', () => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    const newIdea = {
      ...base.ideas[0]!,
      id: 'idea-new',
      name: 'New idea',
    }
    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        ideas: [...base.ideas, newIdea],
      }), projectionDependencies(fixture)),
      'invalid',
      /new Idea idea-new requires a Board replacement/,
    )
    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        ideas: [...base.ideas, ordinaryNewIdea()],
        boardReplacements: { 'idea-ordinary-new': ordinaryNewBoard() },
      }), projectionDependencies(fixture)),
      'invalid',
      /lacks matching ordinary-create authorization/,
    )
    expectProjectionError(
      () => mergeGuiProfileProjection(
        base,
        projectionRequest(base, {}, [ordinaryAuthorization(base)]),
        projectionDependencies(fixture),
      ),
      'invalid',
      /authorization was not consumed exactly once/,
    )
    expectProjectionError(
      () => mergeGuiProfileProjection(
        base,
        projectionRequest(base, {
          ideas: [...base.ideas, ordinaryNewIdea()],
          boardReplacements: { 'idea-ordinary-new': ordinaryNewBoard() },
        }, [ordinaryAuthorization(base, { baseRevision: base.revision - 1 })]),
        projectionDependencies(fixture),
      ),
      'invalid',
      /authorization is invalid or duplicated/,
    )
    expectProjectionError(
      () => mergeGuiProfileProjection(
        base,
        projectionRequest(base, {
          ideas: [...base.ideas, ordinaryNewIdea()],
          boardReplacements: { 'idea-ordinary-new': ordinaryNewBoard() },
        }, [ordinaryAuthorization(base, { expiresAt: '2026-07-19T00:00:00.000Z' })]),
        projectionDependencies(fixture),
      ),
      'invalid',
      /authorization is invalid or duplicated/,
    )
    expectProjectionError(
      () => mergeGuiProfileProjection(
        base,
        projectionRequest(base, {
          ideas: [...base.ideas, ordinaryNewIdea()],
          boardReplacements: { 'idea-ordinary-new': ordinaryNewBoard() },
        }, [ordinaryAuthorization(base, { expiresAt: '2026-07-19T00:00:01.000Z' })]),
        projectionDependencies(fixture),
      ),
      'invalid',
      /authorization is invalid or duplicated/,
    )
    const replayedAuthorization = ordinaryAuthorization(base)
    expectProjectionError(
      () => mergeGuiProfileProjection(
        base,
        projectionRequest(base, {
          ideas: [...base.ideas, ordinaryNewIdea()],
          boardReplacements: { 'idea-ordinary-new': ordinaryNewBoard() },
        }, [replayedAuthorization, replayedAuthorization]),
        projectionDependencies(fixture),
      ),
      'invalid',
      /authorization is invalid or duplicated/,
    )

    const rewritten = clone(base.boards['idea-main']!)
    rewritten.intentLog![0] = { ...rewritten.intentLog![0]!, at: '2026-07-19T00:00:02.000Z' }
    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        boardReplacements: { 'idea-main': rewritten },
      }), projectionDependencies(fixture)),
      'invalid',
      /exact append-only Intent prefix/,
    )

    const withSecret = projectionRequest(base, {
      profileSettings: unsafeProfileSettings([{
        id: 'profile-setting-locale',
        recordVersion: 1,
        classification: 'portable-profile',
        value: { locale: 'en-AU', apiKey: 'must-not-cross-the-seam' },
      }]),
    })
    expectProjectionError(
      () => mergeGuiProfileProjection(base, withSecret, projectionDependencies(fixture)),
      'invalid',
      /not an admitted portable setting/,
    )
    const secretBySettingId = projectionRequest(base, {
      profileSettings: unsafeProfileSettings([{
        id: 'profile-setting-locale',
        recordVersion: 1,
        classification: 'portable-profile',
        value: 'must-not-cross-the-seam',
      }]),
    })
    expectProjectionError(
      () => mergeGuiProfileProjection(base, secretBySettingId, projectionDependencies(fixture)),
      'invalid',
      /not an admitted portable setting/,
    )
    const withDevicePath = projectionRequest(base, {
      profileSettings: unsafeProfileSettings([{
        id: 'profile-setting-locale',
        recordVersion: 1,
        classification: 'portable-profile',
        value: { locale: 'en-AU', dataFile: 'C:\\private\\profile.sqlite' },
      }]),
    })
    expectProjectionError(
      () => mergeGuiProfileProjection(base, withDevicePath, projectionDependencies(fixture)),
      'invalid',
      /not an admitted portable setting/,
    )

    // A setting whose id this build has never heard of is NOT a leak and NOT
    // corruption: it is a preference another build owns. The row's container
    // still has to be a well-formed Profile setting record, but nothing here
    // inspects what it means, so it crosses the seam and lands on disk intact
    // (ADR 0040). Refusing it is how one unread setting would take a whole
    // Profile offline on every save.
    const foreignSetting = {
      id: 'profile-setting-from-a-newer-build',
      recordVersion: 1,
      classification: 'portable-profile',
      value: { theme: 'aurora', density: 3 },
    }
    const withForeignSetting = projectionRequest(base, {
      profileSettings: unsafeProfileSettings([
        { id: 'profile-setting-locale', recordVersion: 1, classification: 'portable-profile', value: { locale: 'en-AU' } },
        foreignSetting,
      ]),
    })
    const merged = mergeGuiProfileProjection(base, withForeignSetting, projectionDependencies(fixture))
    expect(merged.snapshot.profileSettings[1]).toEqual(foreignSetting)

    // The container still fails closed: a row that is not a well-formed
    // Profile setting record is corruption, whatever its id.
    const brokenForeignSetting = projectionRequest(base, {
      profileSettings: unsafeProfileSettings([{
        id: 'profile-setting-from-a-newer-build',
        recordVersion: 99,
        classification: 'portable-profile',
        value: { theme: 'aurora' },
      }]),
    })
    expectProjectionError(
      () => mergeGuiProfileProjection(base, brokenForeignSetting, projectionDependencies(fixture)),
      'invalid',
      /not an admitted portable setting/,
    )

    const sessionRequest = projectionRequest(base)
    const withSession = {
      ...sessionRequest,
      projection: { ...sessionRequest.projection, session: { selection: 'card-note' } },
    }
    expectProjectionError(
      () => mergeGuiProfileProjection(base, withSession, projectionDependencies(fixture)),
      'invalid',
      /exact GUI projection envelope/,
    )

    const newModBoard = clone(base.boards['idea-main']!)
    newModBoard.cards.push(newDirectModCard())
    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        boardReplacements: { 'idea-main': newModBoard },
      }), projectionDependencies(fixture)),
      'invalid',
        /new Mod Card card-new-direct-mod is missing its origin/,
    )
    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        newModOrigins: { unused: { kind: 'direct', instanceId: 'mod-unused' } },
      }), projectionDependencies(fixture)),
      'invalid',
      /unused or conflicting new Mod origin/,
    )

  })

  it('keys new origins by Card identity and verifies the complete canonical stamp map', () => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    const sourceTemplate = base.modTemplates.find(
      (template) => template.payload.provenance.kind === 'user',
    )!
    const stamped = newStampedModCard(sourceTemplate)
    const board = clone(base.boards['idea-main']!)
    board.updatedAt = '2026-07-19T00:00:01.000Z'
    board.cards.push(stamped.card)

    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        boardReplacements: { 'idea-main': board },
        // An instance-record identity is not the GUI origin-map key.
        newModOrigins: { 'mod-new-stamped': stamped.origin },
      }), projectionDependencies(fixture)),
      'invalid',
      /Mod Card card-new-stamped-mod is missing its origin/,
    )

    if (stamped.origin.kind !== 'stamped') throw new Error('Synthetic origin must be stamped')
    const wrongRoot: GuiNewModOrigin = {
      ...stamped.origin,
      sourceToInstanceIdMap: {
        ...stamped.origin.sourceToInstanceIdMap,
        mod: {
          ...stamped.origin.sourceToInstanceIdMap.mod,
          sourceId: 'nested-id-is-not-the-template-record-id',
        },
      },
    }
    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        boardReplacements: { 'idea-main': board },
        newModOrigins: { 'card-new-stamped-mod': wrongRoot },
      }), projectionDependencies(fixture)),
      'invalid',
      /cannot verify its stamped template origin/,
    )

    const wrongOrder: GuiNewModOrigin = {
      ...stamped.origin,
      sourceToInstanceIdMap: {
        ...stamped.origin.sourceToInstanceIdMap,
        controls: [...stamped.origin.sourceToInstanceIdMap.controls].reverse(),
      },
    }
    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        boardReplacements: { 'idea-main': board },
        newModOrigins: { 'card-new-stamped-mod': wrongOrder },
      }), projectionDependencies(fixture)),
      'invalid',
      /cannot verify its stamped template origin/,
    )
  })

  it('preserves exact trusted Intent attribution across sequential GUI commits', () => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    const prefix = clone(base.boards['idea-main']!.intentLog ?? [])
    const firstBoard = clone(base.boards['idea-main']!)
    firstBoard.intentLog = [...prefix, appendedIntent('idea-main')]

    const first = mergeGuiProfileProjection(base, projectionRequest(base, {
      boardReplacements: { 'idea-main': firstBoard },
    }), projectionDependencies(fixture))
    const firstPersisted = first.snapshot.boards['idea-main']!.intentLog!
    const secondBoard = clone(first.snapshot.boards['idea-main']!)
    secondBoard.updatedAt = '2026-07-19T00:00:02.000Z'
    secondBoard.intentLog = [...firstPersisted, {
      ...appendedIntent('idea-main'),
      id: 'event-gui-appended-second',
      at: '2026-07-19T00:00:02.000Z',
      commitId: 'commit-gui-appended-second',
      clientTxnId: 'client-txn-gui-2',
      seq: 5,
    }]
    const second = mergeGuiProfileProjection(first.snapshot, projectionRequest(first.snapshot, {
      boardReplacements: { 'idea-main': secondBoard },
    }), projectionDependencies(fixture))

    expect(firstPersisted.slice(0, prefix.length)).toEqual(prefix)
    expect(second.snapshot.boards['idea-main']!.intentLog).toEqual(secondBoard.intentLog)
  })

  it('rejects missing or mismatched trusted attribution on an Intent suffix', () => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    const prefix = clone(base.boards['idea-main']!.intentLog ?? [])
    const mismatched = clone(base.boards['idea-main']!)
    mismatched.intentLog = [...prefix, {
      ...appendedIntent('idea-main'),
      actorId: 'renderer-chosen-actor',
    }]
    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        boardReplacements: { 'idea-main': mismatched },
      }), projectionDependencies(fixture)),
      'invalid',
      /without trusted actor attribution/,
    )

    const missing = clone(base.boards['idea-main']!)
    const missingActor = { ...appendedIntent('idea-main') } as Partial<IntentLogEvent>
    delete missingActor.actorId
    missing.intentLog = [...prefix, missingActor as IntentLogEvent]
    expectProjectionError(
      () => mergeGuiProfileProjection(base, projectionRequest(base, {
        boardReplacements: { 'idea-main': missing },
      }), projectionDependencies(fixture)),
      'invalid',
      /without trusted actor attribution/,
    )
  })

  it.each([
    ['whitespace', '   '],
    ['multibyte byte overflow', 'é'.repeat(257)],
  ])('rejects a %s trusted actor before native projection merge', (_case, trustedActorId) => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    const request = projectionRequest(base)

    expectProjectionError(
      () => mergeGuiProfileProjection(base, {
        ...request,
        context: { ...request.context, trustedActorId },
      }, projectionDependencies(fixture)),
      'invalid',
      /exact GUI projection envelope|Trusted GUI actor identity is missing/,
    )
  })

  it('translates nested logical validation into the closed GUI projection failure contract', () => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    const invalidBoard = clone(base.boards['idea-main']!)
    ;(invalidBoard.cards[0] as unknown as { kind: string }).kind = 'future-card-kind'
    let caught: unknown

    try {
      mergeGuiProfileProjection(
        base,
        projectionRequest(base, { boardReplacements: { 'idea-main': invalidBoard } }),
        projectionDependencies(fixture),
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ProfileGuiProjectionError)
    expect(caught).toMatchObject({ code: 'invalid' })
    expect((caught as Error).message).toMatch(/logical Profile contract/)
    expect(profileGuiProjectionFailure(caught)).toMatchObject({
      ok: false,
      code: 'invalid',
      retryable: false,
    })
  })

  it('fails closed on deeply nested unknown input without recursive stack exhaustion', () => {
    const fixture = createCompleteProfileFixture()
    const base = clone(fixture.snapshot)
    const deepUnknown: Record<string, unknown> = {}
    let cursor = deepUnknown
    for (let depth = 0; depth < 100; depth += 1) {
      const child: Record<string, unknown> = {}
      cursor.child = child
      cursor = child
    }
    const request = projectionRequest(base)
    const candidate = {
      ...request,
      projection: { ...request.projection, unknown: deepUnknown },
    }

    expectProjectionError(
      () => mergeGuiProfileProjection(base, candidate, projectionDependencies(fixture)),
      'invalid',
      /capture depth/,
    )
  })
})

function projectionRequest(
  snapshot: ProfileSnapshot,
  overrides: Partial<GuiProfileProjection> = {},
  ordinaryNewIdeas: readonly GuiOrdinaryNewIdeaAuthorization[] = [],
): GuiProfileProjectionRequest {
  return {
    generation: 1,
    expectedRevision: snapshot.revision,
    clientTxnId: 'client-txn-gui-1',
    idempotencyKey: 'idempotency-gui-1',
    committedAt: '2026-07-19T00:00:01.000Z',
    context: {
      trustedActorId: 'actor-trusted-owner',
      ordinaryNewIdeas,
    },
    projection: {
      projectionVersion: 2,
      profileId: snapshot.profileId,
      activeIdeaId: snapshot.activeIdeaId,
      ideas: clone(snapshot.ideas),
      boardReplacements: {},
      userModTemplates: clone(snapshot.modTemplates
        .filter((template) => template.payload.provenance.kind === 'user')
        .map((template) => ({
          templateId: template.recordId,
          mod: template.payload.mod,
        }))),
      profileSettings: clone(snapshot.profileSettings) as unknown as GuiProfileProjection['profileSettings'],
      newModOrigins: {},
      ...overrides,
    },
  }
}

function newDirectModCard(): SavedBoard['cards'][number] {
  return {
    id: 'card-new-direct-mod',
    kind: 'mod',
    position: { x: 640, y: 320 },
    blocks: [{ id: 'block-new-direct-mod', kind: 'line', text: 'New direct Mod' }],
    modV2: createSeedMod('switch', {
      title: 'NEW DIRECT MOD',
      createId: (role, ordinal) => `control-new-direct-${role}-${ordinal}`,
    }),
  }
}

function profileAgentEvent(): NonNullable<ProfileSnapshot['profileAgentEvents']>[number] {
  return {
    kind: 'profile-agent-event',
    recordId: 'profile-agent-event-gui-preserved',
    ownerId: 'profile-synthetic',
    parentId: 'profile-synthetic',
    recordVersion: 1,
    payload: {
      version: 1,
      id: 'profile-agent-event-gui-preserved',
      seq: 1,
      at: '2026-07-19T00:00:00.000Z',
      profileId: 'profile-synthetic',
      commitId: 'agent:gui-preserved',
      actorId: 'local-agent',
      clientTxnId: 'gui-preserved',
      type: 'mod-template.deleted',
      templateId: 'mod-template-retired',
      deletedTemplateVersion: 1,
      claimedTransitionEvidence: { version: 1, count: 0, sha256: '0'.repeat(64) },
    },
  }
}

function newStampedModCard(
  template: ProfileSnapshot['modTemplates'][number],
): Readonly<{ card: SavedBoard['cards'][number]; origin: GuiNewModOrigin }> {
  const remapped = remapModPartIdentities(
    template.payload.mod,
    ({ role, ordinal }) => `control-new-stamped-${role}-${ordinal}`,
  )
  return {
    card: {
      id: 'card-new-stamped-mod',
      kind: 'mod',
      position: { x: 760, y: 320 },
      blocks: [{ id: 'block-new-stamped-mod', kind: 'line', text: 'New stamped Mod' }],
      modV2: remapped.value,
    },
    origin: {
      kind: 'stamped',
      instanceId: 'mod-new-stamped',
      sourceTemplateId: template.recordId,
      sourceTemplateVersion: template.payload.templateVersion,
      sourceToInstanceIdMap: {
        mod: { sourceId: template.recordId, instanceId: 'mod-new-stamped' },
        controls: remapped.mappings.map((mapping) => ({
          sourceId: mapping.sourceId,
          instanceId: mapping.instanceId,
        })),
      },
    },
  }
}

function ordinaryNewIdea(): ProfileSnapshot['ideas'][number] {
  return {
    id: 'idea-ordinary-new',
    name: 'Ordinary new Idea',
    createdAt: '2026-07-19T00:00:01.000Z',
    updatedAt: '2026-07-19T00:00:02.000Z',
    lastOpenedAt: '2026-07-19T00:00:02.000Z',
  }
}

function ordinaryNewBoard(): SavedBoard {
  return {
    version: 1,
    cards: [{
      id: 'card-ordinary-new',
      kind: 'note',
      position: { x: 0, y: 0 },
      blocks: [{ id: 'block-ordinary-new', kind: 'line', text: 'Typed before debounce settled' }],
    }],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '2026-07-19T00:00:02.000Z',
  }
}

function ordinaryAuthorization(
  snapshot: ProfileSnapshot,
  overrides: Partial<GuiOrdinaryNewIdeaAuthorization> = {},
): GuiOrdinaryNewIdeaAuthorization {
  return {
    authorizationId: 'ordinary-create-authorization-1',
    profileId: snapshot.profileId,
    baseRevision: snapshot.revision,
    ideaId: 'idea-ordinary-new',
    boardId: 'board:idea-ordinary-new',
    createdAt: '2026-07-19T00:00:01.000Z',
    expiresAt: '2026-07-19T00:05:00.000Z',
    ...overrides,
  }
}

function projectionDependencies(
  fixture: ReturnType<typeof createCompleteProfileFixture>,
): ProfileGuiProjectionDependencies {
  return {
    projectAsset: fixture.projectAsset,
    materializeUserModTemplate({ profileId, templateId, committedAt, mod, existing }) {
      const result = existing
        ? updateProfileModTemplate(existing, {
            updatedAt: committedAt,
            mod,
          })
        : createUserProfileModTemplate({
            profileId,
            templateId,
            createdAt: committedAt,
            mod,
          })
      if (!result.ok) throw new Error(result.message)
      return result.value
    },
    materializeNewModInstance(input) {
      const result = materializeNewMod(input)
      if (!result.ok) throw new Error(result.message)
      return result.value
    },
  }
}

function materializeNewMod(input: GuiNewModMaterialization) {
  if (input.origin.kind === 'direct') {
    return createDirectProfileModInstance({
      boardRecordId: input.boardRecordId,
      cardId: input.cardId,
      instanceId: input.origin.instanceId,
      createdAt: input.committedAt,
      mod: input.mod,
    })
  }
  if (!input.sourceTemplate) throw new Error('Stamped Mod source template is missing')
  return stampProfileModTemplate(input.sourceTemplate, {
    boardRecordId: input.boardRecordId,
    cardId: input.cardId,
    instanceId: input.origin.sourceToInstanceIdMap.mod.instanceId,
    controlIds: input.origin.sourceToInstanceIdMap.controls.map((pair) => pair.instanceId),
    stampedAt: input.committedAt,
  })
}

function appendedIntent(ideaId: string): IntentLogEvent {
  return {
    id: 'event-gui-appended',
    at: '2026-07-19T00:00:01.000Z',
    ideaId,
    type: 'card.content.edited',
    cardId: 'card-note',
    data: { field: 'body', textLength: 41 },
    commitId: 'commit-gui-appended',
    actorId: 'actor-trusted-owner',
    clientTxnId: 'client-txn-gui-1',
    seq: 4,
  }
}

function expectProjectionError(
  action: () => unknown,
  code: ProfileGuiProjectionError['code'],
  message: RegExp,
): void {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(ProfileGuiProjectionError)
    expect((error as ProfileGuiProjectionError).code).toBe(code)
    expect((error as Error).message).toMatch(message)
    return
  }
  throw new Error('Expected GUI Profile projection to fail')
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function unsafeProfileSettings(value: unknown): GuiProfileProjection['profileSettings'] {
  return value as GuiProfileProjection['profileSettings']
}
