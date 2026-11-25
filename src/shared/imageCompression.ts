// Pasted images are compressed into small reference images before they are
// stored on Board cards (#247). Boards keep photo references, not archival
// originals, so the stored payload has a hard budget. The whole policy lives
// in this one module so the budget is easy to audit and change.

export const IMAGE_COMPRESSION_POLICY = {
  // Budget for the payload that actually lands in Board JSON: the data URL
  // string, not the binary image bytes.
  maxStoredPayloadBytes: 200 * 1024,
  // Longest edge of the stored reference image.
  maxEdgePx: 1280,
  // Dimension downshifts stop here; smaller stops being a usable reference.
  minEdgePx: 320,
  // Each downshift multiplies the edge by this factor.
  edgeDownshiftFactor: 0.75,
  // JPEG quality search order; the first encode under budget wins.
  jpegQualitySteps: [0.85, 0.75, 0.65, 0.55, 0.45] as readonly number[],
  // Transparency that cannot fit the budget as PNG is flattened onto this
  // background so UI screenshots stay readable as JPEG.
  flattenBackground: '#ffffff',
} as const

export type DecodedImage = {
  width: number
  height: number
  hasAlpha: boolean
  // Codec-private handle to the decoded pixels (e.g. an ImageBitmap).
  source: unknown
  close?: () => void
}

export type EncodeOptions = {
  width: number
  height: number
  mimeType: 'image/png' | 'image/jpeg'
  quality?: number
  // When set, the image is drawn over this color (flattening transparency).
  background?: string
}

// The seam between the compression policy (pure search logic, unit-testable
// anywhere) and the pixel work (browser canvas APIs). Tests inject a fake
// codec; the app uses browserImageCodec.
export type ImageCodec = {
  decode: (file: File) => Promise<DecodedImage>
  encode: (image: DecodedImage, options: EncodeOptions) => Promise<string>
}

export type CompressedImage = {
  dataUrl: string
  mimeType: string
  // Binary byte size of the stored payload (decoded from the data URL).
  size: number
  width: number
  height: number
  originalSize: number
  originalMimeType: string
}

export type ImageCompressionMetrics = {
  decodeMs: number
  encodeMs: number
  totalMs: number
  encodeAttempts: number
  sourceBytes: number
  storedDataUrlBytes: number
  compressedBytes: number
  width: number
  height: number
  mimeType: string
}

export type ImageCompressionInstrumentation = {
  now?: () => number
  onComplete: (metrics: ImageCompressionMetrics) => void
}

// Byte size of what gets saved into Board JSON: the data URL string itself.
export function storedPayloadBytes(dataUrl: string): number {
  return dataUrl.length
}

// Binary byte size of the image encoded inside a base64 data URL.
export function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return 0
  const base64 = dataUrl.slice(comma + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

function scaledDimensions(image: { width: number; height: number }, edge: number) {
  // Never upscale: a small pasted image keeps its own dimensions.
  const scale = Math.min(1, edge / Math.max(image.width, image.height, 1))
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  }
}

function edgeLadder(startEdge: number): number[] {
  const { minEdgePx, edgeDownshiftFactor } = IMAGE_COMPRESSION_POLICY
  const edges: number[] = []
  let edge = startEdge
  while (edge > minEdgePx) {
    edges.push(Math.round(edge))
    edge *= edgeDownshiftFactor
  }
  edges.push(minEdgePx)
  return edges
}

// Compress a pasted image file into a reference image under the stored-payload
// budget. Animated GIFs become a still first frame (the codec decodes frame
// one). Transparent images walk the dimension ladder as PNG first so
// transparency survives whenever any size fits; only when no PNG step fits are
// they flattened onto a white background and searched as JPEG, walking quality
// down first and dimensions down second. If even the smallest attempt misses
// the budget the image is rejected — an over-budget payload is never stored.
export async function compressImage(
  file: File,
  codec: ImageCodec = browserImageCodec,
  instrumentation?: ImageCompressionInstrumentation,
): Promise<CompressedImage> {
  const policy = IMAGE_COMPRESSION_POLICY
  const now = instrumentation?.now ?? (() => performance.now())
  const startedAt = now()
  const decoded = await codec.decode(file)
  let phaseStartedAt = now()
  const decodeMs = phaseStartedAt - startedAt
  let encodeMs = 0
  let encodeAttempts = 0
  try {
    const startEdge = Math.min(policy.maxEdgePx, Math.max(decoded.width, decoded.height))

    const finish = (attempt: { dataUrl: string; mimeType: string; width: number; height: number }): CompressedImage => {
      const result = {
        ...attempt,
        size: dataUrlByteSize(attempt.dataUrl),
        originalSize: file.size,
        originalMimeType: file.type,
      }
      instrumentation?.onComplete({
        decodeMs,
        encodeMs,
        totalMs: now() - startedAt,
        encodeAttempts,
        sourceBytes: file.size,
        storedDataUrlBytes: storedPayloadBytes(attempt.dataUrl),
        compressedBytes: result.size,
        width: attempt.width,
        height: attempt.height,
        mimeType: attempt.mimeType,
      })
      return result
    }

    const encode = async (options: EncodeOptions) => {
      encodeAttempts += 1
      const dataUrl = await codec.encode(decoded, options)
      const finishedAt = now()
      encodeMs += finishedAt - phaseStartedAt
      phaseStartedAt = finishedAt
      return dataUrl
    }

    if (decoded.hasAlpha) {
      for (const edge of edgeLadder(startEdge)) {
        const { width, height } = scaledDimensions(decoded, edge)
        const dataUrl = await encode({ width, height, mimeType: 'image/png' })
        if (storedPayloadBytes(dataUrl) <= policy.maxStoredPayloadBytes) {
          return finish({ dataUrl, mimeType: 'image/png', width, height })
        }
      }
    }

    for (const edge of edgeLadder(startEdge)) {
      const { width, height } = scaledDimensions(decoded, edge)
      for (const quality of policy.jpegQualitySteps) {
        const dataUrl = await encode({
          width,
          height,
          mimeType: 'image/jpeg',
          quality,
          background: policy.flattenBackground,
        })
        if (storedPayloadBytes(dataUrl) <= policy.maxStoredPayloadBytes) {
          return finish({ dataUrl, mimeType: 'image/jpeg', width, height })
        }
      }
    }
    throw new Error('image-compression-over-budget')
  } finally {
    decoded.close?.()
  }
}

// ---- Browser codec ---------------------------------------------------------
// Prefers createImageBitmap + OffscreenCanvas; falls back to HTMLImageElement
// + a document canvas for environments without them.

const ALPHA_CAPABLE_TYPES = new Set(['image/png', 'image/webp', 'image/gif'])

type RasterSource = ImageBitmap | HTMLImageElement

function rasterSize(source: RasterSource): { width: number; height: number } {
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  return { width: source.width, height: source.height }
}

async function loadRaster(file: File): Promise<RasterSource> {
  if (typeof createImageBitmap === 'function') {
    // Decodes the first frame of animated GIFs, which is exactly the still
    // reference the policy wants.
    return createImageBitmap(file)
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('image-decode-failed'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function draw(
  canvas: AnyCanvas,
  source: RasterSource,
  options: { width: number; height: number; background?: string },
) {
  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) throw new Error('canvas-2d-unavailable')
  if (options.background) {
    context.fillStyle = options.background
    context.fillRect(0, 0, options.width, options.height)
  }
  context.drawImage(source, 0, 0, options.width, options.height)
  return context
}

function detectAlpha(source: RasterSource): boolean {
  // Sample at a capped size; any pixel that is not fully opaque counts.
  const { width, height } = rasterSize(source)
  const scale = Math.min(1, 256 / Math.max(width, height, 1))
  const sampleWidth = Math.max(1, Math.round(width * scale))
  const sampleHeight = Math.max(1, Math.round(height * scale))
  const canvas = makeCanvas(sampleWidth, sampleHeight)
  const context = draw(canvas, source, { width: sampleWidth, height: sampleHeight })
  const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export const browserImageCodec: ImageCodec = {
  decode: async (file) => {
    const raster = await loadRaster(file)
    const close = () => {
      if (typeof ImageBitmap !== 'undefined' && raster instanceof ImageBitmap) raster.close()
    }
    try {
      const { width, height } = rasterSize(raster)
      if (!width || !height) throw new Error('image-decode-empty')
      const hasAlpha = ALPHA_CAPABLE_TYPES.has(file.type) && detectAlpha(raster)
      return { width, height, hasAlpha, source: raster, close }
    } catch (error) {
      close()
      throw error
    }
  },
  encode: async (image, options) => {
    const canvas = makeCanvas(options.width, options.height)
    draw(canvas, image.source as RasterSource, options)
    if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: options.mimeType, quality: options.quality })
      return blobToDataUrl(blob)
    }
    return (canvas as HTMLCanvasElement).toDataURL(options.mimeType, options.quality)
  },
}
