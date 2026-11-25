import type { AiAccessGrant } from './aiAccess'
import type {
  AiExecutionPlan,
  AiProviderCallManifestItem,
} from './executionPlan'

export type AiExecutionBatchErrorCode =
  | 'batch-finished'
  | 'batch-terminal'
  | 'provider-plan-mismatch'

export class AiExecutionBatchError extends Error {
  constructor(readonly code: AiExecutionBatchErrorCode) {
    super(code)
  }
}

export type AiExecutionBatch = Readonly<{
  readonly grant: AiAccessGrant
  /** Number of planned provider calls started so far. */
  providerCallsStarted(): number
  /** Consumes exactly the next admitted provider occurrence before work starts. */
  runProvider<Result>(
    occurrence: AiProviderCallManifestItem,
    work: () => Promise<Result>,
  ): Promise<Result>
  /** Records the next completed output. Workflow runners own Board writes. */
  completeOutput(): Promise<boolean>
  /** Terminalizes exactly the next visible output and stops later egress. */
  release(outcome: 'failed' | 'cancelled'): Promise<boolean>
  /** Closes this action so it cannot issue further calls. */
  finish(): Promise<boolean>
}>

/** Executes each planned provider occurrence once, in graph-derived order.
 * This is local run scheduling; no account or billing service participates. */
export function createAiExecutionBatch(
  grant: AiAccessGrant,
  plan: AiExecutionPlan,
): AiExecutionBatch {
  if (!validPlan(plan)) throw new AiExecutionBatchError('provider-plan-mismatch')

  // Skip optional helpers when execution proves they are unnecessary.
  // Count only provider calls that actually started.
  let providerCursor = 0
  let providerCallsStartedCount = 0
  let nextVisibleOutput = 1
  let terminalRelease = false
  let finished = false
  let blocked: AiExecutionBatchErrorCode | undefined

  const assertProviderMayRun = (occurrence: AiProviderCallManifestItem): void => {
    if (blocked) throw new AiExecutionBatchError(blocked)
    if (finished) throw new AiExecutionBatchError('batch-finished')
    if (terminalRelease) throw new AiExecutionBatchError('batch-terminal')
    while (plan.providerCallManifest[providerCursor]?.optional
      && !sameOccurrence(plan.providerCallManifest[providerCursor]!, occurrence)) {
      providerCursor += 1
    }
    const expected = plan.providerCallManifest[providerCursor]
    if (!expected
      || expected.callClass !== occurrence.callClass
      || expected.providerModelId !== occurrence.providerModelId) {
      blocked = 'provider-plan-mismatch'
      throw new AiExecutionBatchError(blocked)
    }
    // Every occurrence is single-use even when its provider call fails.
    providerCursor += 1
    providerCallsStartedCount += 1
  }

  const record = async (outcome: 'finalized' | 'failed' | 'cancelled'): Promise<boolean> => {
    if (blocked || finished || nextVisibleOutput > plan.visibleTurns) return false
    nextVisibleOutput += 1
    if (outcome !== 'finalized') terminalRelease = true
    return true
  }

  return Object.freeze({
    grant,
    providerCallsStarted: () => providerCallsStartedCount,
    async runProvider<Result>(
      occurrence: AiProviderCallManifestItem,
      work: () => Promise<Result>,
    ): Promise<Result> {
      assertProviderMayRun(occurrence)
      return work()
    },
    async completeOutput() {
      return record('finalized')
    },
    async release(outcome) {
      if (plan.visibleTurns === 0) {
        if (blocked || finished || terminalRelease) return false
        terminalRelease = true
        return true
      }
      return record(outcome)
    },
    async finish() {
      if (blocked || finished) return false
      finished = true
      return true
    },
  })
}

function validPlan(plan: AiExecutionPlan): boolean {
  return plan.version === 1
    && Number.isSafeInteger(plan.visibleTurns)
    && plan.visibleTurns >= 0
    && Number.isSafeInteger(plan.providerCalls)
    && plan.providerCalls >= plan.visibleTurns
    && Array.isArray(plan.providerCallManifest)
    && plan.providerCallManifest.length === plan.providerCalls
    && plan.providerCallManifest.every((item) => (
      typeof item.providerModelId === 'string'
      && item.providerModelId.length > 0
      && (item.optional === undefined || item.optional === true)
      && (item.optional !== true
        || item.callClass === 'context-compaction'
        || item.callClass === 'speaker-name')
    ))
}

function sameOccurrence(
  left: AiProviderCallManifestItem,
  right: AiProviderCallManifestItem,
): boolean {
  return left.callClass === right.callClass
    && left.providerModelId === right.providerModelId
}
