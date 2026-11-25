import { expect, test } from '@playwright/test'

const fixturePath = '/src/ui/overlays/overlay-fixture.html'

test('nested overlays keep one keyboard owner and exact focus return', async ({ page }) => {
  await page.goto(fixturePath)
  const appRoot = page.locator('#root')
  const invoker = page.getByRole('button', { name: 'Open parent' })
  await invoker.click()

  const parent = page.getByRole('dialog', { name: 'Parent dialog' })
  const parentBackdrop = page.locator('.e-overlay-backdrop').first()
  const openChild = page.getByRole('button', { name: 'Open child' })
  await expect(parent).toBeVisible()
  await expect(openChild).toBeFocused()
  await expect(appRoot).toHaveAttribute('inert', '')
  await expect(page.locator('#eido-overlay-root')).toHaveCount(1)

  const visual = await parent.evaluate((element) => {
    const styles = getComputedStyle(element)
    const tokens = getComputedStyle(document.documentElement)
    const colorProbe = document.createElement('span')
    colorProbe.style.backgroundColor = 'var(--e-surface-panel)'
    document.body.append(colorProbe)
    const expectedBackground = getComputedStyle(colorProbe).backgroundColor
    colorProbe.remove()
    return {
      background: styles.backgroundColor,
      expectedBackground,
      radius: styles.borderRadius,
      expectedRadius: tokens.getPropertyValue('--e-r-modal').trim(),
      shadow: styles.boxShadow,
    }
  })
  expect(visual.background).toBe(visual.expectedBackground)
  expect(visual.radius).toBe(visual.expectedRadius)
  expect(visual.shadow).not.toBe('none')

  await parent.locator('..').click({ position: { x: 4, y: 4 } })
  await expect(parent).toBeVisible()
  await openChild.click()

  const child = page.getByRole('dialog', { name: 'Child dialog' })
  await expect(page.locator('[role="dialog"]')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Child action' })).toBeFocused()
  await expect(parentBackdrop).toHaveAttribute('inert', '')

  await page.keyboard.press('Escape')
  await expect(child).toHaveCount(0)
  await expect(parent).toBeVisible()
  await expect(openChild).toBeFocused()

  const close = parent.getByRole('button', { name: 'Close' })
  const last = parent.getByRole('button', { name: 'Last parent action' })
  await last.focus()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(last).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(parent).toHaveCount(0)
  await expect(invoker).toBeFocused()
  await expect(appRoot).not.toHaveAttribute('inert', '')
})

test('dialogs serialize, preserve prompt text, and cancel explicitly', async ({ page }) => {
  await page.goto(fixturePath)
  const run = page.getByRole('button', { name: 'Run dialogs' })
  await run.click()

  await expect(page.getByRole('dialog', { name: 'Delete fixture card?' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Why stop here?' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.getByRole('button', { name: 'Delete card' }).click()

  const prompt = page.getByRole('dialog', { name: 'Why stop here?' })
  const field = prompt.getByRole('textbox', { name: 'Reason' })
  await expect(prompt).toBeVisible()
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('  first draft  ')
  await field.fill('  keep both spaces  ')
  await page.getByRole('button', { name: 'Keep reason' }).click()
  await expect.poll(async () =>
    page.getByRole('status', { name: 'Dialog outcome' }).evaluate(element => element.textContent),
  ).toBe('fixture-card|true|  keep both spaces  ')
  await expect(run).toBeFocused()

  await run.click()
  await expect(page.getByRole('dialog', { name: 'Delete fixture card?' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(prompt).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(async () =>
    page.getByRole('status', { name: 'Dialog outcome' }).evaluate(element => element.textContent),
  ).toBe('fixture-card|false|cancelled')
})

test('provider teardown settles active and queued requests under StrictMode', async ({ page }) => {
  await page.goto(fixturePath)
  await page.getByRole('button', { name: 'Unmount provider' }).click()

  await expect(page.getByRole('status', { name: 'Provider unmount outcome' }))
    .toHaveText('false|cancelled')
  await expect(page.locator('#eido-overlay-root')).toHaveCount(0)
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '')
})

test('modal floating controls stay above their owner and inherit nested inert ordering', async ({ page }) => {
  await page.goto(fixturePath)
  await page.getByRole('button', { name: 'Open parent' }).click()

  const parentBackdrop = page.locator('.e-overlay-backdrop').first()
  await page.getByRole('combobox', { name: 'Modal picker' }).click()
  const picker = page.getByRole('listbox', { name: 'Modal picker' })
  await expect(parentBackdrop.getByRole('listbox', { name: 'Modal picker' })).toHaveCount(1)
  await picker.getByRole('option', { name: 'Light' }).click()
  await expect(page.locator('output[aria-label="Picker outcome"]')).toHaveText('light')

  await page.getByRole('button', { name: 'Modal help' }).hover()
  const tooltip = page.getByRole('tooltip', { name: 'Modal floating help' })
  await expect(tooltip).toBeVisible()
  await expect(parentBackdrop.getByRole('tooltip', { name: 'Modal floating help' }))
    .toHaveCount(1)
  await page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)

  await page.getByRole('button', { name: 'Modal menu' }).click()
  const parentMenu = page.getByRole('menu', { name: 'Modal menu actions' })
  await expect(parentBackdrop.getByRole('menu', { name: 'Modal menu actions' })).toHaveCount(1)
  await parentMenu.getByRole('menuitem', { name: 'Open child from menu' }).click()

  const childBackdrop = page.locator('.e-overlay-backdrop').nth(1)
  await expect(page.getByRole('dialog', { name: 'Child dialog' })).toBeVisible()
  await expect(parentBackdrop).toHaveAttribute('inert', '')
  await expect(parentBackdrop.locator('.e-popover')).toHaveCount(1)

  await page.getByRole('button', { name: 'Child menu' }).click()
  const childMenu = page.getByRole('menu', { name: 'Child menu actions' })
  await expect(childBackdrop.getByRole('menu', { name: 'Child menu actions' })).toHaveCount(1)
  const confirmInvoker = childMenu.getByRole('menuitem', { name: 'Open confirm from menu' })
  await confirmInvoker.click()

  await expect(page.getByRole('dialog', { name: 'Confirm above child?' })).toBeVisible()
  await expect(childBackdrop).toHaveAttribute('inert', '')
  await expect(childBackdrop.locator('.e-popover')).toHaveCount(1)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog', { name: 'Confirm above child?' })).toHaveCount(0)
  await expect(confirmInvoker).toBeFocused()
})
