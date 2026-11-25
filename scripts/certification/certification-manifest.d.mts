// Narrow type surface for certification authorities consumed from TypeScript.
type ProfileContractVersions = Readonly<{
  profile: number
  schema: number
  record: number
  asset: number
  app: number
  command: number
  export: number
}>

type BaseAgentContractVersions = Readonly<{
  batchSchema: number
  requestSchema: number
  commandSchema: number
  ledger: number
  event: number
}>

type ProofRevalidationIdentity = Readonly<{
  pathSet: string
  revalidatedSourceSha: string
  treeSha256: string
}>

type ProofRevalidationEvidence = Readonly<{
  kind: 'native-desktop-proof-workflow-run'
  workflow: string
  repository: string
  runId: number
  runAttempt: number
  runUrl: string
  event: 'push' | 'workflow_dispatch'
  branch: string
  conclusion: string
  headSha: string
  jobs: readonly Readonly<{ id: number; name: string; conclusion: string }>[]
}>

type ResolvedProofRevalidation = Readonly<{
  schemaVersion: 2
  pathSet: string
  revalidatedSourceSha: string
  treeSha256: string
  evidence: ProofRevalidationEvidence
}>

type ProofReuseCompatibility = Readonly<{
  schemaVersion: number
  policyVersion: number
  pathSet: string
  providerSourceSha: string
  revalidatedSourceSha: string
  checkedSourceSha: string
  treeSha256: string
  relevantPathsUnchanged: boolean
  evidence: ProofRevalidationEvidence
}>

export declare const CERTIFICATION_CONTRACT_VERSIONS: Readonly<{
  profile: ProfileContractVersions
  gateway: Readonly<{ protocol: number; compatibility: number; tools: number }>
  agent: BaseAgentContractVersions & Readonly<{
    run: Readonly<{
      version: number
      operations: readonly string[]
      availability: string
      adapters: readonly string[]
    }>
  }>
  commandSurface: Readonly<{
    installedVersion: number
    installedCommands: readonly string[]
    agentDiscoverableCommands: readonly string[]
    historicalVersions: readonly number[]
    historicalVersion: number
    historicalCommands: readonly string[]
  }>
  receipt: Readonly<{ emittedVersion: number; readableVersions: readonly number[] }>
}>

export declare const CERTIFICATION_V1_CONTRACT_VERSIONS: Readonly<{
  profile: ProfileContractVersions
  gateway: Readonly<{ protocol: number; compatibility: number; tools: number }>
  agent: BaseAgentContractVersions
  commandSurface: Readonly<{
    installedVersion: number
    installedCommands: readonly string[]
    historicalVersion: number
    historicalCommands: readonly string[]
  }>
  receipt: Readonly<{ emittedVersion: number; readableVersions: readonly number[] }>
}>

export declare const CERTIFICATION_PROOF_REVALIDATIONS: readonly Readonly<{
  schemaVersion: number
  pathSet: string
  revalidatedSourceSha: string
  treeSha256: string
  evidence: Readonly<Record<string, unknown>>
}>[]

export declare const CERTIFICATION_V1_RETAINED_SETS: readonly Readonly<{
  certificationSetId: string
  sourceSha: string
  semver: string
  manifestSha256: string
  canonicalSha256: string
  evidenceDigests: Readonly<{
    'darwin-arm64': string
    'win32-x64': string
  }>
  proofRevalidation: ProofRevalidationIdentity
}>[]

export declare const CERTIFICATION_INSTALLED_GATEWAY_VERSIONS: Readonly<{
  gateway: number
  schema: number
  record: number
  command: number
  export: number
  compatibility: number
}>

export declare const CERTIFICATION_PROOF_PATH_SET: string

export declare const NATIVE_DESKTOP_PROOF_WORKFLOW: string

export declare const NATIVE_DESKTOP_PROOF_WORKFLOW_FILE: string

export declare const NATIVE_DESKTOP_PROOF_ALLOWED_EVENTS: readonly ('push' | 'workflow_dispatch')[]

export declare const NATIVE_DESKTOP_PROOF_GATE_JOBS: readonly string[]

export declare const CERTIFICATION_PROFILE_RUNTIME_PATHS: readonly string[]

export declare function isProfileRuntimePath(file: string): boolean

export declare function computeProfileRuntimeFingerprint(
  sourceSha: string,
  options?: Readonly<{ cwd?: string }>,
): string

export declare function assertResolvedProofRevalidation(value: unknown): asserts value is ResolvedProofRevalidation

export declare function validateCurrentCertificationProofReuse(
  sourceSha: string,
  options: Readonly<{
    cwd?: string
    computeFingerprint?: (
      sourceSha: string,
      options?: Readonly<{ cwd?: string }>,
    ) => string
    revalidation: ResolvedProofRevalidation
  }>,
): ProofReuseCompatibility
