import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";
import { GraphCanvas } from "../graph/canvas/GraphCanvas";
import { FunctionNavigationBar } from "../graph/functions/FunctionNavigationBar";
import type { ProjectCommands } from "../graph/project/useProjectCommands";
import { useNodeRegistry } from "../graph/registry/registry-store";
import { useActiveDocument } from "../graph/store/document-store";
import { useRuntimeStore } from "../ipc/runtime-store";
import { EmptyState } from "./EmptyState";
import { RuntimeFailureNotice } from "./RuntimeFailureNotice";

export interface CanvasWorkspaceProps {
  projectCommands: ProjectCommands;
}

export function CanvasWorkspace({ projectCommands }: CanvasWorkspaceProps) {
  const { t } = useTranslation();
  const availability = useRuntimeStore((store) => store.availability);
  const runtimeFailed = useRuntimeStore(
    (store) => store.status?.state === "failed",
  );
  const document = useActiveDocument();
  const registry = useNodeRegistry();

  // The editor does not depend on the runtime, so a runtime failure never hides the graph
  // or the way to start one. It is reported beside the empty state, and once a project is
  // open the top bar's runtime indicator and the problems surface carry it.
  const showFailureNotice = runtimeFailed || availability === "unavailable";

  if (document !== undefined && registry !== undefined) {
    return (
      <main
        className="canvas-workspace"
        aria-label={t("shell.canvas.label")}
        tabIndex={0}
      >
        <FunctionNavigationBar />
        <GraphCanvas />
      </main>
    );
  }

  return (
    <main
      className="canvas-workspace"
      aria-label={t("shell.canvas.label")}
      tabIndex={0}
    >
      <div className="canvas-workspace__grid" aria-hidden="true" />
      <div className="canvas-workspace__placeholder">
        <EmptyState
          icon="panel.canvas"
          title={t("shell.canvas.emptyTitle")}
          description={t("shell.canvas.emptyDescription")}
          action={
            registry === undefined ? undefined : (
              <span className="canvas-workspace__entry-actions">
                <Button
                  variant="primary"
                  disabled={projectCommands.busy}
                  onClick={projectCommands.requestNewProject}
                >
                  {t("project.action.new")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={projectCommands.busy}
                  onClick={projectCommands.requestOpenProject}
                >
                  {t("project.action.open")}
                </Button>
              </span>
            )
          }
        />
        {showFailureNotice ? <RuntimeFailureNotice /> : null}
      </div>
    </main>
  );
}
