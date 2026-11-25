// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { modelLabel } from '../brain/models'
import {
  AI_PROVIDERS,
  isLocalHarness,
  type LocalHarnessId,
} from '../brain/aiProviderTypes'
import { useGraph } from '../graph/store'
import { PROFILE_REVIEW_MODEL } from '../shared/profileReviewPolicy'
import { words } from '../shared/words'
import { OverlayProvider } from '../ui/overlays'
import { loadRecommendedModelCatalogState } from '../ui/recommendedModelCatalog'
import { SettingsModal } from './SettingsModal'

// The local harnesses Eido actually offers, read from the provider source of
// truth instead of listed here. Retiring one (the Gemini CLI) or adding one
// moves every harness count in this file by itself, so no test in here can go
// on asserting a choice the product stopped rendering.
const LOCAL_HARNESS_IDS = AI_PROVIDERS.filter(isLocalHarness)

// Every harness stores a command, and the fixtures below hand the store a full
// set. Built from the real list so a retired harness cannot linger in a
// settings object the product would never write.
const HARNESS_COMMANDS: Readonly<Record<LocalHarnessId, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
  antigravity: 'agy',
}

function harnessCommands(
  overrides: Partial<Record<LocalHarnessId, string>> = {},
): Record<LocalHarnessId, { command: string }> {
  return Object.fromEntries(LOCAL_HARNESS_IDS.map((id) => [
    id,
    { command: overrides[id] ?? HARNESS_COMMANDS[id] },
  ])) as Record<LocalHarnessId, { command: string }>
}

describe('SettingsModal', () => {
  afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'eidoDesktop')
    Reflect.deleteProperty(window, 'eidoProfileReview')
  })

  beforeEach(() => {
    localStorage.clear()
    useGraph.setState({
      hydrated: false,
      currentIdeaId: null,
      settings: {
        apiKey: 'local-key',
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini'],
        reasoningEffort: 'medium',
        systemPrompt: 'Existing Idea context',
      },
    })
  })

  it('keeps four direct categories and puts theme controls under Board', async () => {
    localStorage.setItem('eido-v3-settings', JSON.stringify({ theme: 'system' }))
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal
          onClose={vi.fn()}
        />
      </OverlayProvider>,
    )

    const navigation = screen.getByRole('navigation', { name: words.settingsCategoriesLabel })
    expect(within(navigation).getAllByRole('button').map(button => button.textContent?.trim())).toEqual([
      words.settingsContextNav,
      words.settingsAiNav,
      words.settingsBoardNav,
      words.settingsPrivacyNav,
    ])
    expect(within(navigation).queryByText('Always know')).not.toBeInTheDocument()
    expect(within(navigation).queryByText('Key & models')).not.toBeInTheDocument()
    expect(within(navigation).queryByText('Limits')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: words.settingsBoardNav }))

    expect(screen.getByRole('radiogroup', { name: words.themeLabel })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: words.themeMatchSystem })).toHaveAttribute('aria-checked', 'true')

    await user.pointer({
      target: screen.getByRole('radio', { name: words.themeDark }),
      keys: '[MouseLeft>][/MouseLeft]',
    })

    expect(JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}')).toMatchObject({ theme: 'dark' })
  })

  it('offers OpenRouter models without an account', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    const navigation = screen.getByRole('navigation', { name: words.settingsCategoriesLabel })
    expect(within(navigation).getAllByRole('button').map(button => button.textContent?.trim())).toEqual([
      words.settingsContextNav,
      words.settingsAiNav,
      words.settingsBoardNav,
      words.settingsPrivacyNav,
    ])
    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    // The model row leads with a plain name, not the raw slug: one naming rule
    // serves every model surface, so the row opens with what modelLabel
    // derives. Anchored at the start because the row also carries the slug and
    // the Default badge after the name.
    expect(screen.getByRole('radio', {
      name: new RegExp(`^${modelLabel('openai/gpt-4o-mini')}`),
    })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument()
  })

  it('adds a model through the shared field-mate action without changing its disabled contract', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))

    const modelInput = screen.getByRole('textbox', { name: words.modelAddPlaceholder })
    const addModel = screen.getByRole('button', { name: words.modelAdd })
    expect(addModel).toHaveClass('e-button', 'e-button--quiet', 'e-button--field-mate')
    expect(addModel).toBeDisabled()

    fireEvent.change(modelInput, { target: { value: 'anthropic/claude-sonnet-4' } })
    expect(addModel).toBeEnabled()
    await user.click(addModel)

    expect(useGraph.getState().settings.recommendedModelCatalog)
      .toContain('anthropic/claude-sonnet-4')
    expect(useGraph.getState().settings.providerModels?.openrouter.models)
      .toContain('anthropic/claude-sonnet-4')
    expect(modelInput).toHaveValue('')
  })

  it('can explicitly add the selected custom identity while it is absent from recommendations', async () => {
    useGraph.setState({
      settings: {
        ...useGraph.getState().settings,
        provider: 'openrouter',
        model: 'vendor/custom',
        models: ['vendor/old', 'vendor/custom'],
        recommendedModelCatalog: ['vendor/old'],
        providerModels: {
          openrouter: { model: 'vendor/custom', models: ['vendor/old', 'vendor/custom'] },
          'claude-code': { model: 'sonnet', models: ['sonnet'] },
          codex: { model: 'gpt-5.6-codex', models: ['gpt-5.6-codex'] },
          antigravity: { model: 'gemini-3.7-pro', models: ['gemini-3.7-pro'] },
        },
      },
    })
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )
    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    expect(screen.getByRole('radio', { name: /Custom/i })).toBeChecked()

    const modelInput = screen.getByRole('textbox', { name: words.modelAddPlaceholder })
    await user.type(modelInput, 'vendor/custom')
    await user.click(screen.getByRole('button', { name: words.modelAdd }))

    expect(useGraph.getState().settings.recommendedModelCatalog)
      .toEqual(['vendor/old', 'vendor/custom'])
    expect(useGraph.getState().settings.model).toBe('vendor/custom')
    expect(useGraph.getState().snapshot().aiSettings)
      .not.toHaveProperty('recommendedModelCatalog')
  })

  it('keeps a compatibility-only selected row truthful and non-editable', async () => {
    useGraph.setState({
      settings: {
        ...useGraph.getState().settings,
        provider: 'openrouter',
        model: 'vendor/compatibility-only',
        models: ['vendor/recommended', 'vendor/other', 'vendor/compatibility-only'],
        recommendedModelCatalog: ['vendor/recommended', 'vendor/other'],
        providerModels: {
          ...useGraph.getState().settings.providerModels!,
          openrouter: {
            model: 'vendor/compatibility-only',
            models: ['vendor/recommended', 'vendor/other', 'vendor/compatibility-only'],
          },
        },
      },
    })
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))

    expect(screen.getByRole('radio', { name: /Compatibility Only/i })).toBeChecked()
    expect(screen.queryByRole('button', { name: /Edit Compatibility Only/i }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove Compatibility Only/i }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit Recommended/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove Recommended/i })).toBeInTheDocument()
    expect(useGraph.getState().settings.recommendedModelCatalog)
      .toEqual(['vendor/recommended', 'vendor/other'])
    expect(useGraph.getState().snapshot().aiSettings?.model).toBe('vendor/compatibility-only')
    expect(useGraph.getState().snapshot().aiSettings)
      .not.toHaveProperty('recommendedModelCatalog')
  })

  it('edits, selects, and removes a device catalog slug without touching Profile-shaped settings', async () => {
    useGraph.setState({
      settings: {
        ...useGraph.getState().settings,
        provider: 'openrouter',
        model: 'vendor/old',
        models: ['vendor/old', 'vendor/other'],
        recommendedModelCatalog: ['vendor/old', 'vendor/other'],
        providerModels: {
          openrouter: {
            model: 'vendor/old',
            models: ['vendor/old', 'vendor/other'],
          },
          'claude-code': { model: 'sonnet', models: ['sonnet'] },
          codex: { model: 'gpt-5.6-codex', models: ['gpt-5.6-codex'] },
          antigravity: { model: 'gemini-3.7-pro', models: ['gemini-3.7-pro'] },
        },
      },
    })
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    expect(screen.getByRole('button', { name: /Edit Old/i }))
      .toHaveClass('e-button', 'e-button--ghost', 'e-button--compact')
    expect(screen.getByRole('button', { name: /Remove Old/i }))
      .toHaveClass('e-icon-button', 'e-button--danger', 'e-button--compact')
    await user.click(screen.getByRole('button', { name: /Edit Old/i }))
    const edit = screen.getByRole('textbox', { name: /Edit vendor\/old/i })
    await user.clear(edit)
    await user.type(edit, 'vendor/new')
    expect(screen.getByRole('button', { name: words.modelEditSave }))
      .toHaveClass('e-button', 'e-button--quiet', 'e-button--compact')
    await user.click(screen.getByRole('button', { name: words.modelEditSave }))

    expect(useGraph.getState().settings.recommendedModelCatalog)
      .toEqual(['vendor/new', 'vendor/other'])
    expect(useGraph.getState().snapshot().aiSettings)
      .not.toHaveProperty('recommendedModelCatalog')
    expect(useGraph.getState().snapshot().aiSettings)
      .not.toHaveProperty('openrouterModelListFormat')
    expect(screen.getByRole('radio', { name: /^New/i })).toBeChecked()

    // A duplicate and a structurally invalid slug are refused in the edit
    // field, leaving the device catalog and selected Profile identity alone.
    await user.click(screen.getByRole('button', { name: /Edit New/i }))
    const duplicate = screen.getByRole('textbox', { name: /Edit vendor\/new/i })
    await user.clear(duplicate)
    await user.type(duplicate, 'vendor/other')
    await user.click(screen.getByRole('button', { name: words.modelEditSave }))
    expect(screen.getByRole('alert')).toHaveTextContent(words.modelEditInvalid)
    expect(duplicate).toHaveAttribute('aria-describedby', 'settings-model-edit-error')
    expect(useGraph.getState().settings.recommendedModelCatalog)
      .toEqual(['vendor/new', 'vendor/other'])

    await user.clear(duplicate)
    await user.type(duplicate, 'not-a-slug')
    await user.click(screen.getByRole('button', { name: words.modelEditSave }))
    expect(screen.getByRole('alert')).toHaveTextContent(words.modelEditInvalid)
    expect(useGraph.getState().settings.recommendedModelCatalog)
      .toEqual(['vendor/new', 'vendor/other'])

    await user.click(screen.getByRole('radio', { name: /^Other/i }))
    await user.click(screen.getByRole('button', { name: /Remove New/i }))
    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual(['vendor/other'])
    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    expect(useGraph.getState().settings.model).toBe('vendor/other')
    expect(useGraph.getState().snapshot().aiSettings)
      .not.toHaveProperty('recommendedModelCatalog')
  })

  it('exposes the same edit/remove catalog seam in browser Settings and chooses a deterministic fallback', async () => {
    useGraph.setState({
      settings: {
        ...useGraph.getState().settings,
        provider: 'openrouter',
        model: 'vendor/old',
        models: ['vendor/old', 'vendor/other', 'vendor/third'],
        recommendedModelCatalog: ['vendor/old', 'vendor/other', 'vendor/third'],
        providerModels: {
          ...useGraph.getState().settings.providerModels!,
          openrouter: { model: 'vendor/old', models: ['vendor/old', 'vendor/other', 'vendor/third'] },
        },
      },
    })
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    await user.click(screen.getByRole('button', { name: /Remove Other/i }))
    expect(useGraph.getState().settings.recommendedModelCatalog)
      .toEqual(['vendor/old', 'vendor/third'])
    expect(JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}'))
      .toMatchObject({ recommendedModelCatalog: ['vendor/old', 'vendor/third'], recommendedModelCatalogExplicit: true })

    expect(loadRecommendedModelCatalogState(localStorage)).toEqual({
      models: ['vendor/old', 'vendor/third'],
      explicit: true,
    })

    await user.click(screen.getByRole('button', { name: /Edit Old/i }))
    const edit = screen.getByRole('textbox', { name: /Edit vendor\/old/i })
    await user.clear(edit)
    await user.type(edit, 'vendor/new')
    await user.click(screen.getByRole('button', { name: words.modelEditSave }))
    expect(useGraph.getState().settings.recommendedModelCatalog)
      .toEqual(['vendor/new', 'vendor/third'])

    await user.click(screen.getByRole('button', { name: /Remove New/i }))
    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual(['vendor/third'])
    expect(useGraph.getState().settings.model).toBe('vendor/third')
    expect(JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}'))
      .toMatchObject({ recommendedModelCatalog: ['vendor/third'], recommendedModelCatalogExplicit: true })
    expect(screen.getByRole('button', { name: /Keep at least one model Third/i })).toBeDisabled()

    expect(loadRecommendedModelCatalogState(localStorage)).toEqual({
      models: ['vendor/third'],
      explicit: true,
    })
  })

  it('cleans a pasted OpenRouter slug, refuses one that is not vendor/model, and lets a harness keep bare names', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    const modelInput = screen.getByRole('textbox', { name: words.modelAddPlaceholder })

    fireEvent.change(modelInput, { target: { value: '  "anthropic/claude-opus-5"  ' } })
    await user.click(screen.getByRole('button', { name: words.modelAdd }))
    expect(screen.getByRole('radio', { name: /^Claude Opus 5/ })).toBeInTheDocument()
    expect(screen.getByText('anthropic/claude-opus-5')).toBeInTheDocument()

    fireEvent.change(modelInput, { target: { value: 'sonnet' } })
    await user.click(screen.getByRole('button', { name: words.modelAdd }))
    expect(screen.getByRole('alert')).toHaveTextContent(words.modelAddInvalid)
    expect(screen.queryByRole('radio', { name: /^Sonnet/ })).not.toBeInTheDocument()

    // The same bare name is exactly what a local CLI answers to.
    await user.click(screen.getByRole('radio', { name: words.aiProviderClaudeCode }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const harnessInput = screen.getByRole('textbox', { name: `${words.aiProviderClaudeCode} model` })
    fireEvent.change(harnessInput, { target: { value: 'sonnet-custom' } })
    await user.click(screen.getByRole('button', { name: words.modelAdd }))
    // The CLI list reads as names: a word gets a capital, and the row does not
    // repeat the slug underneath when the slug is the same word in lower case.
    expect(screen.getByRole('radio', { name: 'Sonnet-Custom' })).toBeInTheDocument()
    expect(screen.queryByText('sonnet-custom')).not.toBeInTheDocument()
  })

  it('stages provider changes, keeps each provider catalog, and offers the selected model reasoning ladder', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        {/* #999: harness selection needs the local-harness capability now, so
            this staging flow uses the installed providers. */}
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    // Same control and same place for every provider. Rungs the selected model
    // does not have go missing. OpenRouter is the one provider that can turn
    // reasoning off, so it is the only one that draws the Off rung.
    const openRouterReasoning = screen.getByRole('radiogroup', { name: words.reasoningEffort })
    expect(within(openRouterReasoning).getByRole('radio', { name: words.reasoningNone })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: words.aiProviderClaudeCode }))
    expect(useGraph.getState().settings.provider).not.toBe('claude-code')
    const claudeReasoning = screen.getByRole('radiogroup', { name: words.reasoningEffort })
    expect(within(claudeReasoning).getByRole('radio', { name: words.reasoningXHigh })).toBeInTheDocument()
    expect(within(claudeReasoning).queryByRole('radio', { name: words.reasoningNone })).not.toBeInTheDocument()
    expect(within(claudeReasoning).queryByRole('radio', { name: words.reasoningMinimal })).not.toBeInTheDocument()

    const claudeModelInput = screen.getByRole('textbox', { name: `${words.aiProviderClaudeCode} model` })
    fireEvent.change(claudeModelInput, { target: { value: 'claude-fable-5' } })
    await user.click(screen.getByRole('button', { name: words.modelAdd }))
    await user.click(screen.getByRole('radio', { name: 'claude-fable-5' }))

    await user.click(screen.getByRole('radio', { name: words.aiProviderCodex }))
    const codexReasoning = screen.getByRole('radiogroup', { name: words.reasoningEffort })
    expect(within(codexReasoning).getByRole('radio', { name: words.reasoningXHigh })).toBeInTheDocument()
    expect(within(codexReasoning).getByRole('radio', { name: words.reasoningLow })).toBeInTheDocument()
    expect(within(codexReasoning).queryByRole('radio', { name: words.reasoningNone })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^gpt-5\.6-sol/ })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: words.aiProviderAntigravity }))
    const antigravityReasoning = screen.getByRole('radiogroup', { name: words.reasoningEffort })
    expect(within(antigravityReasoning).getByRole('radio', { name: words.reasoningLow })).toBeInTheDocument()
    expect(within(antigravityReasoning).getByRole('radio', { name: words.reasoningMedium })).toBeInTheDocument()
    expect(within(antigravityReasoning).getByRole('radio', { name: words.reasoningHigh })).toBeInTheDocument()
    expect(within(antigravityReasoning).queryByRole('radio', { name: words.reasoningXHigh })).not.toBeInTheDocument()
    expect(within(antigravityReasoning).queryByRole('radio', { name: words.reasoningNone })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /gemini-3\.7-flash/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /gemini-3\.1-pro/ })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /gemini-3\.1-pro/ }))
    const antigravityProReasoning = screen.getByRole('radiogroup', { name: words.reasoningEffort })
    expect(within(antigravityProReasoning).getByRole('radio', { name: words.reasoningLow })).toBeInTheDocument()
    expect(within(antigravityProReasoning).getByRole('radio', { name: words.reasoningHigh })).toBeInTheDocument()
    expect(within(antigravityProReasoning).queryByRole('radio', { name: words.reasoningMedium })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: words.aiProviderClaudeCode }))
    expect(screen.getByRole('radio', { name: /^claude-fable-5/ })).toBeChecked()

    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    expect(useGraph.getState().settings).toMatchObject({
      provider: 'claude-code',
      model: 'claude-fable-5',
      models: ['default', 'fable', 'opus', 'sonnet', 'haiku', 'claude-fable-5'],
    })
  })

  it('places the shared harness description under AI Models and explains each CLI access mode', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    await user.click(screen.getByRole('radio', { name: words.aiProviderClaudeCode }))

    const accessHeading = screen.getByRole('heading', { level: 4, name: words.settingsModelAccessTitle })
    const headingRegion = accessHeading.closest('.settings-group-heading') as HTMLElement
    const accessGroup = accessHeading.closest('.settings-group') as HTMLElement
    const commandControl = within(accessGroup).getByLabelText(words.localHarnessCommandLabel)
      .closest('.settings-control') as HTMLElement

    expect(within(headingRegion).getByText(words.localHarnessLoginHint)).toBeInTheDocument()
    expect(within(commandControl).queryByText(words.localHarnessLoginHint)).not.toBeInTheDocument()
    expect(within(commandControl).getByText(words.localHarnessCommandHint)).toBeInTheDocument()
    expect(within(commandControl).getByText(words.localHarnessAccessClaudeCode)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: words.aiProviderCodex }))
    expect(within(accessGroup).queryByText(words.localHarnessAccessClaudeCode)).not.toBeInTheDocument()
    expect(within(accessGroup).getByText(words.localHarnessAccessCodex)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: words.aiProviderAntigravity }))
    expect(within(accessGroup).queryByText(words.localHarnessAccessCodex)).not.toBeInTheDocument()
    expect(within(accessGroup).getByText(words.localHarnessAccessAntigravity)).toBeInTheDocument()
  })

  it('disables credential and model edits while still allowing review settings to close', async () => {
    Object.defineProperty(window, 'eidoDesktop', { configurable: true, value: true })
    Object.defineProperty(window, 'eidoProfileReview', { configurable: true, value: true })
    useGraph.setState({
      settings: {
        ...useGraph.getState().settings,
        model: PROFILE_REVIEW_MODEL,
        models: [PROFILE_REVIEW_MODEL],
      },
    })
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <OverlayProvider>
        <SettingsModal onClose={onClose} />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))

    expect(screen.getByLabelText(words.apiKeyLabel)).toBeDisabled()
    expect(screen.getByRole('radio', { name: /GPT 5\.6 Luna/i })).toBeDisabled()
    expect(screen.getByRole('button', {
      name: new RegExp(`(${words.modelRemove}|${words.modelRemoveLast})`, 'i'),
    })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: words.modelAddPlaceholder })).toBeDisabled()
    expect(screen.getByRole('button', { name: words.modelAdd })).toBeDisabled()

    const dialog = screen.getByRole('dialog', { name: words.settings })
    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    fireEvent.transitionEnd(dialog.parentElement!, { propertyName: 'opacity' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('navigates categories and saves the Idea system prompt', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <OverlayProvider>
        <SettingsModal onClose={onClose} />
      </OverlayProvider>,
    )

    const dialog = screen.getByRole('dialog', { name: words.settings })
    // Settings has no header band now; its name sits at the top of the category
    // column and it carries no subtitle.
    expect(within(dialog).getByRole('heading', { level: 2, name: words.settings }))
      .toBeInTheDocument()
    expect(within(dialog).queryByText(words.settingsIntro)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: words.settingsContextTitle }))
      .toBeInTheDocument()
    expect(within(dialog).getByText(words.systemPromptHint))
      .toBeInTheDocument()
    expect(within(dialog).queryByText(
      'Add communication preferences, standing context, or facts about this Idea that should apply everywhere.',
    )).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Applied quietly to every run')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(
      'Eido adds this before its run instructions. It stays out of card prompts and does not mark AI sources as changed.',
    )).not.toBeInTheDocument()

    const prompt = screen.getByLabelText(words.systemPromptLabel)
    expect(prompt).toHaveValue('Existing Idea context')

    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    expect(screen.getByLabelText(words.apiKeyLabel)).toBeInTheDocument()
    expect(screen.queryByLabelText(words.systemPromptLabel)).not.toBeInTheDocument()
    // Where a setting is saved is Eido's business, not a badge on every heading
    // (founder decision 2026-08-18). Nothing in Settings wears a scope chip now.
    expect(within(dialog).queryByText('Device')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Idea')).not.toBeInTheDocument()
    expect(dialog.querySelector('.e-chip--scope')).toBeNull()

    expect(within(dialog).getByRole('radiogroup', { name: words.reasoningEffort }))
      .toBeInTheDocument()
    expect(within(dialog).queryByText('Choose your OpenRouter access, available models, and default reasoning level.'))
      .not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: words.settingsContextNav }))
    await user.clear(screen.getByLabelText(words.systemPromptLabel))
    await user.type(screen.getByLabelText(words.systemPromptLabel), 'Prefer short answers in Australian English.')
    const backdrop = screen.getByRole('dialog', { name: words.settings }).parentElement!
    const saveAndClose = screen.getByRole('button', { name: words.settingsSaveAndClose })
    expect(saveAndClose).toHaveClass('e-button', 'e-button--primary')
    await user.click(saveAndClose)

    expect(useGraph.getState().settings.systemPrompt).toBe('Prefer short answers in Australian English.')
    fireEvent.transitionEnd(backdrop, { propertyName: 'opacity' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('presents Board controls as compact direct choices', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    const panel = screen.getByRole('main')
    panel.scrollTop = 180
    await user.click(screen.getByRole('button', { name: words.settingsBoardNav }))

    expect(panel.scrollTop).toBe(0)
    expect(screen.getByRole('heading', { name: words.settingsBoardTitle })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: words.themeLabel })).toBeInTheDocument()
    // The threshold reads through the shared stepper now, value and all.
    expect(screen.getByRole('spinbutton', { name: words.chainConfirmLabel })).toHaveValue(2)
    expect(screen.getByRole('button', { name: words.chainConfirmIncrease })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: new RegExp(words.compactionWhenNeeded, 'i') }))
      .toBeChecked()
    expect(screen.queryByText(/Running a card can also re-run/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/A big board can gather/i)).not.toBeInTheDocument()
    // Device diagnostics have their own category.
    expect(screen.queryByRole('switch', { name: words.settingsRendererCountersLabel })).toBeNull()
    expect(screen.queryByRole('switch', { name: words.settingsWireRecordLabel })).toBeNull()
  })

  it('gathers device diagnostics under Privacy', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsPrivacyNav }))

    expect(screen.getByRole('heading', { name: words.settingsBoardInfoTitle })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: words.settingsRendererCountersLabel })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: words.settingsWireRecordLabel })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: words.themeLabel })).toBeNull()
  })

  it('saves a backdrop dismissal and retires through the shared modal exit', async () => {
    const onClose = vi.fn()
    render(
      <OverlayProvider>
        <SettingsModal onClose={onClose} />
      </OverlayProvider>,
    )

    fireEvent.change(screen.getByLabelText(words.systemPromptLabel), {
      target: { value: 'Keep the useful detail.' },
    })
    const dialog = screen.getByRole('dialog', { name: words.settings })
    const backdrop = dialog.parentElement!
    fireEvent.pointerDown(backdrop)

    await waitFor(() => {
      expect(useGraph.getState().settings.systemPrompt).toBe('Keep the useful detail.')
      expect(backdrop).toHaveAttribute('data-state', 'exiting')
    })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.transitionEnd(backdrop, { propertyName: 'opacity' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog', { name: words.settings })).toBeNull()
  })
  // A credential store that refuses the write must never trap the founder in
  // Settings: every close path ran through the same save, so one failing
  // Keychain write killed Done, the X and the backdrop at once.
  it('says why a save failed and still lets every close path out', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    // The store is one module-level instance shared by every test in this
    // file, and no beforeEach re-seeds its actions. A stub left in place would
    // make every later save throw and pass or fail those tests for a reason
    // that has nothing to do with what they assert, so the real action is put
    // back whether this test passes or fails.
    const realSetApiKey = useGraph.getState().setApiKey
    onTestFinished(() => { useGraph.setState({ setApiKey: realSetApiKey }) })
    useGraph.setState({
      setApiKey: async () => { throw new Error('Local credential storage is unavailable') },
    })
    render(
      <OverlayProvider>
        <SettingsModal onClose={onClose} />
      </OverlayProvider>,
    )

    const dialog = screen.getByRole('dialog', { name: words.settings })
    const backdrop = dialog.parentElement!
    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    await user.type(screen.getByLabelText(words.apiKeyLabel), '-edited')
    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))

    expect(await screen.findByRole('alert')).toHaveTextContent(words.settingsSaveFailed)
    expect(backdrop).not.toHaveAttribute('data-state', 'exiting')

    await user.click(within(dialog).getByRole('button', { name: words.settingsClose }))

    await waitFor(() => expect(backdrop).toHaveAttribute('data-state', 'exiting'))
    fireEvent.transitionEnd(backdrop, { propertyName: 'opacity' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})

// --- #1219 Linkup key editor independence: begin ---
describe('SettingsModal Linkup key editor (#1219)', () => {
  const STORED_KEY = 'stored-linkup-secret-998'

  afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'eidoDesktop')
    Reflect.deleteProperty(window, 'eidoProfileReview')
  })

  beforeEach(() => {
    localStorage.clear()
    useGraph.setState({
      hydrated: false,
      currentIdeaId: null,
      settings: {
        apiKey: 'local-key',
        linkupKey: STORED_KEY,
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini'],
        reasoningEffort: 'medium',
        systemPrompt: 'Existing Idea context',
      },
      linkupKeyPresent: true,
    })
  })

  async function openAiCategory() {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )
    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    return user
  }

  it('edits and saves the device-local Linkup key', async () => {
    const user = await openAiCategory()

    const field = screen.getByLabelText(words.linkupKeyLabel) as HTMLInputElement
    expect(field).not.toHaveAttribute('data-locked')
    expect(field).not.toHaveAttribute('readonly')
    // The key stored before the lapse is back under the person's hands.
    expect(field.value).toBe(STORED_KEY)
    expect(screen.getByText(words.linkupKeyHint)).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'replacement-key')
    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    expect(useGraph.getState().settings.linkupKey).toBe('replacement-key')
  })

  it('shows keys loaded after opening Settings without replacing an in-progress edit', async () => {
    useGraph.setState((state) => ({ settings: { ...state.settings, apiKey: '', linkupKey: '' } }))
    const user = await openAiCategory()
    const openrouterField = screen.getByLabelText(words.apiKeyLabel)
    const linkupField = screen.getByLabelText(words.linkupKeyLabel)
    expect(openrouterField).toHaveValue('')
    await user.type(linkupField, 'lk-synthetic-edit')

    act(() => useGraph.setState((state) => ({
      settings: { ...state.settings, apiKey: 'sk-synthetic-loaded', linkupKey: STORED_KEY },
    })))

    expect(openrouterField).toHaveValue('sk-synthetic-loaded')
    expect(linkupField).toHaveValue('lk-synthetic-edit')
    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    expect(useGraph.getState().settings).toMatchObject({
      apiKey: 'sk-synthetic-loaded',
      linkupKey: 'lk-synthetic-edit',
    })
  })

  it('keeps key editing disabled in profile review', async () => {
    Object.defineProperty(window, 'eidoDesktop', { configurable: true, value: true })
    Object.defineProperty(window, 'eidoProfileReview', { configurable: true, value: true })
    useGraph.setState({
      settings: {
        ...useGraph.getState().settings,
        model: PROFILE_REVIEW_MODEL,
        models: [PROFILE_REVIEW_MODEL],
      },
    })
    await openAiCategory()

    // Profile review keeps credentials read-only.
    const field = screen.getByLabelText(words.linkupKeyLabel)
    expect(field).toBeDisabled()
    expect(field).not.toHaveAttribute('data-locked')
    expect(field).not.toHaveAttribute('aria-describedby')
  })

  it('offers the optional Linkup key without an account', async () => {
    await openAiCategory()

    const field = screen.getByLabelText(words.linkupKeyLabel) as HTMLInputElement
    expect(field).not.toHaveAttribute('data-locked')
    expect(field.value).toBe(STORED_KEY)
    expect(screen.getByText(words.linkupKeyGet)).toBeInTheDocument()
  })
})

describe('SettingsModal installed CLI providers', () => {
  // Trailing space on purpose: a locked save that "harmlessly" re-writes the
  // trimmed echo would erase it, so reading it back untouched pins the guard.
  const STORED_COMMAND = 'my-tuned-claude --flag '
  afterEach(() => {
    cleanup()
    document.body.replaceChildren()
  })

  beforeEach(() => {
    localStorage.clear()
    useGraph.setState({
      hydrated: false,
      currentIdeaId: null,
      settings: {
        apiKey: 'local-key',
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini'],
        reasoningEffort: 'medium',
        systemPrompt: 'Existing Idea context',
        harnesses: harnessCommands({ 'claude-code': STORED_COMMAND }),
      },
    })
  })

  async function openAiCategory() {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <SettingsModal onClose={vi.fn()} />
      </OverlayProvider>,
    )
    await user.click(screen.getByRole('button', { name: words.settingsAiNav }))
    return user
  }

  it('saves an OpenRouter key with installed CLI providers available', async () => {
    const user = await openAiCategory()

    const keyField = screen.getByLabelText(words.apiKeyLabel)
    expect(keyField).toBeEnabled()
    expect(keyField).not.toHaveAttribute('data-locked')
    expect(keyField).not.toHaveAttribute('readonly')
    // The choice itself stays a live radio, never swept into the lock.
    expect(screen.getByRole('radio', { name: words.aiProviderOpenRouter })).toBeEnabled()
    await user.clear(keyField)
    await user.type(keyField, 'replacement-openrouter-key')
    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    // Saving preserves the provider selected in Settings.
    expect(useGraph.getState().settings.apiKey).toBe('replacement-openrouter-key')
    expect(useGraph.getState().settings.provider ?? 'openrouter').toBe('openrouter')
  })

  it('selects and edits an installed CLI provider', async () => {
    const user = await openAiCategory()

    // Radios again, no locked dress anywhere in the provider choices.
    await user.click(screen.getByRole('radio', { name: words.aiProviderClaudeCode }))
    const command = screen.getByLabelText(words.localHarnessCommandLabel) as HTMLInputElement
    expect(command).not.toHaveAttribute('data-locked')
    expect(command).not.toHaveAttribute('readonly')
    expect(command.value).toBe(STORED_COMMAND)

    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    expect(useGraph.getState().settings.provider).toBe('claude-code')
    expect(useGraph.getState().settings.harnesses?.['claude-code']?.command)
      .toBe(STORED_COMMAND.trim())
  })

  it('offers every installed CLI provider without an account', async () => {
    const user = await openAiCategory()

    const claude = screen.getByRole('radio', { name: words.aiProviderClaudeCode })
    expect(claude).toBeEnabled()
    await user.click(claude)
    expect(screen.getByLabelText(words.localHarnessCommandLabel)).not.toHaveAttribute('data-locked')
  })
})
