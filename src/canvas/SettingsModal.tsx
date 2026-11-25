import { useRef, useState } from 'react'
import {
  Bot,
  LayoutDashboard,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useGraph } from '../graph/store'
import {
  DEFAULT_CHAIN_CONFIRM_THRESHOLD,
  DEFAULT_COMPACTION_MODE,
  REASONING_EFFORTS,
  nearestReasoningEffort,
  reasoningEffortsFor,
  type CompactionMode,
  type ReasoningEffort,
} from '../graph/types'
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_SLUGS,
  cleanModelSlug,
  isOpenRouterSlug,
  modelLabel,
} from '../brain/models'
import { normalizeRecommendedModelCatalog } from '../ui/recommendedModelCatalog'
import {
  AI_PROVIDERS,
  DEFAULT_HARNESS_MODELS,
  DEFAULT_LOCAL_HARNESS_SETTINGS,
  type AiProvider,
  type LocalHarnessSettingsMap,
  type ProviderModelSettingsMap,
} from '../brain/aiProviderTypes'
import { isProfileReviewExecution } from '../shared/profileReviewPolicy'
import { chainConfirmHint, words } from '../shared/words'

// Where a Linkup key comes from. Named here rather than in words.ts because it
// is an address, not language: it does not change when the copy does.
const LINKUP_SIGNUP = 'https://www.linkup.so/'
const OPENROUTER_SIGNUP = 'https://openrouter.ai/'

// Where each CLI publishes what its model names resolve to. Addresses, not
// language, so they live here beside the two signup links.
const HARNESS_MODEL_DOCS: Readonly<Record<AiProvider, string | null>> = {
  openrouter: null,
  'claude-code': 'https://docs.anthropic.com/en/docs/about-claude/models',
  codex: 'https://platform.openai.com/docs/models',
  antigravity: 'https://ai.google.dev/gemini-api/docs/models',
}

// Where a key comes from, said as the last words of the sentence that explains
// the key. Both keys say it the same way, because they are the same kind of
// thing and Settings should not have two grammars for one job. Always away from
// Eido: `target` alone is a request the host may answer by navigating this
// window instead, and Settings replaced by a signup page is the one outcome
// this must never have. Moving the link inline changed where it sits, not that:
// the click is still cancelled and handed to a named, opener-less new window.
function KeySignupLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      className="settings-signup-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
      }}
    >
      {children}
    </a>
  )
}
import { ModalShell, useModalChrome } from '../ui/overlays'
import { SquareText } from '../ui/primitives/lucideForward'
import {
  Button,
  IconButton,
  Segmented,
  Stepper,
  Toggle,
  Tooltip,
  type SegmentedOption,
} from '../ui/primitives'
import type { ThemePreference } from '../ui/theme'
import { setThemePreference, useThemePreference } from '../ui/themeStore'
import {
  setRendererCountersEnabled,
  useRendererCountersEnabled,
} from '../ui/rendererCountersPreference'
import { setWireRecordEnabled, useWireRecordEnabled } from '../ui/wireRecordPreference'
import { WireRecordPanel } from './WireRecordPanel'

const THEME_OPTIONS: readonly SegmentedOption<ThemePreference>[] = [
  { value: 'light', label: words.themeLight },
  { value: 'dark', label: words.themeDark },
  { value: 'system', label: words.themeMatchSystem },
]

const REASONING_LABELS: Readonly<Record<ReasoningEffort, string>> = {
  none: words.reasoningNone,
  minimal: words.reasoningMinimal,
  low: words.reasoningLow,
  medium: words.reasoningMedium,
  high: words.reasoningHigh,
  xhigh: words.reasoningXHigh,
}

function reasoningOptionsFor(provider: AiProvider, model: string): readonly SegmentedOption<ReasoningEffort>[] {
  const available = reasoningEffortsFor(provider, model)
  return REASONING_EFFORTS
    .filter((effort) => available.includes(effort))
    .map((effort) => ({ value: effort, label: REASONING_LABELS[effort] }))
}

const COMPACTION_OPTIONS: { mode: CompactionMode; label: string; hint: string }[] = [
  { mode: 'never', label: words.compactionNever, hint: words.compactionNeverHint },
  { mode: 'when-needed', label: words.compactionWhenNeeded, hint: words.compactionWhenNeededHint },
  { mode: 'eager', label: words.compactionEager, hint: words.compactionEagerHint },
]

const PROVIDER_PRESENTATION: Readonly<Record<AiProvider, {
  label: string
  modelsNote: string | null
  accessHint: string | null
}>> = {
  openrouter: {
    label: words.aiProviderOpenRouter,
    modelsNote: null,
    accessHint: null,
  },
  'claude-code': {
    label: words.aiProviderClaudeCode,
    modelsNote: words.modelsNoteClaudeCode,
    accessHint: words.localHarnessAccessClaudeCode,
  },
  codex: {
    label: words.aiProviderCodex,
    modelsNote: words.modelsNoteCodex,
    accessHint: words.localHarnessAccessCodex,
  },
  antigravity: {
    label: words.aiProviderAntigravity,
    modelsNote: words.modelsNoteAntigravity,
    accessHint: words.localHarnessAccessAntigravity,
  },
}

const PROVIDER_OPTIONS: readonly SegmentedOption<AiProvider>[] = AI_PROVIDERS.map((provider) => ({
  value: provider,
  label: PROVIDER_PRESENTATION[provider].label,
}))

/* The providers read as two kinds: one you reach with a key over the network,
   and three that are already logged in on this computer. The groups are a
   reading aid only. Every input keeps the one shared radio name, so the whole
   set stays a single choice for the keyboard and for screen readers. */
const PROVIDER_GROUPS: readonly { id: string; label: string; options: readonly SegmentedOption<AiProvider>[] }[] = [
  {
    id: 'api',
    label: words.aiProviderGroupApi,
    options: PROVIDER_OPTIONS.filter((option) => option.value === 'openrouter'),
  },
  {
    id: 'cli',
    label: words.aiProviderGroupCli,
    options: PROVIDER_OPTIONS.filter((option) => option.value !== 'openrouter'),
  },
]

function initialProviderModels(settings: Readonly<{
  provider?: AiProvider
  providerModels?: ProviderModelSettingsMap
  model: string
  models: readonly string[]
}>): ProviderModelSettingsMap {
  const activeProvider = settings.provider ?? 'openrouter'
  const defaults = Object.fromEntries(AI_PROVIDERS.map((candidate) => {
    const models = candidate === 'openrouter'
      ? [...DEFAULT_MODEL_SLUGS]
      : [...DEFAULT_HARNESS_MODELS[candidate]]
    return [candidate, { model: models[0] ?? DEFAULT_MODEL, models }]
  })) as unknown as ProviderModelSettingsMap
  return {
    ...defaults,
    ...settings.providerModels,
    [activeProvider]: {
      model: settings.model,
      models: [...settings.models],
    },
  } as ProviderModelSettingsMap
}

function initialHarnessCommands(
  harnesses: LocalHarnessSettingsMap | undefined,
): LocalHarnessSettingsMap {
  return Object.fromEntries(AI_PROVIDERS.slice(1).map((provider) => [provider, {
    command: harnesses?.[provider as keyof LocalHarnessSettingsMap]?.command
      ?? DEFAULT_LOCAL_HARNESS_SETTINGS[provider as keyof LocalHarnessSettingsMap].command,
  }])) as LocalHarnessSettingsMap
}

type SettingsCategory = 'context' | 'ai' | 'board' | 'privacy'

const CATEGORIES: Array<{
  id: SettingsCategory
  label: string
  icon: LucideIcon
}> = [
  {
    id: 'context',
    label: words.settingsContextNav,
    icon: SquareText,
  },
  {
    id: 'ai',
    label: words.settingsAiNav,
    icon: Bot,
  },
  {
    id: 'board',
    label: words.settingsBoardNav,
    icon: LayoutDashboard,
  },
  {
    id: 'privacy',
    label: words.settingsPrivacyNav,
    icon: ShieldCheck,
  },
]

// Settings are grouped by what the user is trying to control. The API key and
// theme/appearance and renderer-counter visibility are device-local. The
// remaining settings are saved with
// the current Idea.
// Settings wears no header band. The dialog's name lives at the top of the
// category column, and the close control sits above the panel it closes, so
// the two columns carry the chrome the shell no longer draws.
function SettingsTitle() {
  const { titleId, title } = useModalChrome()
  return <h2 id={titleId} className="settings-nav__title t-display">{title}</h2>
}

function SettingsPanelChrome() {
  const { closeLabel, requestClose } = useModalChrome()
  return (
    <div className="settings-panel-chrome">
      <IconButton
        variant="ghost"
        label={closeLabel}
        icon={<X aria-hidden="true" />}
        onClick={requestClose}
      />
    </div>
  )
}

export function SettingsModal({
  onClose,
  initialCategory = 'context',
}: Readonly<{
  onClose: () => void
  // Where the modal opens. Anything that sends the user here to fix a key opens
  // on the category that holds the keys, so the fix is under the cursor rather
  // than one guess away.
  initialCategory?: SettingsCategory
}>) {
  const profileReview = isProfileReviewExecution()
  const themePreference = useThemePreference()
  const rendererCountersEnabled = useRendererCountersEnabled()
  const wireRecordEnabled = useWireRecordEnabled()
  const settings = useGraph((s) => s.settings)
  const apiKeyLocked = useGraph((s) => s.apiKeyLocked)
  const linkupKeyLocked = useGraph((s) => s.linkupKeyLocked)
  const setApiKey = useGraph((s) => s.setApiKey)
  const setLinkupKey = useGraph((s) => s.setLinkupKey)
  const setProvider = useGraph((s) => s.setProvider)
  const setOpenRouterModel = useGraph((s) => s.setOpenRouterModel)
  const setRecommendedModelCatalog = useGraph((s) => s.setRecommendedModelCatalog)
  const replaceRecommendedModel = useGraph((s) => s.replaceRecommendedModel)
  const setHarnessCommand = useGraph((s) => s.setHarnessCommand)
  const setSystemPrompt = useGraph((s) => s.setSystemPrompt)
  const setReasoningEffort = useGraph((s) => s.setReasoningEffort)
  const setChainConfirmThreshold = useGraph((s) => s.setChainConfirmThreshold)
  const setCompactionMode = useGraph((s) => s.setCompactionMode)

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory)
  const [keyDraft, setKeyDraft] = useState<string>()
  const [linkupKeyDraft, setLinkupKeyDraft] = useState<string>()
  const initialApiKeyRef = useRef('')
  const initialLinkupKeyRef = useRef('')
  const [systemPrompt, setSystemPromptDraft] = useState(settings.systemPrompt ?? '')
  const [newModel, setNewModel] = useState('')
  const [modelAddInvalid, setModelAddInvalid] = useState(false)
  const [editingModel, setEditingModel] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [modelEditInvalid, setModelEditInvalid] = useState(false)
  const [provider, setProviderDraft] = useState<AiProvider>(settings.provider ?? 'openrouter')
  const [providerModels, setProviderModelsDraft] = useState<ProviderModelSettingsMap>(
    () => initialProviderModels(settings),
  )
  const [harnessCommands, setHarnessCommandsDraft] = useState<LocalHarnessSettingsMap>(
    () => initialHarnessCommands(settings.harnesses),
  )
  const [open, setOpen] = useState(true)
  const [saveFailed, setSaveFailed] = useState(false)
  const closingRef = useRef(false)
  const panelRef = useRef<HTMLElement>(null)

  const chainConfirmThreshold = settings.chainConfirmThreshold ?? DEFAULT_CHAIN_CONFIRM_THRESHOLD
  const compactionMode = settings.compactionMode ?? DEFAULT_COMPACTION_MODE
  const selectedModels = providerModels[provider]
  const modelsNote = PROVIDER_PRESENTATION[provider].modelsNote
  const recommendedModels = settings.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS

  const saveHarnessCommands = () => {
    for (const harness of Object.keys(harnessCommands) as Array<keyof LocalHarnessSettingsMap>) {
      setHarnessCommand(harness, harnessCommands[harness].command.trim())
    }
  }

  const onAdd = () => {
    if (profileReview) return
    // What was pasted, not what was meant: quotes and spaces come off before
    // anything looks at the slug or stores it.
    const slug = cleanModelSlug(newModel)
    if (!slug) return
    // Only OpenRouter is held to the vendor/model shape. A local harness
    // answers to bare names like 'sonnet' and 'pro', so the same rule there
    // would refuse the only names that work.
    if (provider === 'openrouter' && !isOpenRouterSlug(slug)) {
      setModelAddInvalid(true)
      return
    }
    setModelAddInvalid(false)
    const selection = providerModels[provider]
    const catalog = provider === 'openrouter'
      ? settings.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS
      : selection.models
    if (catalog.includes(slug)) return
    const nextCatalog = provider === 'openrouter' ? [...catalog, slug] : catalog
    const nextModels = provider === 'openrouter'
      ? normalizeRecommendedModelCatalog([...nextCatalog, selection.model])
      : [...selection.models, slug]
    const next = {
      ...providerModels,
      [provider]: {
        ...selection,
        models: nextModels,
      },
    } as ProviderModelSettingsMap
    setProviderModelsDraft(next)
    if (provider === 'openrouter') {
      setRecommendedModelCatalog(nextCatalog)
    }
    setNewModel('')
  }

  const onEdit = (previous: string) => {
    if (profileReview || provider !== 'openrouter') return
    const replacement = cleanModelSlug(editingValue)
    if (!isOpenRouterSlug(replacement)) {
      setModelEditInvalid(true)
      return
    }
    if (replacement !== previous
      && (settings.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS).includes(replacement)) {
      setModelEditInvalid(true)
      return
    }
    if (!replaceRecommendedModel(previous, replacement)) {
      setModelEditInvalid(true)
      return
    }
    setProviderModelsDraft((current) => {
      const selection = current.openrouter
      return {
        ...current,
        openrouter: {
          ...selection,
          model: selection.model === previous ? replacement : selection.model,
          models: selection.models.map((model) => model === previous ? replacement : model),
        },
      }
    })
    setEditingModel(null)
    setEditingValue('')
    setModelEditInvalid(false)
  }

  const onRemove = (modelKey: string) => {
    if (profileReview || provider !== 'openrouter') return
    const selection = providerModels.openrouter
    const catalog = settings.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS
    const models = catalog.filter((candidate) => candidate !== modelKey)
    if (models.length === 0) return
    const selected = selection.model === modelKey
    const nextSelected = selected ? models[0]! : selection.model
    const runtimeModels = normalizeRecommendedModelCatalog([...models, nextSelected])
    const next = {
      ...providerModels,
      openrouter: { ...selection, model: nextSelected, models: runtimeModels },
    } as ProviderModelSettingsMap

    // The selected identity is a Board field; the editable catalog remains
    // device-local. Move the identity first so updateRecommendedModelCatalog
    // does not re-add the removed selection.
    if (selected) setOpenRouterModel(nextSelected)
    setRecommendedModelCatalog(models)
    setProviderModelsDraft(next)

  }

  // Closing must never hang on a credential write. The Keychain can refuse,
  // and when it did, Done, the X and the backdrop all ran this same save and
  // all died silently. Now a refusal says so and the next close leaves without
  // the key rather than trapping the founder in Settings.
  const saveAndClose = async () => {
    if (closingRef.current) return
    if (saveFailed) {
      // The key is the only part that can be refused, so keep everything else
      // the founder changed rather than throwing the whole visit away.
      if (!profileReview) {
        saveHarnessCommands()
        setProvider(provider, providerModels)
      }
      setSystemPrompt(systemPrompt)
      setOpen(false)
      return
    }
    closingRef.current = true
    try {
      if (!profileReview && keyDraft !== undefined && keyDraft.trim() !== initialApiKeyRef.current) {
        await setApiKey(keyDraft.trim())
      }
      // A failed keychain read is represented by an empty draft. Only a dirty
      // credential can write or clear, so pressing Done cannot erase a value
      // that the installed keychain still owns but could not reveal.
      if (!profileReview && linkupKeyDraft !== undefined && linkupKeyDraft.trim() !== initialLinkupKeyRef.current) {
        await setLinkupKey(linkupKeyDraft.trim())
      }
      if (!profileReview) {
        saveHarnessCommands()
        setProvider(provider, providerModels)
      }
      setSystemPrompt(systemPrompt)
      setSaveFailed(false)
      setOpen(false)
    } catch {
      setSaveFailed(true)
      closingRef.current = false
    }
  }

  return (
    <ModalShell
      open={open}
      title={words.settings}
      dismissOnBackdrop
      closeLabel={words.settingsClose}
      chrome="none"
      className="settings-modal"
      onDismiss={saveAndClose}
      onExitComplete={onClose}
      footer={(
        <>
          {saveFailed && (
            <p className="t-hint settings-save-error" role="alert">{words.settingsSaveFailed}</p>
          )}
          <Button variant="primary" onClick={saveAndClose}>
            {words.settingsSaveAndClose}
          </Button>
        </>
      )}
    >
      <div className="settings-shell">
        <nav className="settings-nav" aria-label={words.settingsCategoriesLabel}>
          <SettingsTitle />
          {CATEGORIES.map((category) => {
            const Icon = category.icon
            const active = activeCategory === category.id
            return (
              <button
                type="button"
                key={category.id}
                className={active ? 'active' : ''}
                aria-label={category.label}
                aria-pressed={active}
                onClick={() => {
                  setActiveCategory(category.id)
                  if (panelRef.current) panelRef.current.scrollTop = 0
                }}
              >
                <Icon aria-hidden="true" />
                <strong className="t-label">{category.label}</strong>
              </button>
            )
          })}
        </nav>

        <div className="settings-panel-region">
          <SettingsPanelChrome />
          <main ref={panelRef} className="settings-panel">
            {activeCategory === 'context' && (
              <section className="settings-category" aria-labelledby="settings-context-title">
                <div className="settings-category-heading">
                  <h3 id="settings-context-title" className="t-title">{words.settingsContextTitle}</h3>
                </div>

                {/* Same group shape as the other categories: heading, the
                    sentence that explains it, then the control. The textarea
                    carries the heading's word as its accessible name, so no
                    second label repeats it. */}
                <div className="settings-group">
                  <div className="settings-group-heading">
                    <div>
                      <h4 className="t-title">{words.systemPromptLabel}</h4>
                      <p className="settings-help t-hint">{words.systemPromptHint}</p>
                    </div>
                  </div>
                  <div className="settings-control settings-control--stacked settings-prompt-field">
                    <textarea
                      id="settings-system-prompt"
                      aria-label={words.systemPromptLabel}
                      className="e-field e-textarea"
                      value={systemPrompt}
                      placeholder={words.systemPromptPlaceholder}
                      onChange={(event) => setSystemPromptDraft(event.target.value)}
                      spellCheck
                    />
                  </div>
                </div>
              </section>
            )}

            {activeCategory === 'ai' && (
              <section className="settings-category" aria-labelledby="settings-ai-title">
                <div className="settings-category-heading">
                  <h3 id="settings-ai-title" className="t-title">{words.settingsAiTitle}</h3>
                </div>

                <div className="settings-group">
                  <div className="settings-group-heading">
                    <div>
                      <h4 className="t-title">{words.aiProviderLabel}</h4>
                      <p className="settings-help t-hint">{words.aiProviderHint}</p>
                    </div>
                  </div>
                  <div className="settings-options settings-provider-options">
                    {PROVIDER_GROUPS.map((group) => (
                      <div
                        key={group.id}
                        className="settings-provider-group"
                        role="group"
                        aria-labelledby={`settings-provider-group-${group.id}`}
                      >
                        <span
                          id={`settings-provider-group-${group.id}`}
                          className="settings-provider-group-label t-micro"
                        >
                          {group.label}
                        </span>
                        {group.options.map((option) => (
                            <label
                              key={option.value}
                              className={`settings-option ${provider === option.value ? 'active' : ''}`}
                            >
                              <input
                                type="radio"
                                name="ai-provider"
                                value={option.value}
                                checked={provider === option.value}
                                onChange={() => {
                                  const nextProvider = option.value
                                  setProviderDraft(nextProvider)
                                  setNewModel('')
                                  setModelAddInvalid(false)
                                }}
                                disabled={profileReview}
                              />
                              <span className="settings-option-text">
                                <span className="settings-option-label t-ui">{option.label}</span>
                              </span>
                            </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="settings-group">
                  <div className="settings-group-heading">
                    <div>
                      <h4 className="t-title">{words.settingsModelAccessTitle}</h4>
                      {provider !== 'openrouter' && (
                        <p className="settings-help t-hint">{words.localHarnessLoginHint}</p>
                      )}
                    </div>
                  </div>
                  {provider === 'openrouter' ? (
                    <div className="settings-control settings-control--stacked">
                      {/* The vendor marker takes the place of the field label:
                          "OpenRouter" then "OpenRouter key" is the same word
                          twice. The name survives on the input itself. */}
                      <p className="settings-vendor t-micro">{words.apiKeyVendor}</p>
                      <input
                        id="settings-api-key"
                        className="e-field"
                        type="password"
                        aria-label={words.apiKeyLabel}
                        placeholder={words.keyPlaceholder}
                        value={keyDraft ?? settings.apiKey}
                        onChange={(event) => {
                          if (keyDraft === undefined) initialApiKeyRef.current = settings.apiKey.trim()
                          setKeyDraft(event.target.value)
                        }}
                        autoComplete="off"
                        disabled={profileReview}
                      />
                      <p className="settings-help t-hint">
                        {words.apiKeyHint}{' '}
                        <KeySignupLink href={OPENROUTER_SIGNUP}>{words.apiKeyGet}</KeySignupLink>
                      </p>
                      <p className="settings-help t-hint">{words.apiKeyStorageHint}</p>
                      {apiKeyLocked ? (
                        // The one state where the field looks empty and is not.
                        // Said here rather than in the field, because an empty
                        // field with a saved key behind it is exactly what the
                        // person has to be told about before they type over it.
                        //
                        // Keyed to this field's own slot. The Linkup field
                        // below carries the same notice for its own, and
                        // neither answers for the other (#1360).
                        <p className="settings-help t-hint" role="status">
                          {words.apiKeyLockedNotice}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="settings-control settings-control--stacked">
                      <label className="t-label" htmlFor="settings-harness-command">{words.localHarnessCommandLabel}</label>
                      <input
                        id="settings-harness-command"
                        className="e-field"
                        type="text"
                        value={harnessCommands[provider].command}
                        onChange={(event) => {
                          const command = event.target.value
                          setHarnessCommandsDraft((current) => ({
                            ...current,
                            [provider]: { command },
                          }) as LocalHarnessSettingsMap)
                        }}
                        autoComplete="off"
                        disabled={profileReview}
                      />
                      <p className="settings-help t-hint">{words.localHarnessCommandHint}</p>
                      <p className="settings-help t-hint">{PROVIDER_PRESENTATION[provider].accessHint}</p>
                    </div>
                  )}
                </div>

                {/* The second credential buys a different thing, so it gets its
                    own group and its own heading. Offered only on the provider
                    path that can use it: a local harness owns its own tools, so
                    a key here would buy that user nothing (ADR 0033).

                    Optional, and said so. An empty field is a working state,
                    not a setup step left undone, so nothing here nags. */}
                {provider === 'openrouter' && (
                  <div className="settings-group">
                    <div className="settings-group-heading">
                      <h4 className="t-title">{words.settingsWebSearchTitle}</h4>
                    </div>
                    <div className="settings-control settings-control--stacked">
                      <p className="settings-vendor t-micro">{words.linkupKeyVendor}</p>
                      <input
                        id="settings-linkup-key"
                        className="e-field"
                        type="password"
                        aria-label={words.linkupKeyLabel}
                        placeholder={words.linkupKeyPlaceholder}
                        value={linkupKeyDraft ?? settings.linkupKey ?? ''}
                        onChange={(event) => {
                          if (linkupKeyDraft === undefined) {
                            initialLinkupKeyRef.current = (settings.linkupKey ?? '').trim()
                          }
                          setLinkupKeyDraft(event.target.value)
                        }}
                        autoComplete="off"
                        disabled={profileReview}
                      />
                      <p className="settings-help t-hint">
                        {words.linkupKeyHint}{' '}
                        <KeySignupLink href={LINKUP_SIGNUP}>{words.linkupKeyGet}</KeySignupLink>
                      </p>
                      {linkupKeyLocked ? (
                        // The same one state, for the key that buys Research.
                        // Without it a locked Linkup key shows nothing but the
                        // ordinary placeholder, and Research quietly stops
                        // being offered with no reason given, which is the
                        // complaint #1360 was opened about.
                        <p className="settings-help t-hint" role="status">
                          {words.linkupKeyLockedNotice}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}

                <div className="settings-group">
                  <div className="settings-group-heading">
                    <div>
                      <h4 className="t-title">{words.models}</h4>
                      {/* One line: what to do here, then what these names are
                          and where the vendor lists them. Same sentence shape
                          as the key fields, link last. */}
                      <p className="settings-help t-hint">
                        {words.modelsHint}
                        {modelsNote && HARNESS_MODEL_DOCS[provider] && (
                          <>
                            {' '}{modelsNote}{' '}
                            <KeySignupLink href={HARNESS_MODEL_DOCS[provider]!}>
                              {words.modelsDocsLink}
                            </KeySignupLink>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="model-list">
                    {selectedModels.models.map((slug) => {
                          const label = modelLabel(slug)
                          const isDefault = selectedModels.model === slug
                          const managesRecommendation = provider === 'openrouter'
                            && recommendedModels.includes(slug)
                          return (
                            <div className={`model-row ${isDefault ? 'is-default' : ''}`} key={slug}>
                              <label className="model-row-main">
                                <input
                                  type="radio"
                                  name="default-model"
                                  checked={isDefault}
                                  onChange={() => {
                                    setProviderModelsDraft((current) => ({
                                      ...current,
                                      [provider]: { ...current[provider], model: slug },
                                    }) as ProviderModelSettingsMap)
                                  }}
                                  disabled={profileReview}
                                />
                                <span className="model-row-text">
                                  <span className="model-row-label t-value">{label}</span>
                                  {/* The slug is shown when the name hides it, as
                                      an OpenRouter name does. A CLI word that only
                                      gained a capital is still the slug, and
                                      printing 'auto' under 'Auto' says nothing. */}
                                  {label.toLowerCase() !== slug.toLowerCase() && (
                                    <span className="model-row-slug t-hint">{slug}</span>
                                  )}
                                </span>
                                {isDefault && <span className="model-default-badge t-micro">{words.modelDefault}</span>}
                              </label>
                              {provider === 'openrouter' ? (
                                managesRecommendation ? <>
                                  {editingModel === slug ? (
                                    <div className="model-edit-row">
                                      <input
                                        type="text"
                                        className="e-field"
                                        aria-label={`${words.modelEdit} ${slug}`}
                                        value={editingValue}
                                        aria-invalid={modelEditInvalid || undefined}
                                        onChange={(event) => {
                                          setEditingValue(event.target.value)
                                          setModelEditInvalid(false)
                                        }}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') onEdit(slug)
                                          if (event.key === 'Escape') {
                                            setEditingModel(null)
                                            setModelEditInvalid(false)
                                          }
                                        }}
                                        autoFocus
                                        disabled={profileReview}
                                        aria-describedby={modelEditInvalid ? 'settings-model-edit-error' : undefined}
                                      />
                                      <Button
                                        variant="quiet"
                                        size="compact"
                                        typographyRole="ui"
                                        aria-label={words.modelEditSave}
                                        onClick={() => onEdit(slug)}
                                        disabled={profileReview}
                                      >
                                        {words.modelEditSave}
                                      </Button>
                                    </div>
                                  ) : (
                                    <Tooltip content={words.modelEdit}>
                                      <Button
                                        variant="ghost"
                                        size="compact"
                                        typographyRole="ui"
                                        aria-label={`${words.modelEdit} ${label}`}
                                        onClick={() => {
                                          setEditingModel(slug)
                                          setEditingValue(slug)
                                          setModelEditInvalid(false)
                                        }}
                                        disabled={profileReview}
                                      >
                                        {words.modelEdit}
                                      </Button>
                                    </Tooltip>
                                  )}
                                  <IconButton
                                      variant="danger"
                                      size="compact"
                                      label={`${(settings.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS).length <= 1
                                        ? words.modelRemoveLast
                                        : words.modelRemove} ${label}`}
                                      tooltip={(settings.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS).length <= 1
                                        ? words.modelRemoveLast
                                        : words.modelRemove}
                                      icon={<X aria-hidden="true" />}
                                      onClick={() => onRemove(slug)}
                                      disabled={profileReview
                                        || (settings.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS).length <= 1}
                                  />
                                </> : null
                              ) : (
                                <IconButton
                                    variant="danger"
                                    size="compact"
                                    label={`${words.modelRemove} ${label}`}
                                    tooltip={words.modelRemove}
                                    icon={<X aria-hidden="true" />}
                                    onClick={() => {
                                      setProviderModelsDraft((current) => {
                                        const selection = current[provider]
                                        const models = selection.models.filter((candidate) => candidate !== slug)
                                        if (models.length === 0) return current
                                        return {
                                          ...current,
                                          [provider]: {
                                            model: selection.model === slug ? models[0]! : selection.model,
                                            models,
                                          },
                                        } as ProviderModelSettingsMap
                                      })
                                    }}
                                    disabled={profileReview || selectedModels.models.length <= 1}
                                  />
                              )}
                            </div>
                          )
                        })}
                  </div>

                  <div className="model-add">
                    <input
                      type="text"
                      className="e-field"
                      aria-label={provider === 'openrouter'
                        ? words.modelAddPlaceholder
                        : `${PROVIDER_PRESENTATION[provider].label} model`}
                      placeholder={provider === 'openrouter' ? words.modelAddPlaceholder : words.modelAddHarnessPlaceholder}
                      value={newModel}
                      aria-invalid={modelAddInvalid || undefined}
                      aria-describedby={modelAddInvalid ? 'settings-model-add-error' : undefined}
                      onChange={(event) => {
                        setNewModel(event.target.value)
                        // The refusal answers one press. Typing is the user
                        // already fixing it, so it stops being said.
                        setModelAddInvalid(false)
                      }}
                      disabled={profileReview}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          onAdd()
                        }
                      }}
                    />
                    <Button
                      size="field-mate"
                      onClick={onAdd}
                      disabled={profileReview || !cleanModelSlug(newModel)}
                    >
                      {words.modelAdd}
                    </Button>
                  </div>

                  {modelAddInvalid && (
                    <p
                      id="settings-model-add-error"
                      className="model-add-error t-hint"
                      role="alert"
                    >
                      {words.modelAddInvalid}
                    </p>
                  )}
                  {modelEditInvalid && (
                    <p id="settings-model-edit-error" className="model-add-error t-hint" role="alert">
                      {words.modelEditInvalid}
                    </p>
                  )}

                  {/* Every provider gets this row, in this place, with these
                      words. A stored choice the provider cannot show steps to
                      its nearest rung rather than leaving nothing selected. */}
                  <div className="settings-control settings-control--split settings-reasoning">
                    <span className="t-label">{words.reasoningEffort}</span>
                    <Segmented
                      className="settings-reasoning-picker"
                      ariaLabel={words.reasoningEffort}
                      value={nearestReasoningEffort(provider, settings.reasoningEffort, selectedModels.model)}
                      options={reasoningOptionsFor(provider, selectedModels.model)}
                      onValueChange={setReasoningEffort}
                    />
                  </div>
                </div>
              </section>
            )}

            {activeCategory === 'board' && (
              <section className="settings-category" aria-labelledby="settings-board-title">
                <div className="settings-category-heading">
                  <h3 id="settings-board-title" className="t-title">{words.settingsBoardTitle}</h3>
                </div>

                <div className="settings-group">
                  <div className="settings-group-heading">
                    <h4 className="t-title">{words.themeLabel}</h4>
                  </div>
                  <div className="settings-control settings-control--split">
                    <span className="t-label">{words.themeLabel}</span>
                    <Segmented
                      className="settings-theme-picker"
                      ariaLabel={words.themeLabel}
                      value={themePreference}
                      options={THEME_OPTIONS}
                      onValueChange={setThemePreference}
                    />
                  </div>
                </div>

                <div className="settings-group">
                  <div className="settings-group-heading">
                    <h4 className="t-title">{words.settingsChainTitle}</h4>
                  </div>
                  {/* The same row shape as every other switch here: words on
                      the left, control on the right. A stepper set mid-sentence
                      sat off the text baseline and read as a stray button. */}
                  <div className="settings-control settings-control--toggle">
                    <div>
                      <span className="t-label">{words.chainConfirmLabel}</span>
                      <p className="settings-help t-hint">{chainConfirmHint(chainConfirmThreshold)}</p>
                    </div>
                    {/* The setting has a floor of 0 and no ceiling, so the
                        stepper carries none either; the store still clamps. */}
                    <Stepper
                      label={words.chainConfirmLabel}
                      value={chainConfirmThreshold}
                      min={0}
                      max={Number.MAX_SAFE_INTEGER}
                      decrementLabel={words.chainConfirmDecrease}
                      incrementLabel={words.chainConfirmIncrease}
                      onValueChange={setChainConfirmThreshold}
                    />
                  </div>
                </div>

                <div className="settings-group">
                  <div className="settings-group-heading">
                    <h4 className="t-title">{words.settingsCompactionTitle}</h4>
                  </div>
                  <div className="settings-options">
                    {COMPACTION_OPTIONS.map((option) => (
                      <label
                        key={option.mode}
                        className={`settings-option ${compactionMode === option.mode ? 'active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="compaction-mode"
                          checked={compactionMode === option.mode}
                          onChange={() => setCompactionMode(option.mode)}
                        />
                        <span className="settings-option-text">
                          <span className="settings-option-label t-ui">{option.label}</span>
                          <span className="settings-option-hint t-hint">{option.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {activeCategory === 'privacy' && (
              <section className="settings-category" aria-labelledby="settings-privacy-title">
                <div className="settings-category-heading">
                  <h3 id="settings-privacy-title" className="t-title">{words.settingsPrivacyTitle}</h3>
                </div>

                {/* Board Info: where a user goes to see what the Board is doing.
                    Both diagnostics live here, the renderer counters and the wire
                    record (#968); both are device-local and opt-in. */}
                <div className="settings-group">
                  <div className="settings-group-heading">
                    <h4 className="t-title">{words.settingsBoardInfoTitle}</h4>
                  </div>
                  <div className="settings-control settings-control--toggle">
                    <div>
                      <span className="t-label">{words.settingsRendererCountersLabel}</span>
                      <p className="settings-help t-hint">{words.settingsRendererCountersHint}</p>
                    </div>
                    <Toggle
                      label={words.settingsRendererCountersLabel}
                      checked={rendererCountersEnabled}
                      onCheckedChange={(enabled) => {
                        setRendererCountersEnabled(enabled)
                      }}
                    />
                  </div>
                  <div className="settings-control settings-control--toggle">
                    <div>
                      <span className="t-label">{words.settingsWireRecordLabel}</span>
                      <p className="settings-help t-hint">{words.settingsWireRecordHint}</p>
                    </div>
                    <Toggle
                      label={words.settingsWireRecordLabel}
                      checked={wireRecordEnabled}
                      onCheckedChange={(enabled) => {
                        setWireRecordEnabled(enabled)
                      }}
                    />
                  </div>
                  {wireRecordEnabled && <WireRecordPanel />}
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </ModalShell>
  )
}
