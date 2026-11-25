import type {
  AgentRunExecutionRequest,
  AgentRunExecutionResult,
} from '../brain/agentRunSession'
import {
  AGENT_RUN_ARTIFACT_READ_LIMITS,
  AGENT_RUN_LIVE_REQUIRED_MESSAGE,
  pageAgentRunArtifacts,
} from '../brain/agentRunContract'
import type {
  AgentRunExecutor,
  AgentRunExecutorFailure,
} from '../brain/agentRunExecutor'

export const AGENT_RUN_IDEA_NOT_LIVE_MESSAGE =
  'Open the requested Idea in Eido before running it from an agent.'

export const AGENT_RUN_EXECUTION_FAILED_MESSAGE = 'The agent run failed in Eido.'

export const AGENT_RUN_CREDENTIAL_UNAVAILABLE_MESSAGE =
  'Eido has no usable OpenRouter credential for this app session. Configure it in Eido, then submit a new run.'

export const AGENT_RUN_PLAN_CHANGED_MESSAGE =
  'The live Board changed after this agent run was admitted. Submit it again.'

export const AGENT_RUN_PERSISTENCE_FAILED_MESSAGE =
  'The agent run finished, but Eido could not persist its artifacts.'

export type AgentRunExecutionAdapterDependencies = Readonly<{
  runner: Pick<AgentRunExecutor, 'execute' | 'cancelActive'>
  flush(): Promise<unknown>
}>

export type AgentRunExecutionAdapter = (
  (request: AgentRunExecutionRequest) => Promise<AgentRunExecutionResult>
) & Readonly<{
  cancelActive(): void
  drain(): Promise<void>
}>

/** Serializes delegated execution and owns the persistence boundary. */
export function createAgentRunExecutionAdapter(
  dependencies: AgentRunExecutionAdapterDependencies,
): AgentRunExecutionAdapter {
  let previous = Promise.resolve()

  const executeOne = async (
    request: AgentRunExecutionRequest,
  ): Promise<AgentRunExecutionResult> => {
    const outcome = await dependencies.runner.execute(request)
    const error = outcome.failure ? failureMessage(outcome.failure) : undefined
    const validated = pageAgentRunArtifacts({
      runId: request.runId,
      status: outcome.status,
      artifacts: outcome.artifacts,
    }, {
      limit: AGENT_RUN_ARTIFACT_READ_LIMITS.maxItems,
      byteLimit: AGENT_RUN_ARTIFACT_READ_LIMITS.maxBytes,
    })
    if (!validated.ok) {
      return failedResult(
        AGENT_RUN_EXECUTION_FAILED_MESSAGE,
        outcome.executedStepIds,
        outcome.reusedStepIds,
      )
    }

    // Canceled, failed, and plan-changed work can all own durable partial
    // artifacts. Persist exactly what the brain operation returned.
    if (outcome.artifacts.length > 0) {
      try {
        await dependencies.flush()
      } catch {
        return failedResult(
          AGENT_RUN_PERSISTENCE_FAILED_MESSAGE,
          outcome.executedStepIds,
          outcome.reusedStepIds,
        )
      }
    }

    return Object.freeze({
      status: outcome.status,
      executedStepIds: Object.freeze([...outcome.executedStepIds]),
      reusedStepIds: Object.freeze([...outcome.reusedStepIds]),
      artifacts: Object.freeze([...outcome.artifacts]),
      ...(error ? { error } : {}),
    })
  }

  return Object.freeze(Object.assign(
    (request: AgentRunExecutionRequest) => {
      const executing = previous.then(() => executeOne(request))
      previous = executing.then(() => undefined, () => undefined)
      return executing
    },
    {
      cancelActive(): void {
        try {
          dependencies.runner.cancelActive()
        } catch {
          // Cancellation is best effort; drain still prevents a false checkpoint.
        }
      },
      drain(): Promise<void> {
        return previous
      },
    },
  )) as AgentRunExecutionAdapter
}

function failureMessage(failure: AgentRunExecutorFailure): string {
  switch (failure) {
    case 'live-required': return AGENT_RUN_LIVE_REQUIRED_MESSAGE
    case 'idea-not-live': return AGENT_RUN_IDEA_NOT_LIVE_MESSAGE
    case 'plan-changed': return AGENT_RUN_PLAN_CHANGED_MESSAGE
    case 'credential-unavailable': return AGENT_RUN_CREDENTIAL_UNAVAILABLE_MESSAGE
    case 'execution-failed': return AGENT_RUN_EXECUTION_FAILED_MESSAGE
  }
}

function failedResult(
  error: string,
  executedStepIds: readonly string[] = Object.freeze([]),
  reusedStepIds: readonly string[] = Object.freeze([]),
): AgentRunExecutionResult {
  return Object.freeze({
    status: 'failed',
    executedStepIds: Object.freeze([...executedStepIds]),
    reusedStepIds: Object.freeze([...reusedStepIds]),
    artifacts: Object.freeze([]),
    error,
  })
}
