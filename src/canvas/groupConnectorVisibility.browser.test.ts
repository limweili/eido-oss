import { expect, test, type Page } from '@playwright/test'

type DevWindow = {
  __eido?: {
    getState: () => {
      hydrated: boolean
      selection: { kind: string; id: string } | null
    }
    setState: (state: unknown) => void
  }
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedColouredGroupWithConnection(page: Page, zoom = 1) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'member-note',
          kind: 'note',
          title: 'Connected note',
          blocks: [{ id: 'member-note-block', text: 'The connection must remain visible.' }],
          position: { x: 360, y: 230 },
          size: { width: 240, height: 150 },
          groupId: 'coloured-group',
        },
        {
          id: 'member-ask',
          kind: 'askAi',
          title: 'Connected Ask',
          blocks: [{ id: 'member-ask-block', text: 'Use the note.' }],
          position: { x: 760, y: 230 },
          size: { width: 240, height: 150 },
          groupId: 'coloured-group',
        },
        {
          id: 'coloured-group',
          kind: 'group',
          title: 'Visible connection',
          blocks: [],
          position: { x: 280, y: 180 },
          size: { width: 800, height: 260 },
          headerColor: '#3568c6',
          headerFill: 'full',
        },
      ],
      connections: [
        {
          id: 'member-connection',
          from: { cardId: 'member-note' },
          to: { cardId: 'member-ask' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: { kind: 'card', id: 'coloured-group' },
      selectedCardIds: ['coloured-group'],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
      visualDecayEnabled: false,
    })
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 3)
  await page.evaluate((targetZoom) => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: targetZoom })
  }, zoom)
  await page.waitForTimeout(300)
}

async function screenshotPixelsAround(
  page: Page,
  point: { x: number; y: number },
  radius: number,
) {
  const screenshot = await page.screenshot()
  return page.evaluate(async ({ src, point, radius }) => {
    const image = new Image()
    image.src = src
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Missing screenshot sample context')
    context.drawImage(image, 0, 0)
    const samples: Array<[number, number, number]> = []
    for (let y = Math.floor(point.y) - radius; y <= Math.ceil(point.y) + radius; y += 1) {
      for (let x = Math.floor(point.x) - radius; x <= Math.ceil(point.x) + radius; x += 1) {
        const pixel = context.getImageData(x, y, 1, 1).data
        samples.push([pixel[0]!, pixel[1]!, pixel[2]!])
      }
    }
    return samples
  }, {
    src: `data:image/png;base64,${screenshot.toString('base64')}`,
    point,
    radius,
  })
}

test('a coloured Group stays behind the connection between its member Cards', async ({ page }) => {
  await seedColouredGroupWithConnection(page)

  const line = await page.evaluate(() => {
    const edge = document.querySelector<SVGPathElement>(
      '.react-flow__edge[data-id="member-connection"] path.connection-line',
    )
    if (!edge) throw new Error('Missing member connection')
    const linePoint = edge.getPointAtLength(edge.getTotalLength() / 4).matrixTransform(edge.getScreenCTM()!)
    const stroke = getComputedStyle(edge).stroke.match(/\d+/g)?.map(Number)
    return {
      point: { x: linePoint.x, y: linePoint.y },
      stroke: [stroke?.[0] ?? 0, stroke?.[1] ?? 0, stroke?.[2] ?? 0] as [number, number, number],
      groupZIndex: getComputedStyle(
        document.querySelector('.react-flow__node[data-id="coloured-group"]')!,
      ).zIndex,
      edgeZIndex: getComputedStyle(edge.closest('.react-flow__edge')!).zIndex,
    }
  })
  const pixels = await screenshotPixelsAround(page, line.point, 2)
  const containsConnectionStroke = pixels.some((pixel) => (
    Math.abs(pixel[0] - line.stroke[0]) +
    Math.abs(pixel[1] - line.stroke[1]) +
    Math.abs(pixel[2] - line.stroke[2])
  ) < 45)
  expect(containsConnectionStroke, JSON.stringify({ line, pixels })).toBe(true)

  const edge = page.locator(
    '.react-flow__edge[data-id="member-connection"] path.connection-line',
  )
  const point = await edge.evaluate((element) => {
    const path = element as SVGPathElement
    const linePoint = path.getPointAtLength(path.getTotalLength() / 4).matrixTransform(path.getScreenCTM()!)
    return { x: linePoint.x, y: linePoint.y }
  })
  await page.mouse.click(point.x, point.y)
  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().selection
  })).toEqual({ kind: 'connection', id: 'member-connection' })

  // Moving the Group behind the connection paint plane must not make its
  // interactive chrome inert.
  await page
    .locator('.react-flow__node[data-id="coloured-group"]')
    .getByRole('button', { name: 'Details' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Group details' })).toBeVisible()
})

test('a coloured Group stays behind its member connection in the canvas-painted Map', async ({
  page,
}) => {
  await seedColouredGroupWithConnection(page, 0.15)
  const canvas = page.locator('canvas[data-board-overview-layer]')
  await expect.poll(() => canvas.getAttribute('data-representation')).toBe('map')
  await expect.poll(() => canvas.getAttribute('data-rendered-connection-count')).toBe('1')

  const sample = await page.evaluate(() => {
    const root = document.querySelector('.react-flow')?.getBoundingClientRect()
    const style = getComputedStyle(document.documentElement)
    if (!root) throw new Error('Missing board pane')
    const parser = document.createElement('canvas')
    parser.width = 1
    parser.height = 1
    const parserContext = parser.getContext('2d')
    if (!parserContext) throw new Error('Missing colour parser')
    parserContext.fillStyle = style.getPropertyValue('--e-go').trim()
    parserContext.fillRect(0, 0, 1, 1)
    const expected = parserContext.getImageData(0, 0, 1, 1).data
    return {
      point: {
        // Sample the wire inside the Group wash, before its midpoint badge.
        x: root.left + 640 * 0.15,
        y: root.top + 305 * 0.15,
      },
      stroke: [expected[0]!, expected[1]!, expected[2]!] as [number, number, number],
    }
  })
  const pixels = await screenshotPixelsAround(page, sample.point, 2)
  expect(
    pixels.some((pixel) => (
      Math.abs(pixel[0] - sample.stroke[0]) +
      Math.abs(pixel[1] - sample.stroke[1]) +
      Math.abs(pixel[2] - sample.stroke[2])
    ) < 45),
    JSON.stringify({ sample, pixels }),
  ).toBe(true)
})

test('a coloured Group and its member Cards keep their connector nodes above the Group wash', async ({
  page,
}) => {
  await seedColouredGroupWithConnection(page)

  for (const cardId of ['coloured-group', 'member-note', 'member-ask']) {
    const card = page.locator(`.react-flow__node[data-id="${cardId}"]`)
    await expect(card).toBeVisible()
    for (const side of ['left', 'right'] as const) {
      const connector = card.locator(`.react-flow__handle-${side}`)
      await expect(connector).toBeVisible()
      const connectorOwnsPixels = await connector.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const topmost = document.elementsFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        )[0]
        return topmost === element || element.contains(topmost ?? null)
      })
      expect(connectorOwnsPixels, `${cardId} ${side} connector is covered`).toBe(true)
    }
  }
})
