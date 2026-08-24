import type { NodeV1 } from "@rino/contracts";
import type { NodeProps } from "@xyflow/react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, memo } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { buildGraphScene, sceneIdentifier } from "../../test/graph-scenes";
import { installInMemoryProjectService } from "../../test/project-transport-double";
import type { GraphCommand } from "../commands/graph-commands";
import { revealProblem } from "../problems/problem-focus";
import { useRegistryStore } from "../registry/registry-store";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../store/project-lifecycle";
import { useConnectionDragStore } from "./connection-drag-store";
import { filterNoOpNodeSelectionChanges } from "./graph-canvas-helpers";
import type { RinoFlowNode } from "./graph-view-model";

/** How many node components React could not skip.
 *
 * Declared through `vi.hoisted` because the module mock below is hoisted above the
 * imports and would otherwise read this before it exists.
 */
const renders = vi.hoisted(() => ({ nodes: 0 }));

/** The real node component wrapped in a memo that counts what React had to render.
 *
 * Wrapping rather than replacing keeps the measured tree the production tree: the counter
 * increments exactly when the production memo would also have had to re-render.
 *
 * Connections are not counted here. React Flow draws an edge only once both endpoints
 * have been measured, and the test environment has no layout engine, so no edge is ever
 * mounted. Edge cost is held to a budget one layer down, in
 * `graph-projection-cost.test.ts`, where it is measurable.
 */
vi.mock("./RinoNodeView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./RinoNodeView")>();
  const Counted = memo((props: NodeProps<RinoFlowNode>) => {
    renders.nodes += 1;
    return createElement(actual.RinoNodeView, props);
  });
  return { RinoNodeView: Counted };
});

const SCENE = buildGraphScene("reference");
const HUNDRED_NODE_SCENE = buildGraphScene("small");

function activeGraphId(): string {
  const graphId = useEditorSessionStore.getState().activeGraphId;
  if (graphId === undefined) {
    throw new Error("A project must be open.");
  }
  return graphId;
}

function runCommand(command: GraphCommand): void {
  const outcome = useDocumentStore
    .getState()
    .runCommand("graph.history.moveNode", command);
  if (!outcome.ok) {
    throw new Error(`The command should have applied: ${outcome.reason}`);
  }
}

function nodeOfType(
  typeKey: string,
  occurrence = 0,
  scene: typeof SCENE = SCENE,
): NodeV1 {
  const node = scene.graph.nodes.filter(
    (candidate) => candidate.typeKey === typeKey,
  )[occurrence];
  if (node === undefined) {
    throw new Error(`The scene has no ${typeKey}.`);
  }
  return node;
}

/** Runs an interaction and reports how many node components React rendered for it. */
function measure(interaction: () => void): number {
  renders.nodes = 0;
  act(interaction);
  return renders.nodes;
}

function openScene(scene: typeof SCENE = SCENE): void {
  render(<App />);
  act(() => {
    openProjectDocument(scene.document);
  });
}

/** Mounting five hundred nodes without a layout engine takes seconds, and how many
 * seconds depends on how much of the machine the other test files are using. The
 * measurement here is the render count, not the wall clock, so the timeout only has to be
 * far enough above the mount to stop a loaded machine reporting a false failure. */
const SCENE_MOUNT_TIMEOUT_MILLISECONDS = 60_000;

describe(
  "canvas interaction cost",
  { timeout: SCENE_MOUNT_TIMEOUT_MILLISECONDS },
  () => {
    beforeEach(() => {
      window.localStorage.clear();
      window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
      void applicationI18n.changeLanguage("zh-CN");
      closeProjectDocument();
      installInMemoryProjectService();
      useConnectionDragStore.getState().endDrag();
      renders.nodes = 0;
    });

    it("filters only selection changes that already match the current state", () => {
      const nodes = [
        { id: "selected", selected: true } as RinoFlowNode,
        { id: "unselected", selected: false } as RinoFlowNode,
      ];
      const changes = [
        { id: "selected", type: "select", selected: true } as const,
        { id: "unselected", type: "select", selected: false } as const,
        { id: "selected", type: "select", selected: false } as const,
        { id: "missing", type: "select", selected: false } as const,
      ];

      expect(filterNoOpNodeSelectionChanges(changes, nodes)).toEqual([
        changes[2],
        changes[3],
      ]);
    });

    it("draws each node of the reference scene exactly once on open", () => {
      openScene();

      expect(screen.getByLabelText("节点图")).toBeInTheDocument();
      expect(renders.nodes).toBe(SCENE.nodeCount);
    });

    it("redraws one node when a node moves in the reference scene", () => {
      openScene();

      expect(
        measure(() => {
          runCommand({
            kind: "moveNode",
            graphId: activeGraphId(),
            nodeId: nodeOfType("core.logic.branch").nodeId,
            position: { x: 4008, y: 4008 },
          });
        }),
      ).toBe(1);
    });

    it("redraws only the moved node in a 100-node scene", () => {
      openScene(HUNDRED_NODE_SCENE);

      expect(HUNDRED_NODE_SCENE.nodeCount).toBe(100);
      expect(
        measure(() => {
          runCommand({
            kind: "moveNode",
            graphId: activeGraphId(),
            nodeId: nodeOfType("core.logic.branch", 0, HUNDRED_NODE_SCENE)
              .nodeId,
            position: { x: 4008, y: 4008 },
          });
        }),
      ).toBe(1);
    });

    it("redraws one node when a connection is created", () => {
      openScene();

      expect(
        measure(() => {
          runCommand({
            kind: "addEdge",
            graphId: activeGraphId(),
            edge: {
              edgeId: sceneIdentifier("interaction/edge/added"),
              edgeKind: "data",
              sourceNodeId: nodeOfType("core.value.numberLiteral").nodeId,
              sourcePortId: "value",
              targetNodeId: nodeOfType("core.logic.branch", 1).nodeId,
              targetPortId: "condition",
            },
          });
        }),
      ).toBe(1);
    });

    it("redraws one node when the selection moves to it", () => {
      openScene();

      expect(
        measure(() => {
          revealProblem({
            graphId: activeGraphId(),
            nodeId: nodeOfType("vision.ocr").nodeId,
            edgeId: undefined,
            portId: undefined,
          });
        }),
      ).toBe(1);
    });

    it("redraws no node when a connection drag begins", () => {
      openScene();

      const graph = useDocumentStore.getState().history?.document.graphs[0];
      const registry = useRegistryStore.getState().snapshot;
      if (!graph || !registry) {
        throw new Error(
          "The scene document and the registry must be available.",
        );
      }

      // Highlighting is subscribed per port, so a drag that lights up every compatible
      // target never re-renders a node component.
      expect(
        measure(() => {
          useConnectionDragStore.getState().beginDrag(graph, registry, {
            nodeId: nodeOfType("core.value.numberLiteral").nodeId,
            portId: "value",
            handleType: "source",
          });
        }),
      ).toBe(0);
    });

    it("redraws nothing while an inline field is being typed into", async () => {
      const user = userEvent.setup();
      openScene();

      // A comparison whose inputs are free, so it draws inline literal editors.
      act(() => {
        runCommand({
          kind: "addNode",
          graphId: activeGraphId(),
          node: {
            nodeId: sceneIdentifier("interaction/node/loose-compare"),
            typeKey: "core.logic.numberCompare",
            typeVersion: 1,
            position: { x: -400, y: -400 },
            properties: { operator: "greaterThan" },
            inputValues: { left: 1, right: 2 },
          },
        });
      });

      const field = screen.getByLabelText(/数值比较 的 左值/);
      await user.click(field);

      renders.nodes = 0;
      await user.type(field, "23");

      // Typing holds a draft inside the control and creates no command, so the document
      // never changes and nothing is projected again.
      expect(renders.nodes).toBe(0);
    });
  },
);
