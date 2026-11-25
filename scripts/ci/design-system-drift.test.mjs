import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DESIGN_SYSTEM_EXEMPTIONS,
  scanDesignSystemFiles,
  validateDesignSystemExemptions,
} from './design-system-drift.mjs'

const file = (path, source) => ({ path, source })
const rules = (findings) => findings.map((finding) => finding.rule).sort()

const authoredCases = [
  {
    name: 'legacy class definitions and references',
    files: [file('src/styles/example.css', '.tb-btn { color: var(--e-ink); }\n.card .mini-btn {}')],
    expected: ['legacy-class', 'legacy-class'],
  },
  {
    name: 'native JSX select',
    files: [file('src/canvas/Example.tsx', 'export const Example = () => <select><option>A</option></select>')],
    expected: ['native-select'],
  },
  {
    name: 'native browser dialogs',
    files: [file('src/canvas/Example.tsx', 'window.confirm("Delete?"); window.prompt("Why?")')],
    expected: ['native-dialog', 'native-dialog'],
  },
  {
    name: 'raw CSS and TS colours',
    files: [
      file('src/styles/example.css', '.card { color: #fff; background: rgba(1, 2, 3, .4); }'),
      file('src/canvas/Example.tsx', 'const paint = "#1a2b3c"'),
    ],
    expected: ['raw-colour', 'raw-colour', 'raw-colour'],
  },
  {
    name: 'raw colours in ordinary production TypeScript modules',
    files: [file('src/canvas/paintedOverlay.ts', "export const overlayInk = '#1a2b3c'")],
    expected: ['raw-colour'],
  },
  {
    name: 'numeric issue references remain prose while colour contexts stay gated',
    files: [
      file(
        'src/performance/evidence.ts',
        `const prose = 'See #402'
         const exactColour = '#402'
         const textColour = 'color:#402'
         const shadowColour = 'box-shadow:#000'`,
      ),
    ],
    expected: ['raw-colour', 'raw-colour', 'raw-colour'],
  },
  {
    name: 'off-ladder authored values',
    files: [file('src/styles/example.css', '.card { border-radius: 5px; font-size: 17px; gap: 13px; }')],
    expected: ['off-ladder-design-value', 'off-ladder-design-value', 'off-ladder-design-value'],
  },
  {
    name: 'alternate literal forms cannot hide authored design drift',
    files: [
      file(
        'src/styles/example.css',
        '.card { gap: 3px; padding: calc(var(--e-sp-2) + 13px); }',
      ),
      file('src/canvas/paintedOverlay.ts', 'const border = "1px solid #fff"'),
      file('src/canvas/Example.tsx', 'const style = { fontSize: 17 }'),
    ],
    expected: [
      'off-ladder-design-value',
      'off-ladder-design-value',
      'off-ladder-design-value',
      'raw-colour',
    ],
  },
  {
    name: 'obsolete non-Eido custom properties',
    files: [file('src/styles/example.css', ':root { --paper: white; } .card { color: var(--paper); }')],
    expected: ['obsolete-custom-property', 'obsolete-custom-property'],
  },
  {
    name: 'forbidden SaaS copy',
    files: [file('src/shared/words.ts', "export const words = { hint: 'Configure your workspace seamlessly.' }")],
    expected: ['forbidden-copy', 'forbidden-copy', 'forbidden-copy'],
  },
  {
    name: 'running ellipses',
    files: [file('src/shared/words.ts', "export const words = { running: 'Running…', writing: 'Writing...' }")],
    expected: ['running-ellipsis', 'running-ellipsis'],
  },
  {
    name: 'obsolete context-panel prose',
    files: [file('src/shared/words.ts', "export const words = { peekIntro: 'This shows what this Ask will see.' }")],
    expected: ['obsolete-context-prose'],
  },
  {
    name: 'semantic and on-ladder authored values',
    files: [
      file(
        'src/styles/example.css',
        '.card { color: var(--e-ink); border-radius: var(--e-r-card); gap: var(--e-sp-2); font-size: 14px; }',
      ),
    ],
    expected: [],
  },
  {
    name: 'BEM modifiers followed by pseudo-classes are not custom properties',
    files: [file('src/styles/example.css', '.e-button--primary:hover { color: var(--e-ink); }')],
    expected: [],
  },
  {
    name: 'unitless runtime ratios are not authored spacing values',
    files: [
      file(
        'src/canvas/Example.tsx',
        'export const Example = () => <Board fitViewOptions={{ padding: 0.15 }} />',
      ),
    ],
    expected: [],
  },
  {
    name: 'zero-delay motion remains an approved semantic absence',
    files: [file('src/styles/example.css', '.card { transition-delay: 0ms; }')],
    expected: [],
  },
  {
    name: 'canonical token values are owned by the token authority',
    files: [file('src/ui/tokens.ts', "export const tokens = { '--e-ink': '#232019' }")],
    expected: [],
  },
  {
    name: 'user colour data remains data',
    files: [file('src/ui/cardIdentity.ts', "export const identity = { solid: '#2e2b25' }")],
    expected: [],
  },
  {
    name: 'individually named synthetic performance fixtures remain fixture data',
    files: [file('src/graph/perfFixtures.ts', "export const card = { headerColor: '#f6d365' }")],
    expected: [],
  },
  {
    name: 'individually named React Flow properties remain externally owned',
    files: [
      file(
        'src/styles/020-board.css',
        '.board { --xy-background-color: var(--e-surface-ground); color: var(--xy-background-color); }',
      ),
    ],
    expected: [],
  },
  {
    name: 'individually named identity derivations remain user-colour data',
    files: [
      file(
        'src/styles/040-cards-prose.css',
        '.card { color: var(--identity-body-ink); }',
      ),
    ],
    expected: [],
  },
]

for (const fixture of authoredCases) {
  test(`authored gate: ${fixture.name}`, () => {
    assert.deepEqual(rules(scanDesignSystemFiles(fixture.files)), fixture.expected.sort())
  })
}

test('CSS geometry owners exempt only their exact normalized selectors', () => {
  const findings = scanDesignSystemFiles([
    file(
      'src/styles/041-prose.css',
      `.markdown-card-editor-content table > tbody > tr > :nth-child(2):not([data-tool-cell='true']) {
        padding-left: calc(0.6em + 0.5px);
      }
      .other-prose { padding-left: calc(0.6em + 0.5px); }`,
    ),
    file(
      'src/styles/090-dock.css',
      `.tool-divider { margin: 3px; }
      .other-divider { margin: 3px; }`,
    ),
  ])

  assert.deepEqual(
    findings.map(({ path, rule, symbol }) => ({ path, rule, symbol })),
    [
      {
        path: 'src/styles/041-prose.css',
        rule: 'off-ladder-design-value',
        symbol: '.other-prose',
      },
      {
        path: 'src/styles/090-dock.css',
        rule: 'off-ladder-design-value',
        symbol: '.other-divider',
      },
    ],
  )
})

test('ordinary production TypeScript modules reject authored style and custom-property drift', () => {
  const findings = scanDesignSystemFiles([
    file(
      'src/canvas/paintedOverlay.ts',
      `export function paintOverlay() {
        const overlayStyle = { fontSize: 17, gap: 13, color: 'var(--paper)' }
        return overlayStyle
      }`,
    ),
  ])

  assert.deepEqual(
    findings.map(({ rule, symbol }) => ({ rule, symbol })),
    [
      { rule: 'off-ladder-design-value', symbol: 'paintOverlay' },
      { rule: 'off-ladder-design-value', symbol: 'paintOverlay' },
      { rule: 'obsolete-custom-property', symbol: '--paper' },
    ],
  )
})

test('canvas geometry exemptions cover only their exact owner symbol', () => {
  const owners = [
    ['src/canvas/zoomChrome.ts', 'paintedPortGeometry'],
    ['src/canvas/zoomChrome.ts', 'paintedBadgeRadius'],
    ['src/canvas/zoomChrome.ts', 'paintedConnectionBadgeGeometry'],
    ['src/canvas/boardScene.ts', 'planPaintedConnections'],
    ['src/canvas/connectionBadgeHit.ts', 'connectionBadgePaintedAtIndex'],
  ]

  for (const [path, owner] of owners) {
    const findings = scanDesignSystemFiles([
      file(
        path,
        `export function ${owner}() {
          const ownerStyle = { gap: 13 }
          return ownerStyle
        }
        export function sameFileDrift() {
          const driftStyle = { gap: 13 }
          return driftStyle
        }`,
      ),
    ])

    assert.deepEqual(
      findings.map(({ rule, symbol }) => ({ rule, symbol })),
      [{ rule: 'off-ladder-design-value', symbol: 'sameFileDrift' }],
      `${path}#${owner}`,
    )
  }
})

test('persisted image flatten colour exempts only its exact policy field', () => {
  const findings = scanDesignSystemFiles([
    file(
      'src/shared/imageCompression.ts',
      `export const IMAGE_COMPRESSION_POLICY = {
        flattenBackground: '#ffffff',
        diagnosticBorder: '#1a2b3c',
      } as const`,
    ),
  ])

  assert.deepEqual(
    findings.map(({ rule, symbol }) => ({ rule, symbol })),
    [{ rule: 'raw-colour', symbol: 'IMAGE_COMPRESSION_POLICY.diagnosticBorder' }],
  )
})

const escapedTemplateChip = "<Chip>{`\\${name} review`}</Chip>"

const chipCases = [
  {
    name: 'literal labels are one word apart from the exact This card exception',
    words: "export const words = { good: 'Saved' }",
    component: `<>
      <Chip>Saved</Chip>
      <Chip>This card</Chip>
      <Chip>Needs review</Chip>
      <Chip>{'Saved'}</Chip>
      <Chip>{'This card'}</Chip>
      <Chip>{'Needs review'}</Chip>
      <Chip>{'This\\u0020card'}</Chip>
      <Chip>{'Needs\\u0020review'}</Chip>
      <Chip>{\`This
card\`}</Chip>
      <Chip>{\`Needs
review\`}</Chip>
      ${escapedTemplateChip}
    </>`,
    expected: [
      { rule: 'multiword-chip', symbol: 'Chip' },
      { rule: 'multiword-chip', symbol: 'Chip' },
      { rule: 'multiword-chip', symbol: 'Chip' },
      { rule: 'multiword-chip', symbol: 'Chip' },
      { rule: 'multiword-chip', symbol: 'Chip' },
    ],
  },
  {
    name: 'direct words references resolve while genuinely dynamic content stays dynamic',
    words: `export const words = {
      good: 'Saved',
      allowed: 'This card',
      bad: 'Needs review',
      escapedAllowed: 'This\\u0020card',
      escapedBad: 'Needs\\u0020review',
      dynamic: 'Needs review' + userLabel,
    }`,
    component: `<>
      <Chip>{words.good}</Chip>
      <Chip>{words.allowed}</Chip>
      <Chip>{words.bad}</Chip>
      <Chip>{words.escapedAllowed}</Chip>
      <Chip>{words.escapedBad}</Chip>
      <Chip>{words.dynamic}</Chip>
      <Chip>{userLabel}</Chip>
      <Chip>{item.label || words.bad}</Chip>
      <Chip>{\`\${userLabel} review\`}</Chip>
      <Chip>{'Needs ' + userLabel + 'review'}</Chip>
    </>`,
    expected: [
      { rule: 'multiword-chip', symbol: 'words.bad' },
      { rule: 'multiword-chip', symbol: 'words.escapedBad' },
    ],
  },
]

for (const fixture of chipCases) {
  test(`Chip copy gate: ${fixture.name}`, () => {
    const findings = scanDesignSystemFiles([
      file('src/shared/words.ts', fixture.words),
      file('src/canvas/Example.tsx', `export const Example = () => (${fixture.component})`),
    ])

    assert.deepEqual(findings.map(({ rule, symbol }) => ({ rule, symbol })), fixture.expected)
  })
}

const conformingPrototype = String.raw`
  <style>
    .e-wire-hit { fill: none; stroke: transparent; stroke-width: 28; pointer-events: stroke; }
    .e-card { min-width: 200px; min-height: 120px; }
    .e-card.fixed-height .e-card-body { overflow-y: auto; }
  </style>
  <p id="picker-uses">Picker uses: Ask model, Conversation style, Group model, and playback speed.</p>
  <div class="plate-label t-micro">Playback transport</div>
  <div class="e-picker compact" aria-label="Playback speed"></div>
  <script>
    w = Math.max(200, w);
    hh = Math.max(120, hh);
  </script>
`

const referenceCases = [
  { name: 'all four contracts', source: conformingPrototype, expected: [] },
  {
    name: '28px whole-wire hit width',
    source: conformingPrototype.replace('stroke-width: 28', 'stroke-width: 16'),
    expected: ['reference-whole-wire-hit'],
  },
  {
    name: '200 by 120 fixed-height scrolling',
    source: conformingPrototype.replaceAll('200', '170').replace('overflow-y: auto', 'overflow: visible'),
    expected: ['reference-card-resize'],
  },
  {
    name: 'stale approval copy is absent',
    source: `${conformingPrototype}<h2>Function changes for your approval</h2><p>Nothing here is settled.</p>`,
    expected: ['reference-stale-approval-copy', 'reference-stale-approval-copy'],
  },
  {
    name: 'the picker-uses note names all four current Picker consumers',
    source: conformingPrototype.replace('Group model, and playback speed', 'Settings model'),
    expected: ['reference-picker-inventory'],
  },
  {
    name: 'playback speed renders as Picker',
    source: conformingPrototype.replace('e-picker compact', 'e-seg'),
    expected: ['reference-playback-picker'],
  },
]

for (const fixture of referenceCases) {
  test(`reference gate: ${fixture.name}`, () => {
    const findings = scanDesignSystemFiles([
      file('docs/design/design-system/eido-design-system.html', fixture.source),
    ])
    assert.deepEqual(rules(findings), fixture.expected.sort())
  })
}

test('every exemption is narrow and carries its rule, owner, and reason', () => {
  assert.doesNotThrow(() => validateDesignSystemExemptions(DESIGN_SYSTEM_EXEMPTIONS))
  assert.throws(
    () => validateDesignSystemExemptions([{
      category: 'user-colour-data',
      rule: 'raw-colour',
      path: 'src/**',
      owner: '',
      reason: '',
    }]),
    /exact path|owner|reason/,
  )
})
