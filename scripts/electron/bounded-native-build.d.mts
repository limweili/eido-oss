export interface BoundedNativeBuildOptions {
  command: string
  args?: string[]
  label: string
  timeoutMs: number
  cwd?: string
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  terminationGraceMs?: number
  forwardOutput?: boolean
  allowedExitCodes?: number[]
}

export function runBoundedNativeBuild(
  options: BoundedNativeBuildOptions,
): Promise<{
  code: number
  signal: null
  stdout: string
  stderr: string
}>

export function terminateBoundedProcessTree(options: {
  pid: number
  platform?: NodeJS.Platform
  timeoutMs?: number
}): Promise<boolean>
