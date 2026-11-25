// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardAsset } from '../../graph/types'
import {
  createImageRenditionResolver,
  type ImageRenditionRender,
  type ImageRenditionResolver,
} from '../../shared/imageRenditions'
import { words } from '../../shared/words'
import { OverlayProvider } from '../../ui/overlays'
import { CardImagePanel } from './CardAssets'

const reference: CardAsset = {
  id: 'asset-reference',
  kind: 'image',
  name: 'reference.png',
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,authoritative',
  size: 27,
  createdAt: '2026-07-14T00:00:00.000Z',
  width: 1280,
  height: 960,
}

const alternate: CardAsset = {
  ...reference,
  id: 'asset-alternate',
  name: 'alternate.png',
  dataUrl: 'data:image/png;base64,alternate',
  width: 960,
  height: 1280,
}

const resolvers: ImageRenditionResolver[] = []

function resolver(render: ImageRenditionRender) {
  const created = createImageRenditionResolver({
    render,
    maxDecodedBytes: 16 * 1024 * 1024,
    maxRenditionBytes: 4 * 1024 * 1024,
    maxPreloadEntries: 2,
  })
  resolvers.push(created)
  return created
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  for (const created of resolvers.splice(0)) created.dispose()
})

describe('Card asset production rendition boundary', () => {
  it('removes the captured asset directly through its semantic control', () => {
    const onRemove = vi.fn()
    render(<CardImagePanel assets={[reference]} selected onRemove={onRemove} />)

    const remove = screen.getByRole('button', { name: 'Remove asset' })
    fireEvent.click(remove)

    expect(onRemove).toHaveBeenCalledWith(reference.id)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(remove).not.toHaveAttribute('title')
  })

  it('uses a purpose-sized rendition by default while retaining the authoritative fallback', () => {
    render(<CardImagePanel assets={[reference]} selected={false} />)

    const image = screen.getByRole('img', { name: reference.name })
    expect(image).toHaveAttribute('src', reference.dataUrl)
    expect(image).toHaveAttribute('data-image-rendition-purpose', 'passive-card')
    expect(image).toHaveAttribute('data-image-rendition-derived', 'false')
  })

  it('never blanks the last valid image while candidate work is pending or fails', async () => {
    let rejectRender!: (reason: Error) => void
    const renditionResolver = resolver(
      () => new Promise((_, reject) => { rejectRender = reject }),
    )
    render(
      <CardImagePanel
        assets={[reference]}
        selected={false}
        renditionResolver={renditionResolver}
      />,
    )

    const image = screen.getByRole('img', { name: reference.name })
    await waitFor(() => expect(image).toHaveAttribute('data-image-rendition-status', 'pending'))
    expect(image).toHaveAttribute('src', reference.dataUrl)
    expect(image.getAttribute('src')).not.toBe('')

    rejectRender(new Error('rendition-render-failed'))
    await waitFor(() => expect(renditionResolver.snapshot().failures).toBe(1))
    expect(image).toHaveAttribute('src', reference.dataUrl)
    expect(image.getAttribute('src')).not.toBe('')
  })

  it('prepares the active path and neighboring gallery renditions without changing Card data', async () => {
    const renderImage = vi.fn<ImageRenditionRender>(async ({ purpose, width, height }) => ({
      src: `blob:${purpose}:${width}x${height}`,
      width,
      height,
      byteSize: 2_048,
      revoke: vi.fn(),
    }))
    const renditionResolver = resolver(renderImage)
    const before = structuredClone(reference)
    render(
      <OverlayProvider>
        <CardImagePanel
          assets={[reference, alternate]}
          selected={false}
          renditionResolver={renditionResolver}
        />
      </OverlayProvider>,
    )

    const open = screen.getByRole('button', { name: reference.name })
    fireEvent.focus(open)
    await waitFor(() =>
      expect(renderImage.mock.calls.map(([request]) => request.purpose)).toContain('active-card'),
    )

    fireEvent.click(open)
    const gallery = await screen.findByRole('heading', { name: words.imageGallery })
    const modal = gallery.closest<HTMLElement>('.gallery-modal')
    if (!modal) throw new Error('Missing gallery modal')
    const stageImage = within(modal).getAllByRole('img', { name: reference.name })[0]
    await waitFor(() => expect(stageImage).toHaveAttribute('data-image-rendition-purpose', 'gallery'))
    await waitFor(() => expect(stageImage.getAttribute('src')).toMatch(/^blob:gallery:/))
    await waitFor(() => {
      expect(renderImage.mock.calls.some(([request]) =>
        request.asset.id === alternate.id && request.purpose === 'gallery',
      )).toBe(true)
    })

    expect(reference).toEqual(before)
    expect(renderImage.mock.calls.some(([request]) => request.purpose === 'gallery-thumbnail')).toBe(true)
  })

  it('opens on the requested image, navigates, and retires through the shared modal exit', async () => {
    const onRemove = vi.fn()
    render(
      <OverlayProvider>
        <CardImagePanel
          assets={[reference, alternate]}
          selected={false}
          renditionResolver={null}
          onRemove={onRemove}
        />
      </OverlayProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: alternate.name }))
    const dialog = await screen.findByRole('dialog', { name: words.imageGallery })
    expect(within(dialog).getAllByRole('img', { name: alternate.name })[0])
      .toHaveAttribute('src', alternate.dataUrl)
    expect(within(dialog).getByText('2 / 2')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: words.previousImage }))
    expect(within(dialog).getAllByRole('img', { name: reference.name })[0])
      .toHaveAttribute('src', reference.dataUrl)
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument()
    const remove = within(dialog).getByRole('button', { name: words.removeImage })
    expect(remove).toHaveClass('e-button', 'e-button--danger', 'e-button--compact')
    fireEvent.click(remove)
    expect(onRemove).toHaveBeenCalledWith(reference.id)

    const backdrop = dialog.parentElement!
    fireEvent.pointerDown(backdrop)
    expect(backdrop).toHaveAttribute('data-state', 'exiting')

    fireEvent.transitionEnd(backdrop, { propertyName: 'opacity' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: words.imageGallery })).toBeNull()
    })
  })

  it('keeps every attached image in the carousel instead of hiding the overflow', () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      ...reference,
      id: `asset-${index}`,
      name: `image-${index}.png`,
    }))
    const { container } = render(
      <CardImagePanel assets={many} selected={false} renditionResolver={null} />,
    )

    expect(container.querySelectorAll('.card-attachment-item--image')).toHaveLength(7)
    for (const asset of many) {
      expect(screen.getByRole('img', { name: asset.name })).toBeInTheDocument()
    }
  })

  it('refuses the native drag so a press on a tile reaches the Card gesture', () => {
    const { container } = render(
      <CardImagePanel assets={[reference]} selected={false} renditionResolver={null} />,
    )

    const track = container.querySelector('.card-attachment-track')
    if (!track) throw new Error('Missing attachment track')
    const open = screen.getByRole('button', { name: reference.name })
    const image = screen.getByRole('img', { name: reference.name })
    expect(open).toHaveAttribute('draggable', 'false')
    expect(image).toHaveAttribute('draggable', 'false')

    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true })
    image.dispatchEvent(dragStart)
    expect(dragStart.defaultPrevented).toBe(true)

    // The Card, not the panel, owns the drag: nothing in the track blocks it.
    expect(track.className).not.toContain('nodrag')
  })

  it('marks the tile the last gesture landed on as the active one', () => {
    const { container } = render(
      <CardImagePanel assets={[reference, alternate]} selected={false} renditionResolver={null} />,
    )

    const tiles = container.querySelectorAll('.card-attachment-item--image')
    // A resting panel marks nothing: the ring is where a gesture landed.
    expect(tiles[0]).not.toHaveAttribute('aria-current')
    expect(tiles[1]).not.toHaveAttribute('aria-current')

    fireEvent.pointerDown(screen.getByRole('button', { name: alternate.name }))
    expect(tiles[0]).not.toHaveAttribute('aria-current')
    expect(tiles[1]).toHaveAttribute('aria-current', 'true')

    fireEvent.pointerDown(screen.getByRole('button', { name: reference.name }))
    expect(tiles[0]).toHaveAttribute('aria-current', 'true')
    expect(tiles[1]).not.toHaveAttribute('aria-current')
  })
})
