import { describe, expect, it } from 'vitest'
import { classifyProfileLiveGatewayHelperTermination } from './profileLiveGatewayNativeHelper'

describe('Profile Live Gateway native helper termination', () => {
  it('maps only the helper missing-endpoint exit to confirmed absence', () => {
    expect(classifyProfileLiveGatewayHelperTermination({
      kind: 'exit',
      code: 20,
    })).toEqual({
      state: 'absent',
      reason: 'endpoint-not-found',
      admission: 'none',
      fallback: 'headless',
    })
  })

  it.each([
    [{ kind: 'exit', code: 21 }, 'peer-rejected', 'none'],
    [{ kind: 'exit', code: 23 }, 'protocol-failure', 'admitted'],
    [{ kind: 'exit', code: 22 }, 'transport-failure', 'unknown'],
    [{ kind: 'exit', code: 0 }, 'disconnected', 'unknown'],
    [{ kind: 'exit', code: 99 }, 'transport-failure', 'unknown'],
    [{ kind: 'signal', signal: 'SIGTERM' }, 'transport-failure', 'unknown'],
    [{ kind: 'spawn-error', code: 'ENOENT' }, 'transport-failure', 'unknown'],
  ] as const)('forbids fallback for %#', (termination, reason, admission) => {
    expect(classifyProfileLiveGatewayHelperTermination(termination)).toEqual({
      state: 'unavailable',
      reason,
      admission,
      fallback: 'forbidden',
    })
  })
})
