import { describe, expect, it } from 'vitest'

import {
  CERTIFICATION_CONTRACT_VERSIONS,
  CERTIFICATION_INSTALLED_GATEWAY_VERSIONS,
} from '../../scripts/certification/certification-manifest.mjs'
import {
  PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
  PROFILE_AGENT_COMMAND_NAMES,
} from './profileAgentCommandManifest'
import {
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_GATEWAY_COMPATIBILITY_VERSION,
  PROFILE_GATEWAY_PROTOCOL_VERSION,
  PROFILE_GATEWAY_VERSIONS,
} from './profileServiceContract'

// The packaged-certification authority pins contract versions on purpose so a
// release fails closed when the shipped contract moves. That design only
// works if the omission is caught at PR time instead of by a dead native
// certification dispatch — the 0.1.1 release lost a full certification cycle
// to exactly this gap when #809 advanced the record envelope to v2 (see the
// 2026-07-23 entry in docs/retros/epic-448-friends-alpha-run-retro.md).
// A failure here means: move the certification authority in this same PR.
describe('packaged-certification contract pins track the source contracts', () => {
  it('pins the Profile axes the installed app will report', () => {
    expect(CERTIFICATION_CONTRACT_VERSIONS.profile).toEqual(PROFILE_CONTRACT_VERSIONS)
  })

  it('pins the Gateway protocol and compatibility versions', () => {
    expect(CERTIFICATION_CONTRACT_VERSIONS.gateway.protocol).toBe(PROFILE_GATEWAY_PROTOCOL_VERSION)
    expect(CERTIFICATION_CONTRACT_VERSIONS.gateway.compatibility)
      .toBe(PROFILE_GATEWAY_COMPATIBILITY_VERSION)
  })

  it('pins the installed Gateway version envelope', () => {
    expect(CERTIFICATION_INSTALLED_GATEWAY_VERSIONS).toEqual(PROFILE_GATEWAY_VERSIONS)
  })

  it('pins the installed command surface exactly', () => {
    expect(CERTIFICATION_CONTRACT_VERSIONS.commandSurface.installedVersion)
      .toBe(PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION)
    expect([...CERTIFICATION_CONTRACT_VERSIONS.commandSurface.installedCommands].sort())
      .toEqual([...PROFILE_AGENT_COMMAND_NAMES].sort())
  })
})
