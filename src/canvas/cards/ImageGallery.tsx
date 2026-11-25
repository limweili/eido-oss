import { useEffect, useMemo, useRef, useState, type ImgHTMLAttributes } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CardAsset } from '../../graph/types'
import {
  subscribeImageRenditionMotion,
  type ImageRenditionHandle,
  type ImageRenditionPurpose,
  type ImageRenditionResolver,
  type ImageRenditionVisual,
} from '../../shared/imageRenditions'
import { words } from '../../shared/words'
import { ModalShell } from '../../ui/overlays'
import { Button, IconButton } from '../../ui/primitives'

export function RenditionImage({
  asset,
  resolver,
  purpose,
  width,
  height,
  ...imageProps
}: {
  asset: CardAsset
  resolver: ImageRenditionResolver | null
  purpose: ImageRenditionPurpose
  width: number
  height: number
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height'>) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const lastValid = useRef<ImageRenditionVisual | undefined>(undefined)
  const lease = useRef<ImageRenditionHandle | null>(null)
  const requestGeneration = useRef(0)
  const visualReference = useRef(asset.dataUrl)
  const [visual, setVisual] = useState<ImageRenditionVisual>()
  const [status, setStatus] = useState('authoritative')
  const [inRange, setInRange] = useState(() => typeof IntersectionObserver === 'undefined')
  const [settled, setSettled] = useState(true)

  useEffect(() => {
    requestGeneration.current += 1
    lease.current?.release()
    lease.current = null
    lastValid.current = undefined
    visualReference.current = asset.dataUrl
    setVisual(undefined)
    setStatus('authoritative')
  }, [asset.id, asset.dataUrl])

  useEffect(() => () => lease.current?.release(), [])

  useEffect(() => {
    if (!resolver || typeof IntersectionObserver === 'undefined') {
      setInRange(true)
      return
    }
    const image = imageRef.current
    if (!image) return
    const observer = new IntersectionObserver(
      (entries) => {
        const nextInRange = entries.some((entry) => entry.isIntersecting)
        if (!nextInRange) {
          lastValid.current = undefined
          visualReference.current = asset.dataUrl
          setVisual(undefined)
          setStatus('deferred')
        }
        setInRange(nextInRange)
      },
      { rootMargin: '320px' },
    )
    observer.observe(image)
    return () => observer.disconnect()
  }, [asset.dataUrl, resolver])

  useEffect(() => {
    if (!resolver) return
    return subscribeImageRenditionMotion(setSettled)
  }, [resolver])

  useEffect(() => {
    const generation = ++requestGeneration.current
    if (!resolver || !inRange) {
      const previousLease = lease.current
      lease.current = null
      previousLease?.release()
      return
    }
    const previousLease = lease.current
    const handle = resolver.request(
      asset,
      {
        purpose,
        width,
        height,
        visibility: inRange ? 'visible' : 'offscreen',
        settled,
      },
      lastValid.current,
    )
    setStatus(handle.status)
    setVisual(handle.visual)
    visualReference.current = asset.dataUrl
    lastValid.current = handle.visual
    if (handle.status === 'deferred') {
      handle.release()
      return
    }
    let adopted = false
    void handle.ready.then((next) => {
      if (requestGeneration.current !== generation) {
        handle.release()
        return
      }
      lastValid.current = next
      visualReference.current = asset.dataUrl
      setVisual(next)
      if (next.key !== handle.key) {
        handle.release()
        setStatus('fallback')
        return
      }
      adopted = true
      lease.current = handle
      if (previousLease !== handle) previousLease?.release()
      setStatus('ready')
    })
    return () => {
      if (!adopted && lease.current !== handle) handle.release()
    }
  }, [asset, resolver, purpose, width, height, inRange, settled])

  if (!resolver) return <img ref={imageRef} src={asset.dataUrl} {...imageProps} />

  return (
    <img
      ref={imageRef}
      src={(visualReference.current === asset.dataUrl ? visual?.src : undefined) || asset.dataUrl}
      loading="lazy"
      data-image-rendition-purpose={purpose}
      data-image-rendition-status={status}
      data-image-rendition-derived={visual?.derived ? 'true' : 'false'}
      {...imageProps}
    />
  )
}

export function ImageGallery({
  images,
  startId,
  onClose,
  onRemove,
  renditionResolver,
}: {
  images: CardAsset[]
  startId?: string
  onClose: () => void
  onRemove?: (id: string) => void
  renditionResolver?: ImageRenditionResolver | null
}) {
  const [open, setOpen] = useState(true)
  const [activeId, setActiveId] = useState(startId ?? images[0]?.id)
  const closingRef = useRef(false)
  const activeIndex = useMemo(
    () => Math.max(0, images.findIndex((image) => image.id === activeId)),
    [activeId, images],
  )
  const active = images[activeIndex] ?? images[0]
  const activeSize = active
    ? imageDisplaySize(active, 1280, 960)
    : { width: 1280, height: 960 }

  useEffect(() => {
    setActiveId(startId ?? images[0]?.id)
  }, [images, startId])

  useEffect(() => {
    if (!renditionResolver || images.length < 2) return
    const neighbors = [-1, 1].map((delta) => images[(activeIndex + delta + images.length) % images.length])
    void renditionResolver.preload(
      neighbors.map((image) => {
        const size = imageDisplaySize(image, 1280, 960)
        return {
          asset: image,
          demand: {
            purpose: 'gallery' as const,
            width: size.width,
            height: size.height,
            visibility: 'preload' as const,
            settled: true,
          },
        }
      }),
    )
  }, [activeIndex, images, renditionResolver])

  if (!images.length || !active) return null

  const move = (delta: number) => {
    const next = (activeIndex + delta + images.length) % images.length
    setActiveId(images[next].id)
  }

  const requestClose = () => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
  }

  return (
    <ModalShell
      open={open}
      title={words.imageGallery}
      dismissOnBackdrop
      backdropTone="deep"
      className="gallery-modal"
      onDismiss={requestClose}
      onExitComplete={onClose}
    >
      <div className="gallery-stage">
        <IconButton
          className="gallery-nav"
          variant="quiet"
          label={words.previousImage}
          icon={<ChevronLeft aria-hidden="true" />}
          disabled={images.length < 2}
          onClick={() => move(-1)}
        />
        <figure>
          <RenditionImage
            asset={active}
            resolver={renditionResolver ?? null}
            purpose="gallery"
            width={activeSize.width}
            height={activeSize.height}
            alt={active.name}
          />
          <figcaption>
            <span className="gallery-caption-name">{active.name}</span>
            <span className="gallery-count t-value">{activeIndex + 1} / {images.length}</span>
            {onRemove && (
              <Button variant="danger" size="compact" onClick={() => onRemove(active.id)}>
                {words.removeImage}
              </Button>
            )}
          </figcaption>
        </figure>
        <IconButton
          className="gallery-nav"
          variant="quiet"
          label={words.nextImage}
          icon={<ChevronRight aria-hidden="true" />}
          disabled={images.length < 2}
          onClick={() => move(1)}
        />
      </div>

      <div className="gallery-grid">
        {images.map((image) => (
          <button
            type="button"
            key={image.id}
            className={image.id === active.id ? 'active' : ''}
            onClick={() => setActiveId(image.id)}
            title={image.name}
            onMouseEnter={() => prepareGalleryImage(renditionResolver ?? null, image)}
            onFocus={() => prepareGalleryImage(renditionResolver ?? null, image)}
          >
            <RenditionImage
              asset={image}
              resolver={renditionResolver ?? null}
              purpose="gallery-thumbnail"
              width={144}
              height={108}
              alt={image.name}
            />
          </button>
        ))}
      </div>
    </ModalShell>
  )
}

function imageDisplaySize(asset: CardAsset, maxWidth: number, maxHeight: number) {
  const sourceWidth = Math.max(1, asset.width ?? maxWidth)
  const sourceHeight = Math.max(1, asset.height ?? maxHeight)
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

function prepareGalleryImage(resolver: ImageRenditionResolver | null, asset: CardAsset) {
  if (!resolver) return
  const size = imageDisplaySize(asset, 1280, 960)
  void resolver.preload([
    {
      asset,
      demand: {
        purpose: 'gallery',
        width: size.width,
        height: size.height,
        visibility: 'preload',
        settled: true,
      },
    },
  ])
}
