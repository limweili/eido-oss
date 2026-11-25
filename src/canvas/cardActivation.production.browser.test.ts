import { expect, test } from '@playwright/test'

test('activating a full-detail Markdown card keeps the Board usable in production', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')

  const ask = page.locator('.react-flow__node-askAi[data-id="production-ask"]')
  await expect(ask).toBeVisible()
  await ask.locator('.note-render').click()

  await expect(ask.getByRole('textbox')).toBeEditable()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  expect(pageErrors).toEqual([])
})
