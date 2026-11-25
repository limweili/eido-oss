/**
 * The root TypeScript program is the renderer/test program. Playwright probes
 * Electron's optional type surface, but resolving the installed desktop package
 * here would also import its full Node declarations into browser source.
 * Main and preload code use tsconfig.electron.json and keep the real Node types.
 */
export {}
