export const PROFILE_AUTHORITY_INSTALLED = 'installed' as const
export const RUNTIME_PROBE_CHANNEL = 'eido:runtime-probe' as const

export type RuntimeProbeResult = {
  chromium: string
  electron: string
  node: string
  profileAuthority: typeof PROFILE_AUTHORITY_INSTALLED
  sqlite: string
}

export type RuntimeProbeBridge = {
  runtimeProbe: () => Promise<RuntimeProbeResult>
}

export function createRuntimeProbeBridge(
  invoke: (channel: typeof RUNTIME_PROBE_CHANNEL) => Promise<unknown>,
): RuntimeProbeBridge {
  return Object.freeze({
    runtimeProbe: () => invoke(RUNTIME_PROBE_CHANNEL).then(assertRuntimeProbeResult),
  })
}

const RUNTIME_PROBE_KEYS = ['chromium', 'electron', 'node', 'profileAuthority', 'sqlite'] as const

export function assertRuntimeProbeResult(value: unknown): RuntimeProbeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidRuntimeProbe()
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate).sort()
  if (keys.length !== RUNTIME_PROBE_KEYS.length || keys.some((key, index) => key !== RUNTIME_PROBE_KEYS[index])) {
    return invalidRuntimeProbe()
  }
  if (
    !isVersion(candidate.chromium) ||
    !isVersion(candidate.electron) ||
    !isVersion(candidate.node) ||
    !isVersion(candidate.sqlite) ||
    candidate.profileAuthority !== PROFILE_AUTHORITY_INSTALLED
  ) {
    return invalidRuntimeProbe()
  }

  return {
    chromium: candidate.chromium,
    electron: candidate.electron,
    node: candidate.node,
    profileAuthority: PROFILE_AUTHORITY_INSTALLED,
    sqlite: candidate.sqlite,
  }
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function invalidRuntimeProbe(): never {
  throw new Error('Runtime probe returned invalid evidence')
}
