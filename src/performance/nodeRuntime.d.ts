// Minimal ambient typings for the Node built-ins the Playwright perf specs
// use. The app tsconfig deliberately carries no @types/node — src is browser
// code — and these specs run only under Playwright's Node runtime.
declare const process: {
  env: Record<string, string | undefined>
  version: string
  pid: number
}

declare module 'node:child_process' {
  export function execSync(command: string): { toString(): string }
}

declare module 'node:fs' {
  export function closeSync(fd: number): void
  export function existsSync(path: string): boolean
  export function fsyncSync(fd: number): void
  export function lstatSync(path: string): { isSymbolicLink(): boolean }
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function mkdtempSync(prefix: string): string
  export function openSync(path: string, flags: string): number
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readdirSync(path: string): string[]
  export function realpathSync(path: string): string
  export function rmSync(path: string, options: { force?: boolean; recursive?: boolean }): void
  export function symlinkSync(target: string, path: string): void
  export function unlinkSync(path: string): void
  export function renameSync(oldPath: string, newPath: string): void
  export function writeFileSync(path: string, data: string, options?: { flag?: string }): void
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(path: string): string
  export function basename(path: string): string
  export function resolve(...parts: string[]): string
}

declare module 'node:os' {
  export type CpuInfo = { model: string }
  export function cpus(): CpuInfo[]
  export function totalmem(): number
  export function platform(): string
  export function release(): string
}
