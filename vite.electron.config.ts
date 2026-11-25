import path from 'node:path'
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

export const ELECTRON_BUILD_MODES = ['main', 'profile-utility', 'preload', 'eido-cli-sea'] as const
const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

type ElectronBuildMode = typeof ELECTRON_BUILD_MODES[number]

interface ElectronBuildTarget {
  entryFile: string
  outputFile: string
  emptyOutDir: boolean
}

const ELECTRON_BUILD_TARGETS: Readonly<Record<ElectronBuildMode, ElectronBuildTarget>> = {
  main: {
    entryFile: 'main.ts',
    outputFile: 'main.cjs',
    emptyOutDir: true,
  },
  'profile-utility': {
    entryFile: 'profileUtilityEntry.ts',
    outputFile: 'profile-utility.cjs',
    emptyOutDir: false,
  },
  preload: {
    entryFile: 'preload.ts',
    outputFile: 'preload.cjs',
    emptyOutDir: false,
  },
  'eido-cli-sea': {
    entryFile: 'eidoCliSeaEntry.ts',
    outputFile: 'eido-cli-sea.cjs',
    emptyOutDir: false,
  },
}

export function resolveElectronBuildTarget(mode: string): ElectronBuildTarget {
  if (!ELECTRON_BUILD_MODES.includes(mode as ElectronBuildMode)) {
    throw new Error(`Electron build mode must be one of: ${ELECTRON_BUILD_MODES.join(', ')}`)
  }
  return ELECTRON_BUILD_TARGETS[mode as ElectronBuildMode]
}

export default defineConfig(({ mode }) => {
  const target = resolveElectronBuildTarget(mode)

  return {
    build: {
      outDir: 'dist-electron',
      emptyOutDir: target.emptyOutDir,
      sourcemap: false,
      lib: {
        entry: path.resolve(import.meta.dirname, 'electron', target.entryFile),
        formats: ['cjs'],
        fileName: () => target.outputFile,
      },
      rollupOptions: {
        external: (id) => id === 'electron' || NODE_BUILTINS.has(id),
        output: {
          codeSplitting: false,
        },
      },
    },
  }
})
