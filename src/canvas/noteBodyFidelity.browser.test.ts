import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// #207 — a note card shows as much of its text as its size allows.
// Half 1: a user-resized (explicit height) card renders its FULL body when
// passive; the 1200-char cap only protects auto-sized cards.
// Half 2: a focused editor grows when its content outgrows the current height
// instead of clipping inside the editing surface. Focus stability has companion
// coverage in cardEditing.browser.test.ts ("keep focus while typing").

const LONG_TEXT = `${Array.from(
  { length: 60 },
  (_, i) => `line ${i + 1} — the quick brown fox jumps over the lazy dog`,
).join('\n')}\nTHE END MARKER`

async function editorClipping(page: Page) {
  return page
    .locator('.react-flow__node-note .note-render[contenteditable="true"]')
    .evaluate((el) => el.scrollHeight - el.clientHeight)
}

test('resized note shows full text passively and its editor grows while focused', async ({ page }) => {
  test.slow()
  expect(LONG_TEXT.length).toBeGreaterThan(1200)

  await page.goto('/')
  await page.locator('.bottom-dock').getByRole('button', { name: 'Add note' }).click()

  const node = page.locator('.react-flow__node-note').last()
  await node.waitFor({ state: 'visible' })
  const cardId = await node.getAttribute('data-id')
  expect(cardId).toBeTruthy()

  // Enter editing and paste long text WHILE FOCUSED — the red path for the
  // stale-height clip: useAutoGrow used to skip focused editors entirely.
  await node.locator('.note-render').click()
  const editor = node.locator('.note-render[contenteditable="true"]')
  await editor.waitFor({ state: 'visible' })
  await expect(editor).toBeFocused()
  await editor.fill(LONG_TEXT)
  await expect(editor).toHaveText(LONG_TEXT, { useInnerText: true })

  // Growth-only write while focused: nothing hidden inside the textarea.
  await expect.poll(() => editorClipping(page)).toBeLessThanOrEqual(1)
  await expect(editor).toBeFocused()

  // Give the card an explicit user height (what the resize handle commits),
  // shorter than the content so the body must scroll.
  await page.evaluate(
    ({ id }) => {
      const devWindow = window as unknown as {
        __eido: {
          getState: () => {
            setCardSize: (
              id: string,
              size: { width: number; height: number },
              options?: { recordHistory?: boolean },
            ) => void
          }
        }
      }
      devWindow.__eido.getState().setCardSize(id, { width: 340, height: 420 })
    },
    { id: cardId! },
  )
  await expect(node.locator('.card.fixed-h')).toBeVisible()
  // The width change re-wraps text; the resize-end re-measure (150ms settle)
  // is growth-only while focused and must leave the editor un-clipped.
  await page.waitForTimeout(400)
  await expect.poll(() => editorClipping(page)).toBeLessThanOrEqual(1)

  // Deselect → passive render of a fixed-height card shows the FULL body,
  // not the 1200-char capped preview with a "..." tail.
  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  const render = node.locator('.note-render')
  await render.waitFor({ state: 'visible' })
  await expect(render).toContainText('THE END MARKER')
  const passiveText = await render.evaluate((el) => el.textContent ?? '')
  expect(passiveText.trimEnd().endsWith('...')).toBe(false)
  expect(passiveText.length).toBeGreaterThan(1200)

  // Reselect → the editor immediately holds the whole body (text beyond the
  // first viewport is reachable by scrolling, nothing clipped away).
  await render.click()
  await editor.waitFor({ state: 'visible' })
  await expect(editor).toBeFocused()
  await expect(editor).toHaveText(LONG_TEXT, { useInnerText: true })
  await expect.poll(() => editorClipping(page)).toBeLessThanOrEqual(1)
  const bodyScrollable = await node
    .locator('.note-body')
    .evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(bodyScrollable).toBe(true)
})
