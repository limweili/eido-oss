// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGraph } from "../../graph/store";
import type { Card, RunRecord } from "../../graph/types";
import { words } from "../../shared/words";
import { DESIGN_TIMING_MS } from "../../ui/tokens";
import { resumeResearchRun, runChain } from "../../brain/runEngine";
import { AskAiCard } from "./AskAiCard";
import { SettingsModal } from "../SettingsModal";
import { OverlayProvider } from "../../ui/overlays";
import { ConversationCard } from "./ConversationCard";

// The chain engine is real everywhere except the calls a press ends in, so
// the research tests can prove which presses submit, and which resume,
// without a network existing. Cancellation keeps the real functions.
vi.mock("../../brain/runEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../brain/runEngine")>();
  return {
    ...actual,
    runChain: vi.fn(async () => ({ ok: true, status: "done", steps: [] })),
    resumeResearchRun: vi.fn(async () => ({
      ok: true,
      status: "done",
      versionId: "resumed-version",
    })),
  };
});

const askCard: Card = {
  id: "ask",
  kind: "askAi",
  blocks: [{ id: "ask-body", text: "Find the sharpest next step." }],
  position: { x: 0, y: 0 },
  model: "card/model",
};

const conversationCard: Card = {
  id: "conversation",
  kind: "conversation",
  blocks: [{ id: "conversation-body", text: "Should we ship?" }],
  position: { x: 0, y: 0 },
  conversationStyle: "critique",
  conversationTurns: 3,
};

function nodeProps(id: string): NodeProps {
  return {
    id,
    selected: false,
    data: { selectedCardCount: 0 },
  } as unknown as NodeProps;
}

function runningRun(cardId: string, kind: "ask" | "conversation"): RunRecord {
  return {
    id: `${kind}-run`,
    startedAt: "2026-07-18T00:00:00.000Z",
    askAiCardId: cardId,
    model: "default/model",
    usedCardIds: [],
    usedConnectionIds: [],
    modIds: [],
    appliedMods: [],
    compiledInstruction: "",
    status: "running",
    kind,
  };
}

function reset(
  cards: Card[] = [askCard, conversationCard],
  runs: RunRecord[] = [],
  overrides: {
    linkupKeyPresent?: boolean;
    provider?: "openrouter" | "claude-code" | "codex" | "antigravity";
  } = {},
) {
  useGraph.setState({
    cards,
    connections: [],
    outputs: [],
    runs,
    intentLog: [],
    undoStack: [],
    redoStack: [],
    selection: null,
    selectedCardIds: [],
    activeTool: "select",
    hydrated: false,
    keyPromptOpen: false,
    linkupKeyPresent: overrides.linkupKeyPresent ?? false,
    settings: {
      ...useGraph.getState().settings,
      apiKey: "test-key",
      provider: overrides.provider ?? "openrouter",
      model: "default/model",
      models: ["default/model", "card/model"],
    },
  });
}

function renderCard(
  CardComponent: typeof AskAiCard | typeof ConversationCard,
  id: string,
) {
  return render(
    <ReactFlowProvider>
      <CardComponent {...nodeProps(id)} />
    </ReactFlowProvider>,
  );
}

function KeyPromptSettings() {
  const open = useGraph((state) => state.keyPromptOpen);
  return open ? <SettingsModal initialCategory="ai" onClose={() => useGraph.getState().setKeyPromptOpen(false)} /> : null;
}

// The globe's tooltip is the reach surface (#964): hovering the control must
// say how far the armed state actually reaches. Fake timers stand in for the
// intent delay a real pointer would wait out; callers own the timer mode.
function hoverForTooltip(control: HTMLElement): string {
  fireEvent.pointerEnter(control);
  act(() => vi.advanceTimersByTime(DESIGN_TIMING_MS.intent));
  return screen.getByRole("tooltip").textContent ?? "";
}

function conversationSettingsEditCount() {
  return useGraph
    .getState()
    .intentLog.filter(
      (event) =>
        event.type === "card.content.edited" &&
        event.cardId === conversationCard.id &&
        event.data?.field === "conversationSettings",
    ).length;
}

describe("Ask and Conversation composition", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    vi.mocked(runChain).mockClear();
    vi.mocked(resumeResearchRun).mockClear();
    reset();
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "eidoDesktop");
    Reflect.deleteProperty(window, "eidoProfileReview");
  });

  it.each(["ask", "conversation"] as const)("opens API key settings after a real keyless %s Run press", async (kind) => {
    const actual = await vi.importActual<typeof import("../../brain/runEngine")>("../../brain/runEngine");
    if (kind === "ask") vi.mocked(runChain).mockImplementationOnce(actual.runChain);
    useGraph.setState((state) => ({
      settings: { ...state.settings, apiKey: "" },
      connections: [{
        id: "participant-conversation",
        from: { cardId: askCard.id }, to: { cardId: conversationCard.id },
        strength: "strong", polarity: "helps", role: "feeds",
      }],
    }));
    const Component = kind === "ask" ? AskAiCard : ConversationCard;
    render(
      <OverlayProvider>
        <ReactFlowProvider>
          <Component {...nodeProps(kind === "ask" ? askCard.id : conversationCard.id)} />
          <KeyPromptSettings />
        </ReactFlowProvider>
      </OverlayProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: kind === "ask" ? words.run : words.conversationRun }));

    expect(await screen.findByLabelText(words.apiKeyLabel)).toHaveValue("");
    expect(useGraph.getState().keyPromptOpen).toBe(true);
    expect(useGraph.getState().runs).toEqual([]);
  });

  it("gives Ask one engraved action, named secondary keys, and one foot state word", () => {
    const { container } = renderCard(AskAiCard, askCard.id);
    const foot = container.querySelector<HTMLElement>(".card-foot")!;

    expect(foot.querySelectorAll(".e-button--primary")).toHaveLength(1);
    expect(within(foot).getByRole("button", { name: words.run })).toHaveClass(
      "e-button--primary",
      "e-button--compact",
    );
    expect(
      within(foot).getByRole("button", { name: words.showWhatAiUsed }),
    ).toHaveClass("e-icon-button");
    expect(
      within(foot).getByRole("button", { name: words.whatWillRun }),
    ).toHaveClass("e-icon-button");
    expect(foot.querySelector(".mini-btn")).toBeNull();
    expect(within(foot).getByText(words.ready).closest(".e-state-word")).toHaveClass(
      "e-state-word",
      "t-value",
    );
    // The globe lives in the foot beside Run now (#960); the model row holds
    // the model alone.
    expect(
      within(foot).getByRole("button", { name: words.reachTurnOnWeb }),
    ).toHaveClass("e-icon-button");
    const modelRow = container.querySelector<HTMLElement>(".model-pick")!;
    expect(within(modelRow).queryByRole("button", { name: words.reachTurnOnWeb })).toBeNull();
    expect(modelRow.querySelector(".agent-chip")).toBeNull();
  });

  it("cycles Off to Web to Off without a Linkup key, and Research never appears", () => {
    const { container } = renderCard(AskAiCard, askCard.id);
    const foot = container.querySelector<HTMLElement>(".card-foot")!;

    const globe = within(foot).getByRole("button", { name: words.reachTurnOnWeb });
    expect(globe).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(globe);

    expect(useGraph.getState().cards.find((c) => c.id === askCard.id)?.agentic).toBe(true);
    // With no key there is nothing for Research to run, so the next press is
    // Off, not a state that cannot deliver, and no warning ever shows.
    const globeOn = within(foot).getByRole("button", { name: words.reachWebOn });
    expect(globeOn).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(words.reachResearchNote)).toBeNull();
    // Depth is a per-call decision the model makes now: no second control
    // stands beside the globe.
    expect(foot.querySelector(".web-depth-pick")).toBeNull();

    fireEvent.click(globeOn);
    const card = useGraph.getState().cards.find((c) => c.id === askCard.id);
    expect(card?.agentic).toBeUndefined();
    expect(within(foot).getByRole("button", { name: words.reachTurnOnWeb }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("cycles Off to Web to Research to Off with a key, warning at no arming press", () => {
    reset([askCard], [], { linkupKeyPresent: true });
    const { container } = renderCard(AskAiCard, askCard.id);
    const foot = container.querySelector<HTMLElement>(".card-foot")!;

    // Web: the common case. Reach is on, nothing is stored beyond the flag,
    // and no warning exists, because seconds of search are an ordinary press.
    fireEvent.click(within(foot).getByRole("button", { name: words.reachTurnOnWeb }));
    expect(useGraph.getState().cards.find((c) => c.id === askCard.id)?.agentic).toBe(true);
    expect(useGraph.getState().cards.find((c) => c.id === askCard.id)?.meta).toBeUndefined();
    expect(screen.queryByText(words.reachResearchNote)).toBeNull();

    // Research: the mode lands in card.meta and the globe changes family.
    // Arming warns nobody; the warning belongs to the Run press, the moment
    // that is actually about to spend.
    const toResearch = within(foot).getByRole("button", { name: words.reachWebOn });
    fireEvent.click(toResearch);
    expect(
      useGraph.getState().cards.find((c) => c.id === askCard.id)?.meta?.reachMode,
    ).toBe("research");
    const researchGlobe = within(foot).getByRole("button", { name: words.reachResearchOn });
    expect(researchGlobe).toHaveAttribute("aria-pressed", "true");
    expect(researchGlobe).toHaveClass("reach-toggle--research");
    expect(screen.queryByText(words.reachResearchNote)).toBeNull();

    // Off: one press clears the flag and the stored mode together, so the
    // next turn of the cycle starts at Web as the control promises.
    fireEvent.click(researchGlobe);
    const card = useGraph.getState().cards.find((c) => c.id === askCard.id);
    expect(card?.agentic).toBeUndefined();
    expect(card?.meta).toBeUndefined();
  });

  const researchCard: Card = {
    ...askCard,
    id: "ask-research-run",
    agentic: true,
    meta: { reachMode: "research" },
  };

  it("answers a research Run press with the depth choice, and takes a second Run press to spend", async () => {
    reset([structuredClone(researchCard)], [], { linkupKeyPresent: true });
    const { container } = renderCard(AskAiCard, researchCard.id);
    const foot = container.querySelector<HTMLElement>(".card-foot")!;

    // The Run press opens the question and submits nothing. The sentence
    // carries the one fact and no price; the price stands beside the keys.
    fireEvent.click(within(foot).getByRole("button", { name: words.run }));
    const note = screen.getByText(words.reachResearchNote);
    expect(note.textContent).not.toMatch(/[$€¢]|credit|cost|price/i);
    expect(vi.mocked(runChain)).not.toHaveBeenCalled();
    const depthRow = screen.getByRole("radiogroup", { name: words.researchDepthChoiceLabel });
    const depthKeys = within(depthRow).getAllByRole("radio");
    expect(depthKeys.map((key) => key.textContent)).toEqual(["S", "M", "L", "XL"]);
    // S, the cheapest, is the standing choice on a Card never asked, and the
    // control says so the way a radiogroup says it: one checked cell, which
    // the segmented recipe paints as a solid ink pill.
    expect(depthKeys[0]).toHaveAttribute("aria-checked", "true");
    expect(depthKeys.slice(1).every((key) => key.getAttribute("aria-checked") === "false"))
      .toBe(true);

    // The question holds Run, because Run is the key it asks for.
    expect(within(foot).getByRole("button", { name: words.run })).toHaveClass(
      "e-button--primary",
    );

    // The numbers, verbatim from the founder decision, and standing on the
    // Card rather than hidden behind a pointer: a tooltip is drawn on the
    // document, so on a coloured Card it arrived as a black pill from another
    // world and covered the sentence it was explaining.
    expect([
      words.researchDepthSHint,
      words.researchDepthMHint,
      words.researchDepthLHint,
      words.researchDepthXLHint,
    ]).toEqual(["2-5 min · $0.25", "3-5 min · $0.50", "5-10 min · $1.50", "10-20 min · $2.50"]);
    expect(screen.getByText(words.researchDepthSHint)).toBeInTheDocument();

    // A depth press only sets the dial. It pins the choice on the Card, where
    // a reload finds it, moves the pressed key, and spends nothing: the
    // question stays up, waiting for the press that does (#971, revised).
    // A segmented cell answers to the pointer going down on it, the way a
    // dial does, so the press is a pointerdown and not a click.
    fireEvent.pointerDown(depthKeys[1], { button: 0 });
    expect(vi.mocked(runChain)).not.toHaveBeenCalled();
    expect(screen.getByText(words.reachResearchNote)).toBeInTheDocument();
    expect(
      useGraph.getState().cards.find((c) => c.id === researchCard.id)?.meta?.researchDepth,
    ).toBe("M");
    const afterPick = within(
      screen.getByRole("radiogroup", { name: words.researchDepthChoiceLabel }),
    ).getAllByRole("radio");
    expect(afterPick[1]).toHaveAttribute("aria-checked", "true");
    expect(afterPick[0]).toHaveAttribute("aria-checked", "false");
    // The standing numbers follow the choice.
    expect(screen.getByText(words.researchDepthMHint)).toBeInTheDocument();
    expect(screen.queryByText(words.researchDepthSHint)).toBeNull();

    // Changing your mind is free, as many times as you like.
    fireEvent.pointerDown(afterPick[3], { button: 0 });
    expect(vi.mocked(runChain)).not.toHaveBeenCalled();
    expect(
      useGraph.getState().cards.find((c) => c.id === researchCard.id)?.meta?.researchDepth,
    ).toBe("XL");

    // The second Run press is the consent. It closes the question and goes.
    fireEvent.click(within(foot).getByRole("button", { name: words.run }));
    await waitFor(() => expect(vi.mocked(runChain)).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(words.reachResearchNote)).toBeNull();

    // Every later Run press asks again, because a second run spends the same
    // money as the first, and the Card remembers the last depth pressed.
    await waitFor(() =>
      expect(within(foot).getByRole("button", { name: words.run })).toBeInTheDocument(),
    );
    fireEvent.click(within(foot).getByRole("button", { name: words.run }));
    expect(vi.mocked(runChain)).toHaveBeenCalledTimes(1);
    const reasked = screen.getByRole("radiogroup", { name: words.researchDepthChoiceLabel });
    const reaskedKeys = within(reasked).getAllByRole("radio");
    expect(reaskedKeys[3]).toHaveAttribute("aria-checked", "true");
    expect(reaskedKeys[0]).toHaveAttribute("aria-checked", "false");
  });

  it("stands the research question down when the globe leaves research, starting nothing", () => {
    reset([structuredClone(researchCard)], [], { linkupKeyPresent: true });
    const { container } = renderCard(AskAiCard, researchCard.id);
    const foot = container.querySelector<HTMLElement>(".card-foot")!;

    fireEvent.click(within(foot).getByRole("button", { name: words.run }));
    expect(screen.getByText(words.reachResearchNote)).toBeInTheDocument();

    // Backing out is the globe's job now that Run belongs to the question.
    // Cycling off research is the answer "not this way", so the question goes
    // with the mode it was about.
    fireEvent.click(within(foot).getByRole("button", { name: words.reachResearchOn }));
    expect(screen.queryByText(words.reachResearchNote)).toBeNull();
    expect(vi.mocked(runChain)).not.toHaveBeenCalled();
    expect(within(foot).getByRole("button", { name: words.run })).toHaveClass(
      "e-button--primary",
    );
  });

  it("offers Resume only in research mode with a standing job id, and Resume polls rather than submits", async () => {
    // A cancelled research run left a paid job standing: its id is stashed in
    // card.meta, and the run that would have consumed it is gone.
    reset(
      [{
        ...structuredClone(researchCard),
        meta: {
          reachMode: "research",
          researchJob: { id: "job-42", submittedAt: "2026-08-18T00:00:00.000Z" },
        },
      }],
      [],
      { linkupKeyPresent: true },
    );
    const { container } = renderCard(AskAiCard, researchCard.id);
    const foot = container.querySelector<HTMLElement>(".card-foot")!;

    // Resume re-attaches to the standing job; it never runs the chain and
    // never submits a new job.
    fireEvent.click(within(foot).getByRole("button", { name: words.researchResume }));
    await waitFor(() => expect(vi.mocked(resumeResearchRun)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(resumeResearchRun)).toHaveBeenCalledWith(
      researchCard.id,
      expect.anything(),
    );
    expect(vi.mocked(runChain)).not.toHaveBeenCalled();
  });

  it("never offers Resume outside research mode or without a standing job id", () => {
    // A standing job id on a Card whose reach has been cycled back to Web:
    // the stash survives, the offer does not, because Web mode cannot land a
    // research report.
    reset(
      [{
        ...structuredClone(askCard),
        agentic: true,
        meta: { researchJob: { id: "job-42", submittedAt: "2026-08-18T00:00:00.000Z" } },
      }],
      [],
      { linkupKeyPresent: true },
    );
    const web = renderCard(AskAiCard, askCard.id);
    expect(
      within(web.container.querySelector<HTMLElement>(".card-foot")!)
        .queryByRole("button", { name: words.researchResume }),
    ).toBeNull();
    web.unmount();

    // Research mode with nothing standing: there is nothing to resume.
    reset([structuredClone(researchCard)], [], { linkupKeyPresent: true });
    const research = renderCard(AskAiCard, researchCard.id);
    expect(
      within(research.container.querySelector<HTMLElement>(".card-foot")!)
        .queryByRole("button", { name: words.researchResume }),
    ).toBeNull();
  });

  it("never warns a web-mode Run press", async () => {
    const webCard: Card = { ...askCard, id: "ask-web-run", agentic: true };
    reset([webCard], [], { linkupKeyPresent: true });
    const { container } = renderCard(AskAiCard, webCard.id);
    const foot = container.querySelector<HTMLElement>(".card-foot")!;

    fireEvent.click(within(foot).getByRole("button", { name: words.run }));
    await waitFor(() => expect(vi.mocked(runChain)).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(words.reachResearchNote)).toBeNull();
  });

  it("reads a stored mode it does not recognise as Web", () => {
    reset([{ ...askCard, agentic: true, meta: { reachMode: "exhaustive" } }], [], {
      linkupKeyPresent: true,
    });
    const { container } = renderCard(AskAiCard, askCard.id);
    const foot = container.querySelector<HTMLElement>(".card-foot")!;

    expect(within(foot).getByRole("button", { name: words.reachWebOn }))
      .not.toHaveClass("reach-toggle--research");
    expect(screen.queryByText(words.reachResearchNote)).toBeNull();
  });

  it("says three words for three states, and nothing else", () => {
    vi.useFakeTimers();
    try {
      reset([{ ...askCard, agentic: true }]);
      const { container } = renderCard(AskAiCard, askCard.id);
      const foot = container.querySelector<HTMLElement>(".card-foot")!;
      const globe = within(foot).getByRole("button", { name: words.reachWebOn });

      // A tooltip is read in the half-second before a press. It names the mode
      // and stops; the reach explanations that briefly lived here are gone
      // (founder decision 2026-08-18). Label and tooltip are the same words,
      // so a pointer and a screen reader are told the same thing.
      expect(hoverForTooltip(globe)).toBe(words.reachWebOn);

      act(() => {
        useGraph.setState({ linkupKeyPresent: true });
      });
      fireEvent.click(globe);
      const researchGlobe = within(foot).getByRole("button", {
        name: words.reachResearchOn,
      });
      expect(researchGlobe).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("tooltip").textContent).toBe(words.reachResearchOn);

      // Off has no state worth naming, so it names the press instead.
      fireEvent.click(researchGlobe);
      expect(within(foot).getByRole("button", { name: words.reachTurnOnWeb }))
        .toHaveAttribute("aria-pressed", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["claude-code", "codex", "antigravity"] as const)(
    "shows CLI mode as a selected terminal chip and offers no cycle for %s",
    (provider) => {
      reset([{ ...askCard, agentic: true, meta: { reachMode: "research" } }], [], {
        linkupKeyPresent: true,
        provider,
      });
      const { container } = renderCard(AskAiCard, askCard.id);
      const foot = container.querySelector<HTMLElement>(".card-foot")!;

      const chip = within(foot).getByLabelText(words.agentHarness);
      expect(chip).toHaveClass("agent-chip", "e-chip--go");
      expect(chip.querySelector("svg.lucide-square-terminal")).toHaveAttribute("width", "14");
      // The harness reach reads as a selected mode, not a switch (#964).
      vi.useFakeTimers();
      try {
        expect(hoverForTooltip(chip)).toBe("CLI MODE");
      } finally {
        vi.useRealTimers();
      }
      expect(within(foot).queryByRole("button", { name: words.reachTurnOnWeb })).toBeNull();
      expect(within(foot).queryByRole("button", { name: words.reachWebOn })).toBeNull();
      expect(within(foot).queryByRole("button", { name: words.reachResearchOn })).toBeNull();
      // The harness runs its own tools its own way, so Eido's research warning
      // would be a claim about a job Eido is not running.
      expect(screen.queryByText(words.reachResearchNote)).toBeNull();
    },
  );

  it("shows the fixed review model and disables per-card model edits", () => {
    Object.defineProperty(window, "eidoDesktop", { configurable: true, value: true });
    Object.defineProperty(window, "eidoProfileReview", { configurable: true, value: true });
    reset([askCard]);

    renderCard(AskAiCard, askCard.id);

    const picker = screen.getByRole("combobox", { name: words.modelLabel });
    expect(picker).toBeDisabled();
    expect(picker).toHaveTextContent("GPT 5.6 Luna");
    expect(useGraph.getState().cards[0]?.model).toBe("card/model");
  });

  it("keeps Conversation style and bounded turns in persisted card state through a shared stepper", () => {
    const { container } = renderCard(ConversationCard, conversationCard.id);
    const foot = container.querySelector<HTMLElement>(".card-foot")!;

    expect(foot.querySelectorAll(".e-button--primary")).toHaveLength(1);
    expect(
      within(foot).getByRole("button", { name: words.conversationRun }),
    ).toHaveClass("e-button--primary", "e-button--compact");
    expect(foot.querySelector(".mini-btn")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: words.conversationStyle }),
    ).toHaveTextContent(words.conversationStyleCritique);
    expect(
      useGraph.getState().cards.find((card) => card.id === conversationCard.id)
        ?.conversationStyle,
    ).toBe("critique");

    const stepper = screen.getByRole("group", {
      name: words.conversationTurns,
    });
    const value = within(stepper).getByRole("spinbutton", {
      name: words.conversationTurns,
    });
    const decrement = within(stepper).getByRole("button", {
      name: "Decrease turns",
    });
    const increment = within(stepper).getByRole("button", {
      name: "Increase turns",
    });

    fireEvent.click(increment);
    expect(
      useGraph.getState().cards.find((card) => card.id === conversationCard.id)
        ?.conversationTurns,
    ).toBe(4);
    expect(value).toHaveValue(4);
    expect(conversationSettingsEditCount()).toBe(1);

    fireEvent.change(value, { target: { value: "99" } });
    expect(value).toHaveValue(20);
    expect(increment).toBeDisabled();
    expect(conversationSettingsEditCount()).toBe(2);

    fireEvent.change(value, { target: { value: "0" } });
    expect(value).toHaveValue(1);
    expect(decrement).toBeDisabled();
    expect(conversationSettingsEditCount()).toBe(3);
  });

  it("keeps real Ask and Conversation cancellation reachable without a second primary action", () => {
    reset([askCard], [runningRun(askCard.id, "ask")]);
    const ask = renderCard(AskAiCard, askCard.id);
    const askFoot = ask.container.querySelector<HTMLElement>(".card-foot")!;
    expect(askFoot.querySelector(".e-button--primary")).toBeNull();
    expect(
      within(askFoot).getByRole("button", { name: words.cancel }),
    ).toHaveClass("e-button--quiet", "e-button--compact");
    const runningState = within(askFoot).getByText(words.runningState).closest(".e-state-word")!;
    expect(runningState).toHaveClass("e-state-word--running", "ask-ai-state-word");
    expect(runningState).toHaveTextContent(/^Running$/);
    expect(runningState.querySelector(".e-state-word__pulse")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    fireEvent.click(
      within(askFoot).getByRole("button", { name: words.cancel }),
    );
    expect(useGraph.getState().runs[0]?.status).toBe("canceled");
    ask.unmount();

    reset(
      [conversationCard],
      [runningRun(conversationCard.id, "conversation")],
    );
    const conversation = renderCard(ConversationCard, conversationCard.id);
    const conversationFoot =
      conversation.container.querySelector<HTMLElement>(".card-foot")!;
    expect(conversationFoot.querySelector(".e-button--primary")).toBeNull();
    expect(
      within(conversationFoot).getByRole("button", {
        name: words.conversationCancel,
      }),
    ).toHaveClass("e-button--quiet", "e-button--compact");
    fireEvent.click(
      within(conversationFoot).getByRole("button", {
        name: words.conversationCancel,
      }),
    );
    expect(useGraph.getState().runs[0]?.status).toBe("canceled");
  });

  it("shows one shared next-step Callout and a failed state when Conversation cannot start", async () => {
    reset([conversationCard]);
    const { container } = renderCard(ConversationCard, conversationCard.id);

    fireEvent.click(
      screen.getByRole("button", { name: words.conversationRun }),
    );

    await waitFor(() =>
      expect(screen.getByText(words.errNoParticipants)).toBeInTheDocument(),
    );
    expect(container.querySelectorAll(".e-callout")).toHaveLength(1);
    expect(screen.getAllByText(words.errNoParticipants)).toHaveLength(1);
    expect(
      container.querySelector(".card-foot .e-state-word--failed"),
    ).toHaveTextContent(words.couldntRun);
  });
});
