// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useGraph } from "../../graph/store";
import type { Card, Output } from "../../graph/types";
import { words } from "../../shared/words";
import { OverlayProvider } from "../../ui/overlays";
import { ResultCard } from "./ResultCard";

const resultCard: Card = {
  id: "result",
  kind: "result",
  blocks: [{ id: "result-block", text: "" }],
  position: { x: 0, y: 0 },
};

const output: Output = {
  id: "output",
  resultCardId: resultCard.id,
  chosenVersionId: "v2",
  versions: [
    {
      id: "v1",
      number: 1,
      text: "First",
      createdAt: "2026-01-01T00:00:00.000Z",
      fromRunId: "run-1",
    },
    {
      id: "v2",
      number: 2,
      text: "Second",
      createdAt: "2026-01-02T00:00:00.000Z",
      fromRunId: "run-2",
    },
  ],
};

describe("existing Keep consumer", () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [resultCard],
      connections: [],
      outputs: [output],
      runs: [],
      intentLog: [],
      undoStack: [],
      redoStack: [],
      selection: null,
      selectedCardIds: [],
      activeTool: "select",
      hydrated: false,
    });
  });

  afterEach(cleanup);

  it("latches the viewed result version without moving the view", () => {
    render(
      <OverlayProvider>
        <ReactFlowProvider>
          <ResultCard
            {...({
              id: resultCard.id,
              selected: true,
              data: {},
            } as unknown as NodeProps)}
          />
        </ReactFlowProvider>
      </OverlayProvider>,
    );

    const keep = screen.getByRole("button", { name: words.keepThis });
    expect(keep).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(keep);

    const current = useGraph.getState().outputs[0];
    expect(current.chosenVersionId).toBe("v2");
    expect(
      current.versions.find((version) => version.id === "v2")?.accepted,
    ).toBe(true);
    expect(screen.getByRole("button", { name: words.keepThis })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
