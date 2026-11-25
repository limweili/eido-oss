import type { CardAsset } from '../graph/types'
import { newId } from './ids'
import { compressImage, browserImageCodec, type ImageCodec } from './imageCompression'
import type { ClipboardEvent as ReactClipboardEvent } from 'react'

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function assetKind(file: File): CardAsset['kind'] | null {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) return 'image'
  if (file.type === 'application/pdf') return 'file'
  return null
}

export function clipboardHasSupportedAssets(event: ClipboardEvent | ReactClipboardEvent): boolean {
  const clipboard = 'clipboardData' in event ? event.clipboardData : null
  if (!clipboard) return false

  for (const item of Array.from(clipboard.items ?? [])) {
    if (item.kind !== 'file') continue
    const type = item.type
    if (SUPPORTED_IMAGE_TYPES.has(type) || type === 'application/pdf') return true
  }

  for (const file of Array.from(clipboard.files ?? [])) {
    if (assetKind(file)) return true
  }

  return false
}

function fallbackName(file: File, index: number): string {
  if (file.name) return file.name
  if (file.type.startsWith('image/')) {
    const ext = file.type.split('/')[1] || 'png'
    return `Pasted image ${index + 1}.${ext}`
  }
  return `Pasted file ${index + 1}`
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export type IngestOptions = {
  // Test seam: policy tests inject a deterministic codec.
  codec?: ImageCodec
}

async function assetFromFile(file: File, index: number, options: IngestOptions): Promise<CardAsset | null> {
  const kind = assetKind(file)
  if (!kind) return null

  const base = {
    id: newId('asset'),
    kind,
    name: fallbackName(file, index),
    createdAt: new Date().toISOString(),
  }

  if (kind === 'image') {
    try {
      const compressed = await compressImage(file, options.codec ?? browserImageCodec)
      return {
        ...base,
        mimeType: compressed.mimeType,
        dataUrl: compressed.dataUrl,
        size: compressed.size,
        width: compressed.width,
        height: compressed.height,
        originalSize: compressed.originalSize,
        originalMimeType: compressed.originalMimeType,
        compression: 'compressed',
      }
    } catch {
      // An image that cannot be decoded or encoded is dropped so the rest of
      // the paste still works. Never store the original bytes or an empty
      // dataUrl for it.
      return null
    }
  }

  // Non-image files (PDF) bypass the compression pipeline entirely.
  return {
    ...base,
    mimeType: file.type,
    dataUrl: await readAsDataUrl(file),
    size: file.size,
  }
}

export async function assetsFromFiles(files: File[], options: IngestOptions = {}): Promise<CardAsset[]> {
  const assets = await Promise.all(files.map((file, index) => assetFromFile(file, index, options)))
  return assets.filter((asset): asset is CardAsset => asset !== null)
}

export async function assetsFromClipboard(
  event: ClipboardEvent | ReactClipboardEvent,
  options: IngestOptions = {},
): Promise<CardAsset[]> {
  const clipboard = 'clipboardData' in event ? event.clipboardData : null
  if (!clipboard) return []

  const files: File[] = []
  for (const item of Array.from(clipboard.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && assetKind(file)) files.push(file)
  }

  if (!files.length) {
    for (const file of Array.from(clipboard.files ?? [])) {
      if (assetKind(file)) files.push(file)
    }
  }

  return assetsFromFiles(files, options)
}
