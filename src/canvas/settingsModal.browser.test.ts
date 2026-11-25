import { expect, test, type Page } from '@playwright/test'

type DevWindow = {
  __eido?: { getState: () => { hydrated: boolean } }
}

async function openBoardSettings(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated)
  })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Board', exact: true }).click()
  return dialog
}

test('Board settings uses comfortable selectors that release a cancelled drag', async ({ page }) => {
  const dialog = await openBoardSettings(page)
  const nav = dialog.getByRole('navigation', { name: 'Settings categories' })
  await expect(nav.getByRole('button')).toHaveCount(4)
  await expect(nav.getByText('Context', { exact: true })).toBeVisible()
  await expect(nav.getByText('AI Models', { exact: true })).toBeVisible()
  await expect(nav.getByText('Board', { exact: true })).toBeVisible()
  await expect(nav.getByText('Privacy', { exact: true })).toBeVisible()
  await expect(nav.locator('small')).toHaveCount(0)

  const selector = dialog.getByRole('radiogroup', { name: 'Theme' })
  const light = selector.getByRole('radio', { name: 'Light' })
  const dark = selector.getByRole('radio', { name: 'Dark' })
  const system = selector.getByRole('radio', { name: 'System' })
  await expect(selector).toHaveCSS('min-height', '52px')
  await expect(light).toHaveCSS('height', '48px')

  await light.click()
  const selectedColor = await light.evaluate(element => getComputedStyle(element).color)
  await light.hover()
  await expect(light).toHaveCSS('color', selectedColor)

  const lightBox = await light.boundingBox()
  const darkBox = await dark.boundingBox()
  const systemBox = await system.boundingBox()
  if (!lightBox || !darkBox || !systemBox) throw new Error('Theme selector did not lay out')
  await page.mouse.move(lightBox.x + lightBox.width / 2, lightBox.y + lightBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(darkBox.x + darkBox.width / 2, darkBox.y + darkBox.height / 2)
  await expect(dark).toHaveAttribute('aria-checked', 'true')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.move(systemBox.x + systemBox.width / 2, systemBox.y + systemBox.height / 2)
  await page.mouse.up()
  await expect(dark).toHaveAttribute('aria-checked', 'true')
  await expect(system).toHaveAttribute('aria-checked', 'false')
})
