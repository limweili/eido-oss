// Minimal ambient typings for the Node built-ins the migration CLI test uses,
// following src/performance/nodeRuntime.d.ts: the app tsconfig deliberately
// carries no @types/node — src is browser code — and this test runs only under
// vitest's Node runtime.

declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: string[],
    options: { cwd?: string; maxBuffer?: number },
    callback: (error: { code?: number } | null, stdout: string, stderr: string) => void,
  ): void
}

declare module 'node:crypto' {
  export type Hash = {
    update(data: string | Uint8Array, inputEncoding?: 'ascii'): Hash
    digest(encoding: 'hex' | 'base64url'): string
  }
  export function createHash(algorithm: string): Hash
}

declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Uint8Array>
  export function readFile(path: string, encoding: 'utf8'): Promise<string>
  export function writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>
  export function mkdtemp(prefix: string): Promise<string>
  export function readdir(path: string): Promise<string[]>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare module 'node:url' {
  export function fileURLToPath(url: URL | string): string
}
