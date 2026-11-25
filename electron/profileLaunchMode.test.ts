import { describe, expect, it } from 'vitest'
import {
  EIDO_CLI_ARGUMENT,
  PROFILE_JSON_CLI_ARGUMENT,
  PROFILE_MCP_ARGUMENT,
  resolveProfileLaunchMode,
} from './profileLaunchMode'

describe('installed Profile primary launch mode', () => {
  it('selects exactly one control mode and rejects repeated or conflicting flags', () => {
    expect(resolveProfileLaunchMode(['eido'])).toBe('gui')
    expect(resolveProfileLaunchMode(['eido', PROFILE_JSON_CLI_ARGUMENT])).toBe('json')
    expect(resolveProfileLaunchMode(['eido', PROFILE_MCP_ARGUMENT])).toBe('mcp')
    expect(resolveProfileLaunchMode(['eido', EIDO_CLI_ARGUMENT, 'graph', 'query'])).toBe('cli')
    expect(() => resolveProfileLaunchMode([
      'eido',
      PROFILE_JSON_CLI_ARGUMENT,
      PROFILE_JSON_CLI_ARGUMENT,
    ])).toThrow('Profile launch mode is invalid')
    expect(() => resolveProfileLaunchMode([
      'eido',
      PROFILE_JSON_CLI_ARGUMENT,
      PROFILE_MCP_ARGUMENT,
    ])).toThrow('Profile launch mode is invalid')
    expect(() => resolveProfileLaunchMode([
      'eido',
      PROFILE_MCP_ARGUMENT,
      '--unexpected',
    ])).toThrow('Profile launch mode is invalid')
    expect(() => resolveProfileLaunchMode([
      PROFILE_MCP_ARGUMENT,
      'eido',
    ])).toThrow('Profile launch mode is invalid')
    expect(() => resolveProfileLaunchMode([
      'eido',
      EIDO_CLI_ARGUMENT,
      EIDO_CLI_ARGUMENT,
    ])).toThrow('Profile launch mode is invalid')
  })
})
