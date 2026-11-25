import { describe, expect, it } from 'vitest'
import { GRAPH_ACTION_CONTRACTS, GRAPH_ACTION_SURFACE } from '../graph/actionContracts'
import {
  PROFILE_DURABLE_CLASS_COVERAGE,
  PROFILE_FIXTURE_SCHEMA_VERSION,
  SYNTHETIC_CARD_CREATED_EVENT,
  SYNTHETIC_GROUP_CARD,
  profileFixtureCorpus,
} from './fixtures/profileFixtureCorpus'
import {
  PROFILE_CONTRACT_FIXTURE_MAP,
  createSyntheticProfileContractAdapter,
  runProfileContractCases,
  validateProfileContractFixtureMap,
} from './profileContractCases'
import {
  PROFILE_DURABLE_CLASS_RECORD_MAP,
  PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS,
  PROFILE_CONTRACT_VERSION_DIMENSIONS,
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_GATEWAY_VERSIONS,
  PROFILE_INSPECTION_QUERY_NAMES,
  PROFILE_LOGICAL_RECORDS,
  ASSET_PROFILE_BOUNDARY,
  MOD_PROFILE_BOUNDARY,
  PROFILE_IDENTITY_AND_ORDERING_BOUNDARY,
  PROFILE_SECRET_BOUNDARY,
  PROFILE_SERVICE_ERROR_CODES,
  PROFILE_SERVICE_FAILURE_CONTRACTS,
  PROFILE_QUERY_LIMITS,
  FORBIDDEN_GATEWAY_OPERATIONS,
  PUBLIC_GATEWAY_COMMAND_NAMES,
  PUBLIC_GATEWAY_COMMAND_REGISTRY,
  PUBLIC_GATEWAY_QUERY_NAMES,
  PUBLIC_GATEWAY_QUERY_REGISTRY,
  PROFILE_SERVICE_OPERATION_METHODS,
  PROFILE_SERVICE_OPERATION_CONTRACTS,
  PORTABLE_EXPORT_EXCLUDED_STATE,
  SEMANTIC_INDEX_BOUNDARY,
  createProfileCapabilities,
  validateProfileAdapterDescriptor,
  validateProfileQuery,
  admitGatewayOperation,
  inspectProfileContractVersions,
  inspectProfileCompatibility,
  validateProfileCommandBatch,
} from './profileServiceContract'

describe('Local Profile Service executable contract (#458)', () => {
  it('preserves one coherent revision across snapshot, command, refusal, and retry outcomes', async () => {
    const results = await runProfileContractCases(createSyntheticProfileContractAdapter)

    expect(results).toEqual([
      { id: 'versions-and-capabilities', ok: true },
      { id: 'available-operations-are-callable', ok: true },
      { id: 'consistent-revision-7-snapshot', ok: true },
      { id: 'atomic-attributed-revision-8', ok: true },
      { id: 'stale-revision-preserves-7', ok: true },
      { id: 'precommit-failure-preserves-7-and-retry', ok: true },
      { id: 'retained-precommit-batch-reapplies-revision-8', ok: true },
      { id: 'future-schema-is-refused', ok: true },
      { id: 'forbidden-gateway-operations-are-denied', ok: true },
      { id: 'single-mutable-owner-stable-busy', ok: true },
      { id: 'ownership-status-exposes-stable-owner', ok: true },
      { id: 'dry-run-preserves-revision', ok: true },
      { id: 'idempotent-retry-replays-revision-8', ok: true },
      { id: 'mismatched-vector-preserves-revision-7', ok: true },
    ])
  })

  it('owns every durable class without making a derived Semantic Index authoritative', () => {
    expect(Object.keys(PROFILE_DURABLE_CLASS_RECORD_MAP).sort()).toEqual(
      Object.keys(PROFILE_DURABLE_CLASS_COVERAGE).sort(),
    )
    expect(PROFILE_LOGICAL_RECORDS.map((record) => record.kind)).toEqual([
      'profile',
      'idea',
      'board',
      'card',
      'block',
      'connection',
      'output',
      'output-version',
      'run',
      'transcript-message',
      'follow-up-message',
      'intent-event',
      'profile-agent-event',
      'logical-asset',
      'board-settings',
      'highlight',
      'highlight-tag',
      'compaction-summary',
      'mod-template',
      'mod-instance',
      'compatibility-state',
      'migration-ledger-entry',
      'recovery-point',
      'profile-setting',
    ])
    expect(SEMANTIC_INDEX_BOUNDARY).toEqual({
      authority: 'derived',
      lifecycle: 'disposable-and-rebuildable',
      storage: 'optional-sidecar',
      portableExport: 'excluded-by-default',
      contextPolicy: 'separate-versioned-and-labeled',
      implementation: 'absent',
    })
  })

  it('pins groups and causal intent metadata to Board-owned logical records', () => {
    const recordByKind = new Map(PROFILE_LOGICAL_RECORDS.map((record) => [record.kind, record] as const))

    expect(PROFILE_DURABLE_CLASS_RECORD_MAP.groups).toBe('card')
    expect(recordByKind.get('card')).toMatchObject({ owner: 'board', retention: 'authoritative' })
    expect(SYNTHETIC_GROUP_CARD).toMatchObject({ id: 'card-group', kind: 'group' })

    expect(PROFILE_DURABLE_CLASS_RECORD_MAP['intent-metadata']).toBe('intent-event')
    expect(recordByKind.get('intent-event')).toMatchObject({ owner: 'board', retention: 'append-only' })
    expect(SYNTHETIC_CARD_CREATED_EVENT).toMatchObject({
      id: 'event-note-created',
      type: 'card.created',
      cardId: 'card-note',
      commitId: 'commit-synthetic-1',
      actorId: 'actor-synthetic',
      clientTxnId: 'txn-synthetic-1',
      seq: 1,
    })
  })

  it('declares one high-level service seam and explicit adapter overlap', () => {
    expect(PROFILE_SERVICE_OPERATION_METHODS).toEqual({
      status: 'status',
      capabilities: 'capabilities',
      snapshot: 'snapshot',
      query: 'query',
      'command-batch': 'applyCommandBatch',
      flush: 'flush',
      recovery: 'recover',
      'portable-export': 'exportPortable',
      'portable-import': 'importPortableIntoFreshProfile',
    })
    expect(Object.values(PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS).every(
      (descriptor) => validateProfileAdapterDescriptor(descriptor).length === 0,
    )).toBe(true)
    expect(PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS['browser-development'].operations).toMatchObject({
      snapshot: 'available',
      query: 'available',
      'command-batch': 'available',
      recovery: 'unavailable',
    })
    expect(Object.values(PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS.sqlite.operations)).not.toContain('unavailable')
    expect(createSyntheticProfileContractAdapter().descriptor).toEqual(
      PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS['fault-test'],
    )
    expect(PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS['fault-test'].operations).toEqual({
      status: 'available',
      capabilities: 'unavailable',
      snapshot: 'available',
      query: 'unavailable',
      'command-batch': 'available',
      flush: 'unavailable',
      recovery: 'unavailable',
      'portable-export': 'unavailable',
      'portable-import': 'unavailable',
    })
    expect(createProfileCapabilities('sqlite')).toEqual({
      adapter: 'sqlite',
      versions: PROFILE_GATEWAY_VERSIONS,
      queries: PROFILE_INSPECTION_QUERY_NAMES,
      commands: [],
      queryLimits: PROFILE_QUERY_LIMITS,
    })
  })

  it('does not advertise the retired pre-Alpha eido-v3 migration service', () => {
    expect(PROFILE_SERVICE_OPERATION_METHODS).not.toHaveProperty('migration')
    expect(PROFILE_SERVICE_OPERATION_CONTRACTS).not.toHaveProperty('migration')
    for (const descriptor of Object.values(PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS)) {
      expect(descriptor.operations).not.toHaveProperty('migration')
    }

    expect(PROFILE_LOGICAL_RECORDS).toContainEqual(expect.objectContaining({
      kind: 'migration-ledger-entry',
      owner: 'profile',
      retention: 'append-only',
    }))
  })

  it('fails closed for malformed adapter descriptors and undeclared operation keys', () => {
    const descriptor = PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS.sqlite
    const { query: _query, ...withoutQuery } = descriptor.operations

    expect(validateProfileAdapterDescriptor(null as never)).toEqual(['invalid-descriptor'])
    expect(validateProfileAdapterDescriptor({} as never)).toEqual([
      'unsupported-adapter-kind',
      'invalid-versions',
      'invalid-operations',
    ])
    expect(validateProfileAdapterDescriptor({ ...descriptor, kind: 'raw-sql' } as never)).toContain(
      'unsupported-adapter-kind',
    )
    expect(validateProfileAdapterDescriptor({ ...descriptor, operations: withoutQuery } as never)).toContain(
      'undeclared-query',
    )
    expect(validateProfileAdapterDescriptor({
      ...descriptor,
      operations: { ...descriptor.operations, 'raw-sql': 'available' },
    } as never)).toContain('unknown-operation:raw-sql')
    expect(validateProfileAdapterDescriptor({ ...descriptor, label: 'synthetic' } as never)).toContain(
      'unknown-descriptor-field:label',
    )
    expect(validateProfileAdapterDescriptor({
      ...descriptor,
      versions: { ...descriptor.versions, physical: 1 },
    } as never)).toContain('unknown-version-dimension:physical')
  })

  it('refuses every unsupported future contract-version dimension without normalizing it down', () => {
    for (const dimension of PROFILE_CONTRACT_VERSION_DIMENSIONS) {
      const candidate = { ...PROFILE_CONTRACT_VERSIONS, [dimension]: 99 }

      expect(inspectProfileContractVersions(candidate)).toMatchObject({
        ok: false,
        code: 'unsupported-future-version',
        retryable: false,
        supportedVersions: PROFILE_CONTRACT_VERSIONS,
      })
      expect(inspectProfileCompatibility({
        format: 'eido-profile',
        schemaVersion: candidate.schema,
        versions: candidate,
      })).toMatchObject({
        ok: false,
        code: 'unsupported-future-version',
        supportedVersions: PROFILE_CONTRACT_VERSIONS,
      })
    }
  })

  it('refuses the retired Profile record axis instead of translating it to the current axis', () => {
    const retiredRecordAxis = { ...PROFILE_CONTRACT_VERSIONS, record: 1 }

    expect(inspectProfileContractVersions(retiredRecordAxis)).toMatchObject({
      ok: false,
      code: 'invalid',
      retryable: false,
    })
    expect(inspectProfileCompatibility({
      format: 'eido-profile',
      schemaVersion: retiredRecordAxis.schema,
      versions: retiredRecordAxis,
    })).toMatchObject({
      ok: false,
      code: 'invalid',
      retryable: false,
    })
  })

  it('requires an explicit value for every compatibility version axis', () => {
    const invalid = {
      ok: false,
      code: 'invalid',
      retryable: false,
      message: 'The request does not satisfy the Local Profile Service contract.',
    }

    expect(inspectProfileCompatibility({
      format: 'eido-profile',
      schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    })).toEqual(invalid)

    for (const dimension of PROFILE_CONTRACT_VERSION_DIMENSIONS) {
      const versions: Record<string, number> = { ...PROFILE_CONTRACT_VERSIONS }
      delete versions[dimension]

      expect(inspectProfileContractVersions(versions)).toEqual(invalid)
      expect(inspectProfileCompatibility({
        format: 'eido-profile',
        schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
        versions,
      })).toEqual(invalid)
    }
  })

  it('bounds every graph inspection before an adapter reads Profile records', () => {
    expect(PROFILE_QUERY_LIMITS).toEqual({
      defaultItems: 50,
      maxItems: 200,
      defaultBytes: 65_536,
      maxBytes: 262_144,
      maxFilterValues: 16,
      maxFilterValueBytes: 512,
      maxProjectionFields: 16,
      maxProjectionFieldBytes: 128,
      maxCursorBytes: 262_144,
    })
    expect(validateProfileQuery({ recordKinds: ['card'], projection: ['id', 'kind'] })).toEqual({
      ok: true,
      value: {
        recordKinds: ['card'],
        projection: ['id', 'kind'],
        limit: 50,
        byteLimit: 65_536,
      },
    })
    expect(validateProfileQuery({ creator: 'agent' })).toEqual({
      ok: true,
      value: {
        creator: 'agent',
        limit: 50,
        byteLimit: 65_536,
      },
    })
    expect(validateProfileQuery({ recordKinds: ['card'], limit: 201 })).toMatchObject({
      ok: false,
      code: 'invalid',
      retryable: false,
    })
    expect(validateProfileQuery({
      recordKinds: ['card'],
      projection: Array.from({ length: 17 }, (_, index) => `field-${index}`),
    })).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('rejects malformed Agent Gateway query envelopes without throwing', () => {
    const invalid = {
      ok: false,
      code: 'invalid',
      retryable: false,
      message: 'The request does not satisfy the Local Profile Service contract.',
    }
    const malformedQueries: unknown[] = [
      {},
      { recordKinds: 'card' },
      { recordKinds: ['card'], cursor: 42 },
      { recordKinds: ['card'], projection: ['id', 42] },
      { recordKinds: ['card'], limit: null },
      { recordKinds: ['card'], byteLimit: 1 },
      { recordKinds: ['card', 'card'] },
      { recordKinds: ['recovery-point'] },
      { creator: 'all' },
      { creator: 'system' },
      { recordKinds: ['card'], rawSql: 'SELECT 1' },
    ]

    for (const candidate of malformedQueries) {
      expect(validateProfileQuery(candidate as never)).toEqual(invalid)
    }
  })

  it('maps synthetic fixtures to contract cases without promoting input vectors to evidence', () => {
    expect(PROFILE_CONTRACT_FIXTURE_MAP).toEqual({
      'profile-source': ['supported-multi-idea-source'],
      snapshot: ['alpha-profile-v1-expected'],
      transaction: ['interrupted-write-input', 'atomic-transaction-rollback-scenario'],
      reload: ['wal-reload-scenario'],
      ownership: ['busy-lock-scenario'],
      recovery: ['corruption-recovery-scenario'],
      'portable-transfer': ['portable-export-import-restore-duplicate-scenario'],
      gateway: ['agent-gateway-allow-deny-scenario'],
      'future-refusal': ['unsupported-future-profile'],
      platforms: ['macos-arm64-windows-x64-evidence-scenario'],
    })
    expect(validateProfileContractFixtureMap()).toEqual([])
  })

  it('fails the contract map closed for an incomplete or malformed platform evidence matrix', () => {
    const platformFixture = profileFixtureCorpus.find(
      (fixture) => fixture.id === 'macos-arm64-windows-x64-evidence-scenario',
    )
    if (platformFixture?.id !== 'macos-arm64-windows-x64-evidence-scenario') {
      throw new Error('Missing synthetic platform evidence fixture')
    }
    const [macosEvidence, windowsEvidence] = platformFixture.data.platformEvidence
    const invalidEvidenceMatrices: unknown[] = [
      undefined,
      [],
      [macosEvidence],
      [{ platform: 'macos-arm64' }],
      [macosEvidence, { ...windowsEvidence, fixtureSchemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION + 1 }],
      [macosEvidence, { ...windowsEvidence, certified: true }],
    ]

    for (const platformEvidence of invalidEvidenceMatrices) {
      const corpus = profileFixtureCorpus.map((fixture) => (
        fixture.id === platformFixture.id
          ? {
              ...fixture,
              data: {
                evidenceLevel: 'fixture-only',
                ...(platformEvidence === undefined ? {} : { platformEvidence }),
              },
            }
          : fixture
      ))

      expect(validateProfileContractFixtureMap(corpus as never)).toContain(
        'platforms:missing-platform-evidence:macos-arm64-windows-x64-evidence-scenario',
      )
    }
  })

  it('keeps the public Agent Gateway smaller than internal actions and fail-closed', () => {
    const graphContractIds = new Set(GRAPH_ACTION_CONTRACTS.map((contract) => contract.id))
    const publicDomainContractIds = new Set([
      ...graphContractIds,
      'idea.lifecycle',
      'profile.mod-template',
    ])
    expect(PUBLIC_GATEWAY_COMMAND_NAMES.length).toBeLessThan(GRAPH_ACTION_SURFACE.length)
    expect(Object.keys(PUBLIC_GATEWAY_COMMAND_REGISTRY)).toEqual([...PUBLIC_GATEWAY_COMMAND_NAMES])
    expect(Object.keys(PUBLIC_GATEWAY_QUERY_REGISTRY)).toEqual([...PUBLIC_GATEWAY_QUERY_NAMES])
    expect(PUBLIC_GATEWAY_COMMAND_REGISTRY['idea.create']).toEqual({
      name: 'idea.create',
      version: 1,
      scope: 'profile',
      dryRun: true,
      expectedRevision: 'required',
      idempotency: 'required',
      atomicBatch: true,
      domainContract: 'idea.lifecycle',
      domainContractVersion: 1,
      affectedRecords: ['idea', 'board'],
      semanticAttribution: 'profile-revision',
    })
    expect(Object.values(PUBLIC_GATEWAY_COMMAND_REGISTRY).every((contract) =>
      contract.expectedRevision === 'required'
      && contract.idempotency === 'required'
      && contract.atomicBatch
      && contract.domainContractVersion === 1
      && publicDomainContractIds.has(contract.domainContract),
    )).toBe(true)
    expect(Object.values(PUBLIC_GATEWAY_QUERY_REGISTRY).every((contract) =>
      !contract.mutating && contract.bounded && contract.consistentSnapshot,
    )).toBe(true)
    expect(FORBIDDEN_GATEWAY_OPERATIONS).toEqual([
      'raw-storage',
      'generic-patch',
      'raw-sql',
      'filesystem.read',
      'filesystem.write',
      'electron.raw-ipc',
      'credentials.read',
      'network.listen',
    ])
    for (const operation of [...FORBIDDEN_GATEWAY_OPERATIONS, 'unknown.store.action']) {
      expect(admitGatewayOperation(operation)).toMatchObject({
        ok: false,
        code: 'capability-denied',
        retryable: false,
      })
    }
  })

  it('validates a complete command batch before any adapter can mutate the Profile', () => {
    const validBatch = {
      version: PROFILE_CONTRACT_VERSIONS.command,
      schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
      expectedRevision: 7,
      actor: { id: 'agent-contract', kind: 'agent', transport: 'test' },
      clientTxnId: 'txn-contract',
      idempotencyKey: 'idempotency-contract',
      dryRun: true,
      commands: [{
        version: PROFILE_CONTRACT_VERSIONS.command,
        id: 'command-contract',
        name: 'card.create',
        payload: { ideaId: 'idea-main' },
      }],
    }

    expect(validateProfileCommandBatch(validBatch)).toEqual({ ok: true, value: validBatch })
    expect(validateProfileCommandBatch({ ...validBatch, version: 99 })).toMatchObject({
      ok: false,
      code: 'unsupported-future-version',
    })
    expect(validateProfileCommandBatch({ ...validBatch, schemaVersion: 99 })).toMatchObject({
      ok: false,
      code: 'unsupported-future-version',
    })
    expect(validateProfileCommandBatch({
      ...validBatch,
      commands: [{ ...validBatch.commands[0], version: 99 }],
    })).toMatchObject({
      ok: false,
      code: 'unsupported-future-version',
    })
    expect(validateProfileCommandBatch({ ...validBatch, idempotencyKey: '' })).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    expect(validateProfileCommandBatch({
      ...validBatch,
      commands: [{ ...validBatch.commands[0], name: 'generic-patch' }],
    })).toMatchObject({
      ok: false,
      code: 'capability-denied',
    })
    expect(validateProfileCommandBatch({
      ...validBatch,
      commands: [validBatch.commands[0], validBatch.commands[0]],
    })).toMatchObject({
      ok: false,
      code: 'invalid',
    })
  })

  it('returns a defensive deeply frozen command batch for asynchronous adapters', () => {
    const candidate = {
      version: PROFILE_CONTRACT_VERSIONS.command,
      schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
      expectedRevision: 7,
      actor: { id: 'agent-contract', kind: 'agent', transport: 'test' },
      clientTxnId: 'txn-contract',
      idempotencyKey: 'idempotency-contract',
      dryRun: false,
      commands: [{
        version: PROFILE_CONTRACT_VERSIONS.command,
        id: 'command-contract',
        name: 'card.create',
        payload: {
          ideaId: 'idea-main',
          metadata: { labels: ['synthetic'] },
        },
      }],
    }

    const result = validateProfileCommandBatch(candidate)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected valid synthetic command batch')

    const validatedPayload = result.value.commands[0].payload as {
      ideaId: string
      metadata: { labels: string[] }
    }
    expect(result.value).not.toBe(candidate)
    expect(result.value.actor).not.toBe(candidate.actor)
    expect(result.value.commands).not.toBe(candidate.commands)
    expect(validatedPayload).not.toBe(candidate.commands[0].payload)
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.actor)).toBe(true)
    expect(Object.isFrozen(result.value.commands)).toBe(true)
    expect(Object.isFrozen(result.value.commands[0])).toBe(true)
    expect(Object.isFrozen(validatedPayload)).toBe(true)
    expect(Object.isFrozen(validatedPayload.metadata)).toBe(true)
    expect(Object.isFrozen(validatedPayload.metadata.labels)).toBe(true)

    candidate.actor.id = 'mutated-after-validation'
    candidate.commands[0].payload.ideaId = 'idea-mutated'
    candidate.commands[0].payload.metadata.labels.push('mutated')
    expect(result.value.actor.id).toBe('agent-contract')
    expect(validatedPayload).toEqual({
      ideaId: 'idea-main',
      metadata: { labels: ['synthetic'] },
    })
  })

  it('preserves __proto__ payload keys as inert frozen JSON data', () => {
    const payload = JSON.parse('{"ideaId":"idea-main","__proto__":{"polluted":"synthetic"}}') as Record<string, unknown>
    const result = validateProfileCommandBatch({
      version: PROFILE_CONTRACT_VERSIONS.command,
      schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
      expectedRevision: 7,
      actor: { id: 'agent-contract', kind: 'agent', transport: 'test' },
      clientTxnId: 'txn-prototype-key',
      idempotencyKey: 'idempotency-prototype-key',
      dryRun: false,
      commands: [{
        version: PROFILE_CONTRACT_VERSIONS.command,
        id: 'command-prototype-key',
        name: 'card.create',
        payload,
      }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected valid synthetic command batch')
    const validatedPayload = result.value.commands[0].payload
    expect(Object.prototype.hasOwnProperty.call(validatedPayload, '__proto__')).toBe(true)
    expect(validatedPayload['__proto__']).toEqual({ polluted: 'synthetic' })
    expect(Object.getPrototypeOf(validatedPayload)).toBe(Object.prototype)
    expect((validatedPayload as { polluted?: unknown }).polluted).toBeUndefined()
    expect(Object.isFrozen(validatedPayload)).toBe(true)
  })

  it('separates templates, stamps, logical assets, content hashes, and secrets', () => {
    expect(PROFILE_IDENTITY_AND_ORDERING_BOUNDARY).toEqual({
      recordIds: 'stable-across-revisions-and-portable-transfer',
      references: 'logical-id-only',
      meaningfulCollections: 'preserve-domain-order',
      serializationKeyOrder: 'not-semantic',
    })
    expect(MOD_PROFILE_BOUNDARY).toEqual({
      templateOwner: 'profile',
      instanceOwner: 'board',
      stamping: 'deep-copy-and-remap-internal-id-closure',
      templateMutationEffect: 'future-stamps-only',
      instanceLibraryDependency: 'none',
      futureFields: 'optional-data-only-round-trip',
      executableContent: 'forbidden',
    })
    expect(ASSET_PROFILE_BOUNDARY).toEqual({
      logicalIdentity: 'stable-global-id',
      contentIdentity: 'sha256-digest',
      equalBytes: 'physical-deduplication-only',
      logicalIdentityMerge: 'forbidden',
      rendererHydration: 'path-free-logical-asset',
      portableExport: 'digest-verified-closure',
    })
    expect(PROFILE_SECRET_BOUNDARY).toEqual({
      credentials: 'account-private-local-file-and-excluded',
      deviceSecrets: 'excluded',
      filesystemPaths: 'opaque',
      diagnostics: 'redacted',
      gateway: 'unreachable',
      portableExport: 'excluded',
    })
    expect(PORTABLE_EXPORT_EXCLUDED_STATE).toEqual([
      'wal',
      'locks',
      'caches',
      'credentials',
      'device-settings',
      'derived-indexes',
    ])
  })

  it('returns a closed stable failure vocabulary without persistence internals', () => {
    expect(Object.keys(PROFILE_SERVICE_FAILURE_CONTRACTS)).toEqual([...PROFILE_SERVICE_ERROR_CODES])
    expect(PROFILE_SERVICE_FAILURE_CONTRACTS).toMatchObject({
      busy: { retryable: true },
      conflict: { retryable: true },
      'unsupported-future-version': { retryable: false },
      invalid: { retryable: false },
      'not-found': { retryable: false },
      'corrupt-or-recovery-required': { retryable: false },
      'capability-denied': { retryable: false },
      'idea-remap-too-large': { retryable: false },
      internal: { retryable: true },
    })
    expect(JSON.stringify(PROFILE_SERVICE_FAILURE_CONTRACTS)).not.toMatch(
      /(?:sql|filesystem|file path|electron ipc|\\Users\\|\/Users\/|\.eido|credential|api[_-]?key)/i,
    )
  })

  it('freezes revision, atomicity, and portability semantics for every service operation', () => {
    expect(Object.keys(PROFILE_SERVICE_OPERATION_CONTRACTS)).toEqual(Object.keys(PROFILE_SERVICE_OPERATION_METHODS))
    expect(Object.values(PROFILE_SERVICE_OPERATION_CONTRACTS).every(
      (contract) => contract.physicalAuthority === 'hidden',
    )).toBe(true)
    expect(PROFILE_SERVICE_OPERATION_CONTRACTS.snapshot).toMatchObject({
      mutating: false,
      revision: 'consistent-observation',
      rendererHydration: 'saved-board-contract',
    })
    expect(PROFILE_SERVICE_OPERATION_CONTRACTS.query).toMatchObject({
      mutating: false,
      revision: 'consistent-observation',
      bounded: true,
    })
    expect(PROFILE_SERVICE_OPERATION_CONTRACTS['command-batch']).toMatchObject({
      mutating: true,
      revision: 'increment-on-acknowledged-commit',
      atomic: true,
      expectedRevision: 'required',
    })
    expect(PROFILE_SERVICE_OPERATION_CONTRACTS.flush.revision).toBe('preserve')
    expect(PROFILE_SERVICE_OPERATION_CONTRACTS.recovery).toMatchObject({
      revision: 'new-highest-on-restore',
      expectedRevision: 'required-for-restore',
    })
    expect(PROFILE_SERVICE_OPERATION_CONTRACTS['portable-export'].portableBoundary).toBe('logical-records-and-assets')
    expect(PROFILE_SERVICE_OPERATION_CONTRACTS['portable-import']).toMatchObject({
      copyFirst: true,
      revision: 'preserve-source-on-fresh-import',
    })
    expect(PROFILE_SERVICE_OPERATION_CONTRACTS['portable-import']).not.toHaveProperty('expectedRevision')
  })
})
