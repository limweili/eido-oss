import type { InstalledProfileRendererRuntimeOptions } from './installedProfileRendererRuntime'

/** Browser builds cannot acquire packaged Profile execution authority. */
export function installPackagedProfileRendererRuntime(
  _options: InstalledProfileRendererRuntimeOptions,
): () => void {
  throw new Error('Packaged Profile renderer runtime is unavailable')
}
