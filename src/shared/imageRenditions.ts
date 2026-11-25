import type { CardAsset } from '../graph/types'

export type ImageRenditionPurpose =
  | 'card-thumbnail'
  | 'passive-card'
  | 'active-card'
  | 'gallery-thumbnail'
  | 'gallery'

export type ImageRenditionVisibility = 'visible' | 'preload' | 'offscreen'

export type ImageRenditionDemand = {
  purpose: ImageRenditionPurpose
  width: number
  height: number
  visibility: ImageRenditionVisibility
  settled: boolean
}

export type ImageRenditionVisual = {
  src: string
  key: string
  width: number
  height: number
  decodedBytes: number
  renditionBytes: number
  derived: boolean
}

export type ImageRenditionRenderRequest = {
  asset: Readonly<CardAsset>
  referenceIdentity: string
  key: string
  purpose: ImageRenditionPurpose
  width: number
  height: number
}

export type ImageRenditionRenderResult = {
  src: string
  width: number
  height: number
  byteSize: number
  decodeMs?: number
  resizeEncodeMs?: number
  revoke?: () => void
}

export type ImageRenditionRender = (
  request: ImageRenditionRenderRequest,
) => Promise<ImageRenditionRenderResult>

export type ImageRenditionRequestStatus = 'ready' | 'pending' | 'deferred'

export type ImageRenditionHandle = {
  key: string
  status: ImageRenditionRequestStatus
  // Always non-empty. While work is pending or deferred this is the last valid
  // visual, falling back to the authoritative Board reference on first use.
  visual: ImageRenditionVisual
  ready: Promise<ImageRenditionVisual>
  release: () => void
}

export type ImageRenditionSnapshot = {
  entries: number
  references: string[]
  decodedBytes: number
  renditionBytes: number
  /** Active visual references, including requests whose shared render has not resolved yet. */
  activePins: number
  /** Active visual references still waiting for a shared render. */
  pendingPins: number
  /** Cached renditions retained by at least one adopted visual reference. */
  pinnedEntries: number
  /** Invalidated renditions waiting only for their last visual reference to release. */
  invalidatedEntries: number
  storedReferenceBytes: number
  peakEntries: number
  peakDecodedBytes: number
  peakRenditionBytes: number
  hits: number
  misses: number
  deduplicated: number
  failures: number
  evictions: number
  revocations: number
  /** Budget trims deferred because every removable rendition was pinned. */
  budgetBlocked: number
  preloadRejected: number
  offscreenDeferred: number
  motionDeferred: number
  invalidationDeferred: number
  requestsByPurpose: Record<ImageRenditionPurpose, number>
  decodeMs: number
  resizeEncodeMs: number
}

/** Numeric, identity-free rendition state safe for packaged diagnostics. */
export type ImageRenditionNumericSnapshot = Pick<
  ImageRenditionSnapshot,
  'entries' | 'decodedBytes' | 'renditionBytes'
>

export type ImageRenditionResolverOptions = {
  render: ImageRenditionRender
  maxDecodedBytes: number
  maxRenditionBytes: number
  maxPreloadEntries: number
}

export type ImageRenditionPreload = {
  asset: Readonly<CardAsset>
  demand: ImageRenditionDemand
}

export type ImageRenditionResolver = {
  request: (
    asset: Readonly<CardAsset>,
    demand: ImageRenditionDemand,
    previous?: ImageRenditionVisual,
  ) => ImageRenditionHandle
  preload: (requests: readonly ImageRenditionPreload[]) => Promise<ImageRenditionVisual[]>
  invalidateReference: (asset: Readonly<CardAsset>) => void
  numericSnapshot: () => ImageRenditionNumericSnapshot
  snapshot: () => ImageRenditionSnapshot
  reset: () => void
  dispose: () => void
}

type CacheEntry = {
  visual: ImageRenditionVisual
  referenceIdentity: string
  lastUsed: number
  pins: number
  invalidated: boolean
  revoked: boolean
  revoke?: () => void
}

type RenditionClaim = {
  active: boolean
  entry?: CacheEntry
}

// Claims attach before shared rendering settles, so eviction sees every live
// visual reference rather than whichever `.ready` callback happens to run first.
type InFlightEntry = {
  promise: Promise<CacheEntry>
  referenceIdentity: string
  claims: Set<RenditionClaim>
  lifecycle: { invalidated: boolean }
}

export const IMAGE_RENDITION_BUDGETS = {
  maxDecodedBytes: 8 * 1024 * 1024,
  maxRenditionBytes: 2 * 1024 * 1024,
  maxPreloadEntries: 8,
} as const

// Retained for the historical #413 candidate evidence. Production runtime
// policy is owned by IMAGE_RENDITION_BUDGETS.
export const IMAGE_RENDITION_CANDIDATE_BUDGETS = IMAGE_RENDITION_BUDGETS

function positiveDimension(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.round(value))
}

function decodedBytes(width: number, height: number): number {
  return positiveDimension(width) * positiveDimension(height) * 4
}

function hashReference(value: string): string {
  // FNV-1a keeps huge data URLs out of Map keys while still including the
  // authoritative bytes. Asset id alone is insufficient because an id may be
  // retained when an image reference is replaced.
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function authoritativeImageReferenceIdentity(asset: Readonly<CardAsset>): string {
  return `${asset.id}:${asset.dataUrl.length}:${hashReference(asset.dataUrl)}`
}

export function imageRenditionKey(
  asset: Readonly<CardAsset>,
  demand: Pick<ImageRenditionDemand, 'purpose' | 'width' | 'height'>,
): string {
  return `${authoritativeImageReferenceIdentity(asset)}:${demand.purpose}:${positiveDimension(demand.width)}x${positiveDimension(demand.height)}`
}

function authoritativeVisual(
  asset: Readonly<CardAsset>,
  demand: ImageRenditionDemand,
): ImageRenditionVisual {
  const width = positiveDimension(asset.width ?? demand.width)
  const height = positiveDimension(asset.height ?? demand.height)
  return {
    src: asset.dataUrl,
    key: `authoritative:${authoritativeImageReferenceIdentity(asset)}`,
    width,
    height,
    decodedBytes: decodedBytes(width, height),
    renditionBytes: Math.max(0, asset.size),
    derived: false,
  }
}

export function createImageRenditionResolver(
  options: ImageRenditionResolverOptions,
): ImageRenditionResolver {
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, InFlightEntry>()
  const referenceSizes = new Map<string, number>()
  let clock = 0
  let disposed = false
  let hits = 0
  let misses = 0
  let deduplicated = 0
  let failures = 0
  let evictions = 0
  let revocations = 0
  let budgetBlocked = 0
  let preloadRejected = 0
  let offscreenDeferred = 0
  let motionDeferred = 0
  let invalidationDeferred = 0
  let requestsByPurpose: Record<ImageRenditionPurpose, number> = {
    'card-thumbnail': 0,
    'passive-card': 0,
    'active-card': 0,
    'gallery-thumbnail': 0,
    gallery: 0,
  }
  let decodeMs = 0
  let resizeEncodeMs = 0
  let peakEntries = 0
  let peakDecodedBytes = 0
  let peakRenditionBytes = 0

  const totals = () => {
    let decoded = 0
    let rendition = 0
    for (const entry of cache.values()) {
      decoded += entry.visual.decodedBytes
      rendition += entry.visual.renditionBytes
    }
    return { decoded, rendition }
  }

  const numericSnapshot = (): ImageRenditionNumericSnapshot => {
    const total = totals()
    return {
      entries: cache.size,
      decodedBytes: total.decoded,
      renditionBytes: total.rendition,
    }
  }

  const recordPeaks = () => {
    const total = totals()
    peakEntries = Math.max(peakEntries, cache.size)
    peakDecodedBytes = Math.max(peakDecodedBytes, total.decoded)
    peakRenditionBytes = Math.max(peakRenditionBytes, total.rendition)
  }

  const pinState = () => {
    let activePins = 0
    let pendingPins = 0
    let pinnedEntries = 0
    let invalidatedEntries = 0
    for (const entry of cache.values()) {
      activePins += entry.pins
      if (entry.pins > 0) pinnedEntries += 1
      if (entry.invalidated) invalidatedEntries += 1
    }
    for (const flight of inFlight.values()) {
      for (const claim of flight.claims) {
        if (!claim.active || claim.entry) continue
        activePins += 1
        pendingPins += 1
      }
    }
    return { activePins, pendingPins, pinnedEntries, invalidatedEntries }
  }

  const revokeEntry = (entry: CacheEntry) => {
    if (entry.revoked || !entry.revoke) return
    entry.revoked = true
    entry.revoke()
    revocations += 1
  }

  const removeEntry = (
    key: string,
    entry: CacheEntry,
    countEviction: boolean,
    force = false,
  ) => {
    if (!force && entry.pins > 0) return
    if (!cache.delete(key)) return
    revokeEntry(entry)
    if (countEviction) evictions += 1
  }

  const trim = () => {
    while (true) {
      const invalidated = [...cache.entries()]
        .filter(([, entry]) => entry.invalidated && entry.pins === 0)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0]
      if (invalidated) {
        removeEntry(invalidated[0], invalidated[1], true)
        continue
      }
      const total = totals()
      if (
        total.decoded <= options.maxDecodedBytes &&
        total.rendition <= options.maxRenditionBytes
      ) {
        return
      }
      const candidate = [...cache.entries()]
        .filter(([, entry]) => entry.pins === 0)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0]
      if (!candidate) {
        budgetBlocked += 1
        return
      }
      removeEntry(candidate[0], candidate[1], true)
    }
  }

  const deferred = (
    asset: Readonly<CardAsset>,
    demand: ImageRenditionDemand,
    previous?: ImageRenditionVisual,
  ): ImageRenditionHandle => {
    const visual = previous ?? authoritativeVisual(asset, demand)
    return {
      key: imageRenditionKey(asset, demand),
      status: 'deferred',
      visual,
      ready: Promise.resolve(visual),
      release: () => undefined,
    }
  }

  const request: ImageRenditionResolver['request'] = (asset, demand, previous) => {
    if (disposed) throw new Error('image-rendition-resolver-disposed')
    const normalizedDemand = {
      ...demand,
      width: positiveDimension(demand.width),
      height: positiveDimension(demand.height),
    }
    const referenceIdentity = authoritativeImageReferenceIdentity(asset)
    referenceSizes.set(referenceIdentity, asset.dataUrl.length)
    const key = imageRenditionKey(asset, normalizedDemand)
    const fallback = previous ?? authoritativeVisual(asset, normalizedDemand)
    const authoritativeFallback = authoritativeVisual(asset, normalizedDemand)
    const targetDecodedBytes = decodedBytes(normalizedDemand.width, normalizedDemand.height)
    requestsByPurpose[normalizedDemand.purpose] += 1

    if (normalizedDemand.visibility === 'offscreen') {
      offscreenDeferred += 1
      return deferred(asset, normalizedDemand, previous)
    }
    if (
      !normalizedDemand.settled &&
      previous?.derived &&
      targetDecodedBytes > previous.decodedBytes
    ) {
      motionDeferred += 1
      return deferred(asset, normalizedDemand, previous)
    }

    const cached = cache.get(key)
    if (cached?.invalidated) {
      invalidationDeferred += 1
      return deferred(asset, normalizedDemand)
    }
    if (cached) {
      hits += 1
      cached.lastUsed = ++clock
      cached.pins += 1
      let released = false
      return {
        key,
        status: 'ready',
        visual: cached.visual,
        ready: Promise.resolve(cached.visual),
        release: () => {
          if (released) return
          released = true
          cached.pins = Math.max(0, cached.pins - 1)
          trim()
        },
      }
    }

    let flight = inFlight.get(key)
    if (flight?.lifecycle.invalidated) {
      invalidationDeferred += 1
      return deferred(asset, normalizedDemand)
    }
    if (flight) {
      deduplicated += 1
    } else {
      misses += 1
      const claims = new Set<RenditionClaim>()
      const lifecycle = { invalidated: false }
      const promise = Promise.resolve()
        .then(() =>
          options.render({
            asset,
            referenceIdentity,
            key,
            purpose: normalizedDemand.purpose,
            width: normalizedDemand.width,
            height: normalizedDemand.height,
          }),
        )
        .then((rendered) => {
          const width = positiveDimension(rendered.width)
          const height = positiveDimension(rendered.height)
          const entry: CacheEntry = {
            visual: {
              src: rendered.src,
              key,
              width,
              height,
              decodedBytes: decodedBytes(width, height),
              renditionBytes: Math.max(0, rendered.byteSize),
              derived: true,
            },
            referenceIdentity,
            lastUsed: ++clock,
            pins: 0,
            invalidated: lifecycle.invalidated,
            revoked: false,
            revoke: rendered.revoke,
          }
          for (const claim of claims) {
            if (!claim.active) continue
            claim.entry = entry
            entry.pins += 1
          }
          decodeMs += rendered.decodeMs ?? 0
          resizeEncodeMs += rendered.resizeEncodeMs ?? 0
          cache.set(key, entry)
          trim()
          recordPeaks()
          return entry
        })
        .catch((error) => {
          failures += 1
          throw error
        })
        .finally(() => {
          inFlight.delete(key)
        })
      flight = { promise, referenceIdentity, claims, lifecycle }
      inFlight.set(key, flight)
    }

    const claim: RenditionClaim = { active: true }
    flight.claims.add(claim)
    const ready = flight.promise
      .then((entry) => {
        if (entry.invalidated) {
          invalidationDeferred += 1
          if (claim.active) {
            claim.active = false
            entry.pins = Math.max(0, entry.pins - 1)
            trim()
            recordPeaks()
          }
          return authoritativeFallback
        }
        if (claim.active) entry.lastUsed = ++clock
        return entry.visual
      })
      .catch(() => fallback)

    return {
      key,
      status: 'pending',
      visual: fallback,
      ready,
      release: () => {
        if (!claim.active) return
        claim.active = false
        if (claim.entry) claim.entry.pins = Math.max(0, claim.entry.pins - 1)
        trim()
        recordPeaks()
      },
    }
  }

  const clearCache = (countEviction: boolean, force = false) => {
    for (const [key, entry] of cache) removeEntry(key, entry, countEviction, force)
  }

  return {
    request,
    preload: async (requests) => {
      const eligible = requests.filter((candidate) => candidate.demand.visibility !== 'offscreen')
      const accepted = eligible.slice(0, Math.max(0, options.maxPreloadEntries))
      preloadRejected += requests.length - accepted.length
      const handles = accepted.map(({ asset, demand }) => request(asset, demand))
      try {
        return await Promise.all(handles.map((handle) => handle.ready))
      } finally {
        for (const handle of handles) handle.release()
      }
    },
    invalidateReference: (asset) => {
      const referenceIdentity = authoritativeImageReferenceIdentity(asset)
      for (const flight of inFlight.values()) {
        if (flight.referenceIdentity === referenceIdentity) flight.lifecycle.invalidated = true
      }
      for (const entry of cache.values()) {
        if (entry.referenceIdentity === referenceIdentity) entry.invalidated = true
      }
      trim()
      referenceSizes.delete(referenceIdentity)
    },
    numericSnapshot,
    snapshot: () => {
      const numeric = numericSnapshot()
      const pins = pinState()
      return {
        ...numeric,
        references: [...new Set([...cache.values()].map((entry) => entry.referenceIdentity))],
        ...pins,
        storedReferenceBytes: [...referenceSizes.values()].reduce((sum, value) => sum + value, 0),
        peakEntries,
        peakDecodedBytes,
        peakRenditionBytes,
        hits,
        misses,
        deduplicated,
        failures,
        evictions,
        revocations,
        budgetBlocked,
        preloadRejected,
        offscreenDeferred,
        motionDeferred,
        invalidationDeferred,
        requestsByPurpose: { ...requestsByPurpose },
        decodeMs,
        resizeEncodeMs,
      }
    },
    reset: () => {
      for (const flight of inFlight.values()) flight.lifecycle.invalidated = true
      for (const entry of cache.values()) entry.invalidated = true
      trim()
      referenceSizes.clear()
      hits = 0
      misses = 0
      deduplicated = 0
      failures = 0
      evictions = 0
      revocations = 0
      budgetBlocked = 0
      preloadRejected = 0
      offscreenDeferred = 0
      motionDeferred = 0
      invalidationDeferred = 0
      requestsByPurpose = {
        'card-thumbnail': 0,
        'passive-card': 0,
        'active-card': 0,
        'gallery-thumbnail': 0,
        gallery: 0,
      }
      decodeMs = 0
      resizeEncodeMs = 0
      peakEntries = 0
      peakDecodedBytes = 0
      peakRenditionBytes = 0
      recordPeaks()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const flight of inFlight.values()) {
        flight.lifecycle.invalidated = true
        for (const claim of flight.claims) claim.active = false
      }
      clearCache(false, true)
      referenceSizes.clear()
    },
  }
}

type RenditionCanvas = OffscreenCanvas | HTMLCanvasElement

function renditionCanvas(width: number, height: number): RenditionCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function canvasBlob(canvas: RenditionCanvas): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
  }
  return new Promise((resolve, reject) => {
    ;(canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('image-rendition-encode-failed'))),
      'image/webp',
      0.82,
    )
  })
}

export const browserImageRenditionRender: ImageRenditionRender = async (request) => {
  const decodeStart = performance.now()
  const response = await fetch(request.asset.dataUrl)
  if (!response.ok) throw new Error('image-rendition-reference-unavailable')
  const sourceBlob = await response.blob()
  const source = await createImageBitmap(sourceBlob)
  const decodeMs = performance.now() - decodeStart
  try {
    const renderStart = performance.now()
    const canvas = renditionCanvas(request.width, request.height)
    const context = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!context) throw new Error('image-rendition-canvas-unavailable')
    context.drawImage(source, 0, 0, request.width, request.height)
    const blob = await canvasBlob(canvas)
    const src = URL.createObjectURL(blob)
    return {
      src,
      width: request.width,
      height: request.height,
      byteSize: blob.size,
      decodeMs,
      resizeEncodeMs: performance.now() - renderStart,
      revoke: () => URL.revokeObjectURL(src),
    }
  } finally {
    source.close()
  }
}

let imageRenditionResolver: ImageRenditionResolver | null = null

/**
 * Reads an existing resolver without creating one. In particular, diagnostics
 * must not install the legacy candidate surface or allocate rendition state.
 */
export function readImageRenditionNumericSnapshot(): ImageRenditionNumericSnapshot | null {
  if (!imageRenditionResolver) return null
  return imageRenditionResolver.numericSnapshot()
}

const motionSubscribers = new Set<(settled: boolean) => void>()
let motionSettled = true
let motionTimer: ReturnType<typeof setTimeout> | undefined
let detachMotionListeners: (() => void) | undefined

export function imageRenditionMotionIsSettled(): boolean {
  return motionSettled
}

function ensureMotionListeners() {
  if (detachMotionListeners || typeof window === 'undefined') return
  const notifyMotion = () => {
    if (motionSettled) {
      motionSettled = false
      for (const subscriber of motionSubscribers) subscriber(false)
    }
    if (motionTimer !== undefined) clearTimeout(motionTimer)
    motionTimer = setTimeout(() => {
      motionSettled = true
      for (const subscriber of motionSubscribers) subscriber(true)
    }, 180)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (event.buttons !== 0) notifyMotion()
  }
  window.addEventListener('wheel', notifyMotion, { passive: true })
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('touchmove', notifyMotion, { passive: true })
  detachMotionListeners = () => {
    window.removeEventListener('wheel', notifyMotion)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('touchmove', notifyMotion)
    if (motionTimer !== undefined) clearTimeout(motionTimer)
    motionTimer = undefined
    motionSettled = true
    detachMotionListeners = undefined
  }
}

// This camera signal changes request policy on gesture events; pixel
// decode/resize remains asynchronous and never enters requestAnimationFrame.
export function subscribeImageRenditionMotion(
  subscriber: (settled: boolean) => void,
): () => void {
  motionSubscribers.add(subscriber)
  ensureMotionListeners()
  subscriber(motionSettled)
  return () => {
    motionSubscribers.delete(subscriber)
    if (motionSubscribers.size === 0) detachMotionListeners?.()
  }
}

export function getImageRenditionResolver(): ImageRenditionResolver | null {
  if (typeof window === 'undefined') return null
  if (!imageRenditionResolver) {
    imageRenditionResolver = createImageRenditionResolver({
      render: browserImageRenditionRender,
      ...IMAGE_RENDITION_BUDGETS,
    })
    // Preserve the existing #413 diagnostic contract for source-comparable
    // evidence. It is observability only; production behavior has no flag.
    ;(window as unknown as {
      __EIDO_IMAGE_RENDITION_CANDIDATE__?: {
        enabled: true
        snapshot: () => ImageRenditionSnapshot
        reset: () => void
      }
    }).__EIDO_IMAGE_RENDITION_CANDIDATE__ = {
      enabled: true,
      snapshot: imageRenditionResolver.snapshot,
      reset: imageRenditionResolver.reset,
    }
  }
  return imageRenditionResolver
}
