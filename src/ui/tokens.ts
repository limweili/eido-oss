export type ThemeId = 'light' | 'dark'

export const DEFAULT_THEME: ThemeId = 'light'

export const DESIGN_TIMING_MS = Object.freeze({
  exit: 140,
  intent: 600,
  reducedFade: 80,
  toastDismiss: 4_200,
})

// Search is a right-anchored desktop panel. Its width recipe lives beside the
// visual tokens so the React behavior and CSS presentation cannot invent
// independent geometry.
export const BOARD_SEARCH_PANEL_METRICS = Object.freeze({
  defaultWidth: 360,
  minWidth: 280,
  maxWidth: 720,
  keyboardStep: 16,
  viewportInset: 64,
})

// The opt-in renderer counters are a compact, pointer-transparent floating
// panel. Its fixed measure lives with the other surface recipes so the CSS
// consumes named authority rather than inventing local geometry.
export const RENDERER_COUNTERS_OVERLAY_METRICS = Object.freeze({
  width: 320,
})

// One Card shell radius authority for CSS and any canvas geometry that must
// align with a mounted DOM Card. Painter-owned Map/Overview representations
// keep their zoom-specific LOD recipe; mounted motion silhouettes consume
// this exact board-space radius after transforming it by zoom.
export const CARD_SHELL_METRICS = Object.freeze({
  radius: 8,
})

// A Group is a translucent structural region rather than ordinary Card paper.
// CSS and the motion-silhouette painter share these values so handing fill
// ownership between DOM and canvas cannot change its apparent opacity.
export const GROUP_CARD_SURFACE_OPACITY = Object.freeze({
  resting: 0.45,
  selected: 0.55,
})

// Connector nodes are screen-space canvas chrome. The prototype recipe is a
// 13px hollow ring that may grow to 24px with a close-up Card, inside an
// independently stable 24px target, with a 1.5px base ink stroke and 1px go
// focus ring. DOM cards, the canvas painter, and pointer geometry all consume
// this metric owner.
export const CONNECTOR_NODE_METRICS = Object.freeze({
  diameter: 13,
  maxDiameter: 24,
  hitDiameter: 24,
  stroke: 1.5,
  focusRing: 1,
})

// The arrow tip sits at the connector centre; this is the visible body length
// beyond the ring and its compact height-to-length proportion. Both the DOM
// edge and bounded canvas fallback consume the same geometry.
export const CONNECTION_ARROW_METRICS = Object.freeze({
  tipExtension: 3,
  heightRatio: 0.72,
})

// The transformed canvas layer has its own private stacking scale. React Flow
// gives every node the z-index the Board hands it, so Cards and the floating
// surfaces that live inside the same transform (the connection editor) compete
// there and the app's z ladder never reaches them. Cards stack upward from
// their own base and are capped below this ceiling, which is what lets a
// canvas-floating surface sit above every Card no matter how deep the Board's
// stack has grown.
export const CANVAS_CARD_LAYER_CEILING = 9000

// React Flow raises the SELECTED node by a fixed amount on top of whatever
// z-index the Board authored, and it does so inside its own renderer where our
// ceiling cannot see it. A cap that ignored this lift was no cap at all: the
// one Card the founder had in hand was exactly the Card that could climb over
// the connection editor. The Card ladder therefore ends a full lift below the
// ceiling, so even a selected Card at the top of the ladder stays under it.
// This mirrors `SELECTED_NODE_Z` in `@xyflow/system`; Eido leaves React Flow's
// `elevateNodesOnSelect` at its default, so the lift is always in play.
export const REACT_FLOW_SELECTED_NODE_LIFT = 1000

// The highest layer the Board may author for a Card.
export const CANVAS_CARD_LAYER_MAX =
  CANVAS_CARD_LAYER_CEILING - REACT_FLOW_SELECTED_NODE_LIFT - 1

const LIGHT_TOKENS = Object.freeze({
  '--e-surface-recessed': '#dcd7cc',
  '--e-surface-ground': '#e8e4dc',
  '--e-surface-panel': '#f1eee8',
  '--e-surface-card': '#f8f6f1',
  '--e-surface-floating': '#fcfaf6',
  '--e-surface-field': '#e9e5dd',
  '--e-field-bg': '#fcfaf6',
  '--e-field-hover': '#e9e5dd',
  '--e-veil': 'rgba(35,32,25,.32)',
  '--e-veil-deep': 'rgba(35,32,25,.78)',
  '--e-ink': '#232019',
  '--e-ink-soft': '#5f594c',
  '--e-ink-faint': '#847d70',
  '--e-line': 'rgba(35,32,25,.16)',
  // The interactive boundary (SYSTEM §3.3) and, on a field, its only edge. At
  // .28 it measured 1.73-1.80:1 across the daylight ladder: not merely under
  // the 3:1 floor for a non-text boundary but well under the value the night
  // theme had already rejected for the same reason. .52 puts daylight at
  // 3.07-3.36:1, the same measured band the night ladder holds at .44, so one
  // rule now governs both themes instead of one theme carrying an exemption
  // nobody wrote down. --e-line stays at .16: it is structure, not a boundary.
  '--e-line-strong': 'rgba(35,32,25,.52)',
  '--e-dot': 'rgba(35,32,25,.26)',
  '--e-wash': 'rgba(35,32,25,.07)',
  '--e-grid-dot': 'rgba(35,32,25,.11)',
  '--e-pad-dot': 'rgba(35,32,25,.14)',
  '--e-ink-on-bright': '#232019',
  // THE DAYLIGHT INK TWINS.
  // SYSTEM §1.3 asks two things of a twin at once: it is "the same hue at two
  // lightnesses" as its solid, and it is the text that rides that solid's wash.
  // Daylight met neither. go and mod were the SAME hex as their solids, so the
  // second lightness did not exist, and on the 20% selected/active wash the
  // family measured 4.15-4.44:1, under 4.5. Each twin is now stepped down the
  // smallest amount that clears 4.5 on both the 12% and 20% washes and on every
  // surface the system permits functional text (4.61-6.45). The step is a
  // uniform sRGB scale, so hue and chroma ratios are untouched; only lightness
  // moves. Recessed keeps its documented carve-out: §1.3 bans functional text
  // there, which is why 4.28-4.69 is allowed to stand.
  '--e-go': '#2f6f5e',
  '--e-go-ink': '#2b6656',
  '--e-avoid': '#bb4326',
  '--e-avoid-ink': '#9f3b21',
  '--e-mod': '#6a4fb0',
  '--e-mod-ink': '#664ca9',
  '--e-convo': '#3466c2',
  '--e-convo-ink': '#2f5cb0',
  '--e-attention': '#e9a820',
  '--e-attention-ink': '#805b06',
  '--e-agent-unadopted-accent': '#805b06',
  '--e-on-solid': '#f8f6f1',
  '--e-wash-base': '#f8f6f1',
  '--e-brand-green': '#2f6f5e',
  // The ceremonial register is the one place the system paints a solid and sets
  // text directly on it, so each brand hue has to carry --e-on-solid at 4.5:1.
  // Green measured 5.47 and amber 7.58 against ink, but blue at #3f78df measured
  // 3.92: the only failing text pair left in daylight. #3568c6 is the identity
  // palette's own blue, so the fix costs the system no new hue and lands at 4.93.
  '--e-brand-blue': '#3568c6',
  '--e-brand-amber': '#eca23b',
  '--e-hl-yellow': '#f9eaa6',
  '--e-hl-yellow-dot': '#dfb93a',
  '--e-hl-green': '#d8efc4',
  '--e-hl-green-dot': '#74b74a',
  '--e-hl-blue': '#cfe6fb',
  '--e-hl-blue-dot': '#5a9bdd',
  '--e-hl-pink': '#fbd9ea',
  '--e-hl-pink-dot': '#e178b0',
  '--e-hl-orange': '#fcdfbd',
  '--e-hl-orange-dot': '#e99a45',
  '--e-hl-purple': '#e4dcf9',
  '--e-hl-purple-dot': '#9a7edb',
  '--e-hl-teal': '#c8eee6',
  '--e-hl-teal-dot': '#41ac99',
  '--e-hl-red': '#fbd6cf',
  '--e-hl-red-dot': '#dd6d5c',
  '--e-hl-brown': '#e9dccd',
  '--e-hl-brown-dot': '#a3805e',
  '--e-hl-gray': '#e4e1d8',
  '--e-hl-gray-dot': '#8d897c',
  '--e-mono': '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  '--e-sans': '"Open Sans", system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
  '--e-fs-micro': '11px',
  '--e-fs-label': '12px',
  '--e-fs-ui': '13px',
  '--e-fs-title': '14px',
  '--e-fs-display': '16px',
  // SYSTEM §2.2 already names this role (`--e-type-title-canvas`, 24/1.3/700,
  // the Title card's landmark size) but shipped without a token, so the reference
  // and the app each hard-coded 24px. This is the role's one home, not a new step.
  '--e-fs-title-canvas': '24px',
  // THE TRACKING LADDER. Four steps, picked by case and size rather than by
  // feel. Caps need air and the smallest caps need the most, so micro (11px)
  // takes .08em and label (12px) takes .06em. Mono in sentence case takes
  // .04em, enough to keep tabular figures from crowding. Mono at display size
  // takes .02em, because tracking that helps at 11px shouts at 24px. Prose
  // takes none. Named here because tracking was the last unnamed axis: eight
  // distinct values were in use across a system whose brief asks the chrome to
  // be ruthlessly consistent.
  '--e-tracking-caps-s': '.08em',
  '--e-tracking-caps': '.06em',
  '--e-tracking-mono': '.04em',
  '--e-tracking-display': '.02em',
  '--e-fs-prose-s': '14px',
  '--e-fs-prose-m': '15px',
  '--e-fs-prose-l': '18px',
  // THE NOTE LADDER'S UPPER REACH. A Note is the one surface whose reader sets
  // its own type size, and the three prose steps above gave that reader almost
  // no room: 14 / 15 / 18 spans a single point at the bottom and stops before
  // a Note can be a heading on the board. These three continue the same prose
  // family at ~1.22 per step (18 / 22 / 28 / 34) so a Note can grow into a
  // landmark without borrowing the editorial roles, which are fenced to
  // documents. They are prose roles, not chrome: nothing but Note body text
  // may use them.
  '--e-fs-prose-xl': '22px',
  '--e-fs-prose-2xl': '28px',
  '--e-fs-prose-3xl': '34px',
  // THE EDITORIAL LADDER. The instrument scale stops at 16px on purpose: a
  // tool's chrome should never shout. But Eido has reading surfaces too, and
  // they were being set with whatever the nearest instrument step happened to
  // be, which is why long documents read flat. Four steps, ratio ~1.3, so the
  // jump between neighbours is obvious at a glance and the whole ladder still
  // fits on one screen: 16 / 20 / 26 / 34.
  //
  // Where they belong: the design system document, onboarding, empty boards,
  // milestones, and anything else the person READS rather than operates.
  // Where they never belong: working chrome. A 26px heading inside a dock or a
  // panel is the failure this ladder is fenced off to prevent.
  '--e-fs-editorial-h3': '16px',
  '--e-fs-editorial-h2': '20px',
  '--e-fs-editorial-h1': '26px',
  '--e-fs-editorial-title': '34px',
  // Headings tighten as they grow: 34px at 1.4 would leave a hole between the
  // lines of a two-line title.
  '--e-lh-editorial-h3': '1.35',
  '--e-lh-editorial-h2': '1.28',
  '--e-lh-editorial-h1': '1.2',
  '--e-lh-editorial-title': '1.1',
  // The standfirst under a title: paper voice, one step above body, so the
  // reader knows the section's claim before reading the section.
  '--e-fs-editorial-lede': '18px',
  '--e-sp-1': '4px',
  '--e-sp-2': '8px',
  '--e-sp-3': '12px',
  '--e-sp-4': '16px',
  '--e-sp-5': '24px',
  '--e-sp-6': '32px',
  '--e-sp-7': '48px',
  '--e-r-inner': '4px',
  '--e-r-chip': '6px',
  '--e-r-card': `${CARD_SHELL_METRICS.radius}px`,
  '--e-r-well': '10px',
  '--e-r-modal': '12px',
  '--e-card-border-width': '1px',
  // THE ATTACHMENT PANEL RECIPE. A Note's attachments sit in carousels pinned
  // to the bottom of the Card, never in its flowing body. One rule decides how
  // tall a panel is: a share of the Card's own HEIGHT, floored so a panel
  // always shows a usable strip and capped so attachments can never swallow
  // the note. Width is deliberately absent from that rule. A narrower Card
  // scrolls its carousel; it must never shorten a panel or crop a tile, which
  // is the exact failure this recipe replaces.
  //
  // The floor is 48 + 48 + 24 off the spacing ladder and the ceiling is five
  // 48s: at the floor a link preview shows its title, description and site row
  // with the cover image cropped away to nothing, and every pixel the Card's
  // height adds above the floor goes to that image until the ceiling shows it
  // whole. 28% puts the growth band between roughly 430px and 860px of Card
  // height, which is the range a Note gets resized through by hand.
  '--e-attachment-panel-height-min': '120px',
  '--e-attachment-panel-height-max': '240px',
  '--e-attachment-panel-height-share': '28%',
  // One preview tile is as wide as five ladder 48s, so a row of them reads as
  // evenly sized cards; a Card narrower than one tile shrinks the tile to its
  // own width rather than hiding its right edge behind the Card border.
  '--e-attachment-preview-width': '240px',
  // Ceilings for both tile kinds, so neither carousel can produce an absurdly
  // wide tile from absurdly wide source content. An image tile's box is a
  // fixed 4:3 (see .card-attachment-item--image), so its natural ceiling is
  // already the width that ratio reaches at the panel's own height ceiling:
  // 240 * 4/3. This token makes that ceiling explicit as a hard max-width
  // rather than an emergent one, so a very wide source image cannot stretch
  // the flex item past it; object-fit: contain still letterboxes inside the
  // box either way. A preview tile is allowed to grow past its base width to
  // read as a link bar (see .card-attachment-item--preview), and this token
  // caps that growth at exactly double the base, its own round number on the
  // same ladder.
  '--e-attachment-image-width-max': '320px',
  '--e-attachment-preview-width-max': '480px',
  // THE LINK PREVIEW TILE LADDER. A preview tile's box moves in both axes: the
  // panel's height decides how tall it is, and how many previews share the
  // carousel decides how wide. One fixed arrangement is therefore always wrong
  // somewhere, so the tile reads its OWN box and picks one of four shapes.
  // These four thresholds name where it changes shape. They are mirrored
  // literally in the container-query conditions in 040-cards-prose.css --
  // custom properties are not usable inside a container-query condition -- so
  // they are named here to keep one authority for the numbers.
  //
  //   inline-size >= 360px            image on the LEFT, text on the RIGHT.
  //     360 is halfway from a tile's base width (240) to its ceiling (480):
  //     the point where a thumbnail and a readable measure both fit on one
  //     line instead of the text being squeezed into a column.
  //   block-size  >  144px            image on TOP, text BELOW (the narrow,
  //     tall tile). Three 48s: below it an image on top would be a sliver,
  //     so the tile drops the image rather than show a band of pixels.
  //   block-size <=  96px             no room for the description.
  //   block-size <=  72px             no room for the site row either: the
  //     favicon moves onto the title line and the tile reads as a link chip.
  '--e-link-preview-split-inline': '360px',
  '--e-link-preview-stack-image-block': '144px',
  '--e-link-preview-description-block': '96px',
  '--e-link-preview-chip-block': '72px',
  // What the image is allowed to take once it has room. Stacked, it keeps the
  // paper's 16:9 cover ratio and never takes more than half the tile, so the
  // text always keeps the other half. Beside the text it is a 4:3 thumbnail
  // sized by the tile's own height, capped at two fifths of the tile so a tall
  // tile cannot turn its thumbnail into a slab.
  '--e-link-preview-stack-image-ratio': '16 / 9',
  '--e-link-preview-stack-image-block-max': '50%',
  '--e-link-preview-row-image-ratio': '4 / 3',
  '--e-link-preview-row-image-inline-max': '40%',
  // The floor is a design target, not a physical guarantee: a short Card
  // still owes its head a row and its body a sliver, and a panel that took
  // the floor anyway would paint past the Card's own bottom edge. This is
  // that reservation made explicit -- the head's own min-height (36px, see
  // .card-head) plus what the Note body's padding alone costs once its
  // content has nothing left to give (12px top + 14px bottom, see
  // .card-body). A panel's height is capped at whatever the Card has left
  // after this, so it can never ask for space that isn't there.
  '--e-attachment-panel-reserved-chrome': '62px',
  '--e-group-surface-opacity': `${Math.round(GROUP_CARD_SURFACE_OPACITY.resting * 100)}%`,
  '--e-group-selected-surface-opacity': `${Math.round(GROUP_CARD_SURFACE_OPACITY.selected * 100)}%`,
  '--e-connector-size': `${CONNECTOR_NODE_METRICS.diameter}px`,
  '--e-connector-hit-size': `${CONNECTOR_NODE_METRICS.hitDiameter}px`,
  '--e-connector-stroke': `${CONNECTOR_NODE_METRICS.stroke}px`,
  '--e-connector-focus-ring': `${CONNECTOR_NODE_METRICS.focusRing}px`,
  // The one named height of the top bar. The bar's own layout and the floating
  // layer's top boundary both read it, so the barrier and the bar it protects
  // can never drift apart.
  '--e-topbar-height': '44px',
  '--e-shadow-lift': '0 2px 4px rgba(35,32,25,.08), 0 12px 30px rgba(35,32,25,.16)',
  '--e-z-canvas-chrome': '6',
  // Floating surfaces that must follow the canvas transform (the connection
  // editor) sit above every Card layer inside the viewport's own scale.
  '--e-z-canvas-floating': `${CANVAS_CARD_LAYER_CEILING + 1}`,
  '--e-z-lifted': '30',
  '--e-z-dock': '40',
  '--e-z-panel': '45',
  '--e-z-popover': '60',
  // The top bar is a hard barrier: it paints above every floating surface, so
  // no menu can bleed across it. Modals and toasts still cover the whole
  // window, so the barrier stays below them.
  '--e-z-chrome-barrier': '70',
  '--e-z-modal': '80',
  '--e-z-toast': '90',
  '--e-t-fast': '120ms',
  '--e-t-exit': `${DESIGN_TIMING_MS.exit}ms`,
  '--e-t-move': '220ms',
  '--e-t-move-far': '320ms',
  '--e-t-camera': '360ms',
  '--e-t-intent': `${DESIGN_TIMING_MS.intent}ms`,
  '--e-t-stream': '1s',
  '--e-t-fade': '120ms',
  '--e-t-reduced-fade': `${DESIGN_TIMING_MS.reducedFade}ms`,
  '--e-scale-press': '.97',
  '--e-scale-lift': '1.02',
  '--e-scale-grow': '1.35',
  '--e-ease-out': 'cubic-bezier(.25,.6,.25,1)',
  '--e-ease-in': 'cubic-bezier(.5,0,.75,.4)',
  '--e-ease-settle': 'cubic-bezier(.2,.75,.25,1.08)',
} as const)

export type DesignTokenName = keyof typeof LIGHT_TOKENS
export type DesignTokenMap = Readonly<Record<DesignTokenName, string>>

// THE NOTE TEXT STEPS. One numbered ladder, one home. A Note's `fontSize` is
// an index into this tuple and nothing else: no component may name a pixel
// size, and no second table may restate which step is which size.
//
// Steps 1 to 3 are, exactly, the sizes the retired Small / Medium / Large
// choices rendered, so every board that already exists keeps the look it was
// written with. Steps 4 to 6 are the range the three-name control could never
// express. There is deliberately no step below 1: 14px is already the floor at
// which Note body text stays readable on a canvas that also zooms out.
export const NOTE_FONT_STEP_TOKENS = Object.freeze([
  '--e-fs-prose-s',
  '--e-fs-prose-m',
  '--e-fs-prose-l',
  '--e-fs-prose-xl',
  '--e-fs-prose-2xl',
  '--e-fs-prose-3xl',
] as const satisfies readonly DesignTokenName[])

export const NOTE_FONT_STEP_MIN = 1
export const NOTE_FONT_STEP_MAX = NOTE_FONT_STEP_TOKENS.length
// A Note with no stored step reads at 2, which is what an unset Note has
// always rendered at (the retired 'medium').
export const NOTE_FONT_STEP_DEFAULT = 2

// What the retired names meant. Boards written before the ladder existed store
// these strings, and this is the only place that says what they become.
export const LEGACY_NOTE_FONT_STEPS = Object.freeze({
  small: 1,
  medium: 2,
  large: 3,
})

/**
 * The one reader for a stored Note text size. Accepts a current step, one of
 * the retired names, or anything at all; returns `undefined` for a value this
 * build cannot place, which every consumer renders as the default step. A
 * stored size is never a reason to fail a load.
 */
export function normalizeNoteFontStep(value: unknown): number | undefined {
  if (typeof value === 'string') {
    return Object.prototype.hasOwnProperty.call(LEGACY_NOTE_FONT_STEPS, value)
      ? LEGACY_NOTE_FONT_STEPS[value as keyof typeof LEGACY_NOTE_FONT_STEPS]
      : undefined
  }
  if (!Number.isInteger(value)) return undefined
  const step = value as number
  return step >= NOTE_FONT_STEP_MIN && step <= NOTE_FONT_STEP_MAX ? step : undefined
}

// The night ladder mirrors the LIGHT ladder's relationships to the Card anchor
// rather than inventing its own order. Each surface sits at the same perceptual
// distance (CIE L*) from Card that its light counterpart holds, so a Card reads
// as paper above a Panel in both modes, so the ladder law in §1.1 survives the
// theme instead of inverting at `panel`/`card` the way a hand-tuned night set did.
// Floating is the one deliberate departure: it takes a +6.0 L* step rather than
// light's +1.4, because the lift shadow does no separating work against darkness.
//
// Warmth is the brief's "one warm-gray family", carried into the night at
// a* ≈ +0.9 / b* ≈ +2.2, inside the light ladder's own b* range (2.15…6.03),
// far short of brown. For the neutral-graphite variant, substitute
// #161616 / #1b1b1b / #1e1e1e / #232323 / #282828 / #343434 at identical L*.
const DARK_TOKENS: DesignTokenMap = Object.freeze({
  ...LIGHT_TOKENS,
  '--e-surface-recessed': '#181512',
  '--e-surface-ground': '#1e1b19',
  '--e-surface-panel': '#25221f',
  '--e-surface-card': '#2b2725',
  '--e-surface-floating': '#383432',
  '--e-surface-field': '#211e1c',
  '--e-field-bg': '#211e1c',
  // At night an input rests as a well and hover lifts it one step. It must not
  // land on `floating`, or an input inside a popover vanishes into its host.
  '--e-field-hover': '#262321',
  // Warm near-black, never pure black (a hard ban): at .5 over the night ground
  // a pure-black veil composites to #0f0e0d.
  '--e-veil': 'rgba(20,17,12,.55)',
  '--e-veil-deep': 'rgba(20,17,12,.85)',
  '--e-ink': '#ece7db',
  '--e-ink-soft': '#b8b0a0',
  '--e-ink-faint': '#8b8375',
  '--e-line': 'rgba(236,231,219,.15)',
  // .28 measured 2.16–2.28:1 against the night ladder, under the 3:1 floor for
  // a non-text boundary, on the one theme where the border is a field's only edge.
  '--e-line-strong': 'rgba(236,231,219,.44)',
  '--e-dot': 'rgba(236,231,219,.25)',
  '--e-wash': 'rgba(236,231,219,.08)',
  '--e-grid-dot': 'rgba(236,231,219,.10)',
  '--e-pad-dot': 'rgba(236,231,219,.13)',
  '--e-go': '#4d9d84',
  '--e-go-ink': '#7fc4ab',
  // Danger must never be the quietest voice. At #d0684a avoid measured 4.06:1 on
  // Card and 3.38:1 on Floating: the weakest solid in the family, on the exact
  // surfaces (menus, confirms) where destructive actions live. Retuned to sit at
  // go's own lightness (L* 59.3), which lands it at go's contrast too.
  '--e-avoid': '#d77355',
  '--e-avoid-ink': '#ec9f85',
  '--e-mod': '#a68ae0',
  '--e-mod-ink': '#bfa8ee',
  '--e-convo': '#6d97e8',
  '--e-convo-ink': '#93b4f0',
  '--e-attention': '#e9a820',
  '--e-attention-ink': '#e3b458',
  '--e-agent-unadopted-accent': '#e3b458',
  // Semantic, never an alias of a surface (§1.3): it is night text cut into a
  // solid, so it keeps its own warm value and does not follow `ground`.
  '--e-on-solid': '#1d1a18',
  '--e-wash-base': '#2b2725',
  '--e-brand-green': '#4d9d84',
  '--e-brand-blue': '#6f9ce8',
  '--e-brand-amber': '#eca23b',
  '--e-hl-yellow': '#584518',
  // Separated from the orange dot, which it met at ΔE 15.5, confusable at the
  // 8px dot size the palette is actually read at. Now ΔE 26.3.
  '--e-hl-yellow-dot': '#e0c34e',
  '--e-hl-green': '#37522b',
  '--e-hl-green-dot': '#8bbf68',
  '--e-hl-blue': '#2b4562',
  '--e-hl-blue-dot': '#74a8e0',
  '--e-hl-pink': '#5c3049',
  '--e-hl-pink-dot': '#d585b4',
  '--e-hl-orange': '#5f3d1d',
  '--e-hl-orange-dot': '#dd9a50',
  '--e-hl-purple': '#443463',
  '--e-hl-purple-dot': '#a68ae0',
  '--e-hl-teal': '#1f4f47',
  '--e-hl-teal-dot': '#58b5a2',
  '--e-hl-red': '#5d2a25',
  '--e-hl-red-dot': '#d97a68',
  '--e-hl-brown': '#4a3a2b',
  '--e-hl-brown-dot': '#b08a62',
  '--e-hl-gray': '#3d3a33',
  '--e-hl-gray-dot': '#97907f',
  '--e-shadow-lift': '0 2px 4px rgba(10,8,6,.44), 0 12px 30px rgba(10,8,6,.58)',
})

export const DESIGN_TOKEN_NAMES = Object.freeze(
  Object.keys(LIGHT_TOKENS) as DesignTokenName[],
)

export const DESIGN_TOKENS: Readonly<Record<ThemeId, DesignTokenMap>> = Object.freeze({
  light: LIGHT_TOKENS,
  dark: DARK_TOKENS,
})

export const REDUCED_MOTION_TOKEN_OVERRIDES = Object.freeze({
  '--e-t-fast': '1ms',
  '--e-t-exit': '1ms',
  '--e-t-move': '1ms',
  '--e-t-move-far': '1ms',
  '--e-t-camera': '1ms',
  '--e-t-intent': '0ms',
  '--e-t-fade': `${DESIGN_TIMING_MS.reducedFade}ms`,
} satisfies Partial<DesignTokenMap>)

export function designTokensForTheme(theme: ThemeId): DesignTokenMap {
  return DESIGN_TOKENS[theme]
}

function renderTokenBlock(selector: string, theme: ThemeId): string {
  const declarations = DESIGN_TOKEN_NAMES.map(
    name => `  ${name}: ${DESIGN_TOKENS[theme][name]};`,
  )
  return `${selector} {\n  color-scheme: ${theme};\n${declarations.join('\n')}\n}`
}

function renderTokenOverrides(
  selector: string,
  overrides: Readonly<Partial<DesignTokenMap>>,
): string {
  const declarations = Object.entries(overrides).map(
    ([name, value]) => `  ${name}: ${value};`,
  )
  return `${selector} {\n${declarations.join('\n')}\n}`
}

export function renderDesignTokenCss(): string {
  return [
    renderTokenBlock(':root', 'light'),
    renderTokenBlock(':root[data-theme="dark"]', 'dark'),
    renderTokenOverrides(':root[data-reduced-motion="true"]', REDUCED_MOTION_TOKEN_OVERRIDES),
  ].join('\n\n') + '\n'
}

type PainterCardPalette = Readonly<{ fill: string; stroke: string }>

export type PainterPalette = Readonly<{
  cacheKey: `eido-design-tokens:v1:${ThemeId}:${string}`
  theme: ThemeId
  board: Readonly<{ fill: string; gridDot: string }>
  cards: Readonly<{
    note: PainterCardPalette
    ask: PainterCardPalette
    result: PainterCardPalette
    title: PainterCardPalette
    group: PainterCardPalette
    mod: PainterCardPalette
    conversation: PainterCardPalette
  }>
  connections: Readonly<{ helps: string; avoid: string; modifies: string }>
  selection: string
  hover: string
  agentUnadoptedAccent: string
  port: PainterCardPalette
  badge: PainterCardPalette
  label: Readonly<{ ink: string; softInk: string; halo: string }>
}>

/**
 * Value-complete painter identity. `cacheKey` remains part of the palette,
 * while serializing every role prevents a missed version bump from reusing a
 * stale painter frame or label bitmap.
 */
export function painterPaletteIdentity(palette: PainterPalette): string {
  return JSON.stringify(palette)
}

const PAINTER_IDENTITY_TOKEN_NAMES = [
  '--e-surface-ground',
  '--e-grid-dot',
  '--e-surface-card',
  '--e-line-strong',
  '--e-mod',
  '--e-convo',
  '--e-go',
  '--e-avoid',
  '--e-ink',
  '--e-ink-soft',
  '--e-agent-unadopted-accent',
] as const satisfies readonly DesignTokenName[]

function mixHex(foreground: string, background: string, foregroundWeight: number): string {
  const channel = (value: string, offset: number) => Number.parseInt(value.slice(offset, offset + 2), 16)
  const mixed = [1, 3, 5].map(offset =>
    Math.round(
      channel(foreground, offset) * foregroundWeight +
        channel(background, offset) * (1 - foregroundWeight),
    ),
  )
  return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

export function painterPaletteForTheme(theme: ThemeId): PainterPalette {
  const tokens = designTokensForTheme(theme)
  const painterIdentity = PAINTER_IDENTITY_TOKEN_NAMES.map(name => tokens[name]).join('|')
  const neutral = {
    fill: tokens['--e-surface-card'],
    stroke: tokens['--e-line-strong'],
  }

  return {
    cacheKey: `eido-design-tokens:v1:${theme}:${painterIdentity}`,
    theme,
    board: {
      fill: tokens['--e-surface-ground'],
      gridDot: tokens['--e-grid-dot'],
    },
    cards: {
      note: neutral,
      ask: neutral,
      result: neutral,
      title: neutral,
      group: neutral,
      mod: {
        fill: mixHex(tokens['--e-mod'], tokens['--e-surface-card'], 0.12),
        stroke: tokens['--e-mod'],
      },
      conversation: {
        fill: mixHex(tokens['--e-convo'], tokens['--e-surface-card'], 0.12),
        stroke: tokens['--e-convo'],
      },
    },
    connections: {
      helps: tokens['--e-go'],
      avoid: tokens['--e-avoid'],
      modifies: tokens['--e-mod'],
    },
    selection: tokens['--e-go'],
    hover: tokens['--e-go'],
    agentUnadoptedAccent: tokens['--e-agent-unadopted-accent'],
    port: {
      fill: tokens['--e-surface-ground'],
      stroke: tokens['--e-ink'],
    },
    badge: neutral,
    label: {
      ink: tokens['--e-ink'],
      softInk: tokens['--e-ink-soft'],
      halo: tokens['--e-surface-ground'],
    },
  }
}
