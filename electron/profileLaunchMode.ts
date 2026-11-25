export const PROFILE_JSON_CLI_ARGUMENT = '--eido-profile-json'
export const PROFILE_MCP_ARGUMENT = '--eido-profile-mcp'
export const EIDO_CLI_ARGUMENT = '--eido-cli'

export type ProfileLaunchMode = 'gui' | 'json' | 'mcp' | 'cli'

export function resolveProfileLaunchMode(argv: readonly string[]): ProfileLaunchMode {
  const controlArguments = argv.filter(
    argument => argument === PROFILE_JSON_CLI_ARGUMENT
      || argument === PROFILE_MCP_ARGUMENT
      || argument === EIDO_CLI_ARGUMENT,
  )

  if (controlArguments.length > 1) {
    throw new Error('Profile launch mode is invalid')
  }

  if (controlArguments[0] === PROFILE_JSON_CLI_ARGUMENT) {
    return 'json'
  }

  if (controlArguments[0] === PROFILE_MCP_ARGUMENT) {
    if (argv.length !== 2 || argv[1] !== PROFILE_MCP_ARGUMENT) {
      throw new Error('Profile launch mode is invalid')
    }
    return 'mcp'
  }

  if (controlArguments[0] === EIDO_CLI_ARGUMENT) {
    if (argv[1] !== EIDO_CLI_ARGUMENT) throw new Error('Profile launch mode is invalid')
    return 'cli'
  }

  return 'gui'
}
