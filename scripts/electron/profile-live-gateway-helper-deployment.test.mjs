import { expect, it } from 'vitest'
import { runBoundedNativeBuild } from './bounded-native-build.mjs'

const prebuiltHelperPath = process.env.EIDO_PROFILE_LIVE_GATEWAY_TEST_HELPER

it.runIf(process.platform === 'darwin' && Boolean(prebuiltHelperPath))(
  'emits the native helper at the currently declared macOS 13.0 deployment target',
  async () => {
    const loadCommands = await runBoundedNativeBuild({
      command: '/usr/bin/otool',
      args: ['-l', prebuiltHelperPath],
      label: 'Prebuilt macOS helper deployment-target inspection',
      timeoutMs: 10_000,
    })
    const minimum = /\bminos\s+(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(loadCommands.stdout)
    expect(minimum).not.toBeNull()
    expect(minimum?.slice(1).map((part) => Number(part ?? 0))).toEqual([13, 0, 0])
  },
)
