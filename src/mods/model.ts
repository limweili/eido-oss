export const MOD_KIND_ORDER = [
  'mixer',
  'filter',
  'slider',
  'dial',
  'count',
  'switch',
  'pad',
  'select',
  'order',
  'radar',
  'matrix',
] as const

export type ModKind = (typeof MOD_KIND_ORDER)[number]
export type ModPartRole = 'item' | 'option' | 'lane' | 'axis' | 'row' | 'column'
export type ModPartIdFactory = (role: ModPartRole, ordinal: number) => string

export type ModItem = {
  id: string
  label: string
  v: number
  frame: string
}

export type SliderModState = {
  steps: number
  stops: string[]
  items: ModItem[]
}

export type DialModState = SliderModState

export type CountMode = 'number' | 'percent' | 'ratio'
export type CountItem = {
  id: string
  label: string
  n: number
  frame: string
}
export type CountModState = {
  mode: CountMode
  steps: number
  items: CountItem[]
}

export type SwitchItem = {
  id: string
  label: string
  on: boolean
  frame: string
}
export type SwitchModState = { items: SwitchItem[] }

export type PadAxis = {
  id: string
  label: string
  lo: string
  hi: string
  steps: number
  frame: string
}
export type PadModState = {
  axes: { x: PadAxis; y: PadAxis }
  v: { x: number; y: number }
}

export type SelectOption = {
  id: string
  label: string
  frame: string
}
export type SelectModState = {
  picked: number
  options: SelectOption[]
}

export type OrderItem = {
  id: string
  label: string
  frame: string
}
export type OrderModState = {
  items: OrderItem[]
  perm: number[]
  frame: string
}

export type FilterMode = 'no-more-than' | 'at-least' | 'between'
export type FilterLane = {
  id: string
  label: string
  mode: FilterMode
  lo: number
  hi: number
  frame: string
}
export type FilterModState = {
  steps: number
  stops: string[]
  lanes: FilterLane[]
}

export type MixerItem = ModItem
export type MixerModState = {
  frame: string
  items: MixerItem[]
}

export type RadarAxis = {
  id: string
  label: string
  v: number
  frame?: string
}
export type RadarModState = {
  steps: number
  axes: RadarAxis[]
}

export type MatrixLabel = {
  id: string
  label: string
}
export type MatrixModState = {
  steps: number
  stepNames: string[]
  rows: MatrixLabel[]
  cols: MatrixLabel[]
  cells: number[][]
}

export type ModStateByKind = {
  mixer: MixerModState
  filter: FilterModState
  slider: SliderModState
  dial: DialModState
  count: CountModState
  switch: SwitchModState
  pad: PadModState
  select: SelectModState
  order: OrderModState
  radar: RadarModState
  matrix: MatrixModState
}

export type Mod<K extends ModKind = ModKind> = {
  [P in K]: {
    kind: P
    title: string
    accent: string
    state: ModStateByKind[P]
    treatOverride: string | null
  }
}[K]
