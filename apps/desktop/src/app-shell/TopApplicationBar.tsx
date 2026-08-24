import { useTranslation } from "react-i18next";

import { Tooltip } from "../components/ui/Tooltip";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import { useDocumentStore } from "../graph/store/document-store";
import type { ProjectCommands } from "../graph/project/useProjectCommands";
import { useShortcutPreferenceStore } from "../preferences/shortcut-preference-store";
import { IconAction } from "./IconAction";
import { RuntimeStatusIndicator } from "./RuntimeStatusIndicator";
import { ScreenshotAssetBrowser } from "./ScreenshotAssetBrowser";
import { TaskSwitcher } from "./task-management/TaskSwitcher";

export interface GraphExecutionControls {
  cancelRun: () => Promise<void>;
  canCancel: boolean;
  canRun: boolean;
  run: { readonly state: string } | undefined;
  runGraph: () => Promise<void>;
}

export interface TopApplicationBarProps {
  execution: GraphExecutionControls;
  onOpenPalette: () => void;
  onOpenPublishing: () => void;
  onOpenSettings: () => void;
  onOpenWorkbench: () => void;
  projectCommands: ProjectCommands;
  showCompactPanels: boolean;
}

function ProjectIdentity({ commands }: { commands: ProjectCommands }) {
  const { t } = useTranslation();
  const projectName = useDocumentStore(
    (state) => state.history?.document.metadata.name,
  );

  if (projectName === undefined || !commands.location) {
    return (
      <span className="project-identity">{t("shell.project.noProject")}</span>
    );
  }

  return (
    <Tooltip
      content={t("project.identity.locationTooltip", {
        path: commands.location.displayPath,
      })}
    >
      <span className="project-identity" tabIndex={0}>
        <span className="project-identity__name">{projectName}</span>
        {commands.dirty ? (
          <span className="project-identity__unsaved">
            {t("project.identity.unsavedMarker")}
          </span>
        ) : null}
      </span>
    </Tooltip>
  );
}

export function TopApplicationBar({
  execution,
  onOpenPalette,
  onOpenPublishing,
  onOpenSettings,
  onOpenWorkbench,
  projectCommands,
  showCompactPanels,
}: TopApplicationBarProps) {
  const { t } = useTranslation();
  const resolveKeys = useShortcutPreferenceStore((s) => s.resolveKeys);
  const savingUnavailable =
    !projectCommands.hasDocument || projectCommands.busy;

  return (
    <header
      className="top-application-bar"
      aria-label={t("shell.toolbar.regionLabel")}
    >
      <div className="top-application-bar__identity">
        <span className="brand-mark" aria-hidden="true">
          <ProductIcon icon="panel.canvas" />
        </span>
        <span className="brand-name">{t("app.name")}</span>
        <span className="top-application-bar__divider" aria-hidden="true" />
        <ProjectIdentity commands={projectCommands} />
      </div>

      <TaskSwitcher />

      <div className="top-application-bar__actions">
        {showCompactPanels ? (
          <>
            <IconAction
              icon="panel.palette"
              label={t("shell.palette.open")}
              shortcut={resolveKeys("focusPalette")}
              onClick={onOpenPalette}
            />
            <IconAction
              icon="panel.device"
              label={t("shell.workbench.open")}
              shortcut={resolveKeys("focusDevice")}
              onClick={onOpenWorkbench}
            />
          </>
        ) : null}
        <RuntimeStatusIndicator />
        <span className="top-application-bar__action-group">
          <IconAction
            disabled={projectCommands.busy}
            icon="action.newProject"
            label={t("project.action.new")}
            onClick={projectCommands.requestNewProject}
          />
          <IconAction
            disabled={projectCommands.busy}
            icon="action.open"
            label={t("project.action.open")}
            onClick={projectCommands.requestOpenProject}
          />
          <IconAction
            disabled={savingUnavailable}
            icon="action.save"
            label={t("project.action.save")}
            shortcut={resolveKeys("save")}
            tooltip={
              projectCommands.hasDocument
                ? t("project.action.save")
                : t("shell.toolbar.unavailableWithoutProject")
            }
            onClick={projectCommands.save}
          />
          <IconAction
            disabled={savingUnavailable}
            icon="action.saveAs"
            label={t("project.action.saveAs")}
            shortcut={resolveKeys("saveAs")}
            tooltip={
              projectCommands.hasDocument
                ? t("project.action.saveAs")
                : t("shell.toolbar.unavailableWithoutProject")
            }
            onClick={projectCommands.saveAs}
          />
          <IconAction
            disabled={savingUnavailable || !projectCommands.location}
            icon="action.publish"
            label={t("publishing.action.open")}
            tooltip={
              projectCommands.location
                ? t("publishing.action.open")
                : t("shell.toolbar.unavailableWithoutProject")
            }
            onClick={onOpenPublishing}
          />
        </span>
        <ScreenshotAssetBrowser />
        <span className="top-application-bar__action-group">
          <IconAction
            disabled={!execution.canRun}
            icon="run.start"
            label={t("shell.toolbar.runGraph")}
            shortcut={resolveKeys("run")}
            tooltip={
              execution.canRun
                ? t("shell.toolbar.runGraph")
                : execution.run === undefined
                  ? t("shell.toolbar.runUnavailable")
                  : t("shell.toolbar.runAlreadyActive")
            }
            variant="primary"
            onClick={() => void execution.runGraph()}
          />
          <IconAction
            disabled={!execution.canCancel}
            icon="run.stop"
            label={t("shell.toolbar.stopGraph")}
            shortcut={resolveKeys("stop")}
            tooltip={
              execution.canCancel
                ? t("shell.toolbar.stopGraph")
                : t("shell.toolbar.unavailableWithoutRun")
            }
            onClick={() => void execution.cancelRun()}
          />
        </span>
        <IconAction
          icon="action.settings"
          label={t("shell.toolbar.openSettings")}
          shortcut={resolveKeys("openReference")}
          onClick={onOpenSettings}
        />
      </div>
    </header>
  );
}
