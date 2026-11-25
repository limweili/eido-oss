export type CardResizeHandleGeometry = Readonly<{
  size: number
  radius: number
}>

export const CARD_RESIZE_HANDLE_GEOMETRY = {
  size: 9,
  radius: 4.5,
} as const satisfies CardResizeHandleGeometry
