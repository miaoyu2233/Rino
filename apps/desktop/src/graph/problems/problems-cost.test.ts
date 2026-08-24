import { describe, expect, it } from "vitest";

import { applicationI18n } from "../../localization/i18n";
import { buildGraphScene, type GraphSceneName } from "../../test/graph-scenes";
import { NodeRegistryIndex } from "../node-registry-index";
import { developmentRegistrySnapshot } from "../registry/development-registry";
import { validateProjectDocument } from "../validate-graph";
import { countProblems, orderProblems } from "./problem-model";
import {
  describeProblemSubject,
  indexDocumentForSubjects,
} from "./problem-subject";

const registry = developmentRegistrySnapshot();
const registryIndex = new NodeRegistryIndex(registry);

/** A scene with every connection removed: the shape a project takes while it is being
 * assembled, and the largest number of diagnostics a graph of that size can produce. */
function unwiredScene(name: GraphSceneName) {
  const scene = buildGraphScene(name);
  const graph = scene.graph;
  return {
    nodeCount: scene.nodeCount,
    document: {
      ...scene.document,
      graphs: [{ ...graph, edges: [] }],
    },
  };
}

/** Everything the problems panel does before React is asked to draw a row. */
function buildPanelRows(name: GraphSceneName): {
  problemCount: number;
  elapsedMilliseconds: number;
} {
  const scene = unwiredScene(name);
  const translate = applicationI18n.getFixedT("zh-CN");

  const started = performance.now();
  const report = validateProjectDocument(scene.document, registry);
  const problems = orderProblems(report.diagnostics);
  countProblems(problems);
  const subjectIndex = indexDocumentForSubjects(scene.document);
  for (const problem of problems) {
    describeProblemSubject(problem, subjectIndex, registryIndex, translate);
  }
  return {
    problemCount: problems.length,
    elapsedMilliseconds: performance.now() - started,
  };
}

describe("problems panel cost", () => {
  it("reports every unsatisfied required input of an unwired scene", () => {
    const scene = unwiredScene("stress");
    const report = validateProjectDocument(scene.document, registry);

    expect(report.executable).toBe(false);
    // Two comparisons with two required inputs each, plus one branch condition, for every
    // four-node unit of the scene.
    expect(report.diagnostics).toHaveLength((scene.nodeCount / 4) * 5);
  });

  it("builds the panel's rows in time with the number of problems, not with the graph", () => {
    // Warm pass: the first call pays for lazy module work that would otherwise be
    // attributed to the smaller scene and distort the comparison.
    buildPanelRows("small");

    const reference = buildPanelRows("reference");
    const stress = buildPanelRows("stress");

    // The reference scene mixes in capture and recognition nodes, whose inputs the
    // unwiring leaves unsatisfied in different numbers, so its count is not simply half.
    expect(reference.problemCount).toBe(439);
    expect(stress.problemCount).toBe(1250);

    // The stress scene has under three times the problems of the reference scene and
    // twice the nodes. Looking a node up by scanning the node array for every row would
    // make this ratio grow with the product of the two, near six; keeping an index makes
    // it grow with the rows.
    const ratio =
      stress.elapsedMilliseconds / Math.max(reference.elapsedMilliseconds, 1);
    expect(ratio).toBeLessThan(4);
  });
});
