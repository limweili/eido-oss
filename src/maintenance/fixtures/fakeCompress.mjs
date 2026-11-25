// Deterministic stand-in for the headless-browser compression pipeline, fed to
// scripts/maintenance/migrate-save-images.mjs via --compress-module in the CLI tests. The
// real pipeline's policy behavior is covered by src/maintenance/
// imageMigration.test.ts and src/shared/imageCompression.test.ts; this module
// only decides per-asset outcomes by file name so CLI tests stay browser-free
// and deterministic in CI.

const COMPRESSED_BYTES = 48_000

export async function compress(file) {
  if (file.name.includes('undecodable')) throw new Error('image-decode-failed')
  if (file.name.includes('unfittable')) throw new Error('image-compression-over-budget')
  const dataUrl = `data:image/jpeg;base64,${'A'.repeat(Math.ceil(COMPRESSED_BYTES / 3) * 4)}`
  return {
    dataUrl,
    mimeType: 'image/jpeg',
    size: COMPRESSED_BYTES,
    width: 1280,
    height: 960,
    originalSize: file.size,
    originalMimeType: file.type,
  }
}
