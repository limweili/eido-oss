export type CameraViewport = {
  x: number
  y: number
  zoom: number
}

export type CameraViewportSize = {
  width: number
  height: number
}

export function centeredViewportForCameraTarget(
  target: CameraViewport,
  viewportSize: CameraViewportSize,
): CameraViewport {
  return {
    x: viewportSize.width / 2 - target.x * target.zoom,
    y: viewportSize.height / 2 - target.y * target.zoom,
    zoom: target.zoom,
  }
}

export function cameraViewportTransform(viewport: CameraViewport): string {
  return `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`
}
