// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { readStylesheetCascade } from './readStylesheetCascade.test-helper'

const appChromeCss = readFileSync('src/styles/010-app-chrome.css', 'utf8')
const stylesheetCascade = readStylesheetCascade()

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('top-bar save-state token grammar', () => {
  it.each([
    { name: 'Saving', classes: [], expected: 'var(--e-ink-soft)' },
    { name: 'Saved', classes: [], expected: 'var(--e-ink-soft)' },
    { name: 'Saved in browser', classes: ['browser'], expected: 'var(--e-ink-soft)' },
    { name: 'Saved', classes: [], expected: 'var(--e-ink-soft)' },
    { name: "Couldn't save to disk", classes: ['failed'], expected: 'var(--e-avoid-ink)' },
    { name: "Couldn't save in browser", classes: ['failed', 'browser'], expected: 'var(--e-avoid-ink)' },
  ])('keeps $name on its system token', ({ classes, expected }) => {
    const style = document.createElement('style')
    style.textContent = appChromeCss
    document.head.append(style)

    const status = document.createElement('span')
    status.classList.add('save-state', ...classes)
    document.body.append(status)

    expect(getComputedStyle(status).color).toBe(expected)
  })
})

describe('top-bar type roles', () => {
  it('keeps the Idea noun in UI sentence case and action verbs engraved', () => {
    const ideaRule = appChromeCss.match(/\.idea-pill\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(ideaRule).not.toBe('')
    expect(ideaRule).not.toMatch(
      /\b(?:font-size|font-weight|line-height|letter-spacing|text-transform)\s*:/,
    )

    const style = document.createElement('style')
    style.textContent = stylesheetCascade
    document.head.append(style)

    const idea = document.createElement('button')
    idea.className = 'e-button t-ui e-button--compact idea-pill'
    idea.textContent = 'Bakery — winter opening'

    const action = document.createElement('button')
    action.className = 'e-button t-label e-button--ghost e-button--compact topbar-action'
    action.textContent = 'Highlights'

    document.body.append(idea, action)

    const typeRole = (element: HTMLElement) => {
      const styles = getComputedStyle(element)
      return {
        fontFamily: styles.fontFamily,
        fontFeatureSettings: styles.fontFeatureSettings,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
        letterSpacing: styles.letterSpacing,
        lineHeight: styles.lineHeight,
        textTransform: styles.textTransform,
      }
    }

    expect(typeRole(idea)).toEqual({
      fontFamily: 'var(--e-mono)',
      fontFeatureSettings: '"calt" 0',
      fontSize: 'var(--e-fs-ui)',
      fontWeight: '400',
      letterSpacing: 'normal',
      lineHeight: '1.4',
      textTransform: 'none',
    })
    expect(typeRole(action)).toEqual({
      fontFamily: 'var(--e-mono)',
      fontFeatureSettings: '"calt" 0',
      fontSize: 'var(--e-fs-label)',
      fontWeight: '500',
      letterSpacing: '0.06em',
      lineHeight: '1.2',
      textTransform: 'uppercase',
    })
  })
})
