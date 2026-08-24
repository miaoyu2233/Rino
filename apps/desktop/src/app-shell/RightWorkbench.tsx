import { useTranslation } from "react-i18next";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/Tabs";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import { FunctionLibrary } from "../graph/functions/FunctionLibrary";
import { VariableLibrary } from "../graph/variables/VariableLibrary";
import { InspectorPanel } from "../graph/inspector/InspectorPanel";
import {
  layoutLimits,
  type RightWorkbenchTab,
} from "../preferences/layout-preferences";
import type { WindowMetrics } from "../platform/useWindowMetrics";
import { DevicePreviewPanel } from "../device-preview/DevicePreviewPanel";
import { IconAction } from "./IconAction";
import { ResizeHandle } from "./ResizeHandle";

export interface RightWorkbenchProps {
  activeTab: RightWorkbenchTab;
  metrics: WindowMetrics;
  onActiveTabChange: (tab: RightWorkbenchTab) => void;
  onCollapse?: () => void;
  onPreviewRatioChange: (delta: number) => void;
  previewRatio: number;
  tabbed?: boolean;
}

export function RightWorkbench({
  activeTab,
  metrics,
  onActiveTabChange,
  onCollapse,
  onPreviewRatioChange,
  previewRatio,
  tabbed = false,
}: RightWorkbenchProps) {
  const { t } = useTranslation();
  const functionLibrary = (
    <div className="right-workbench__function-library">
      <FunctionLibrary />
    </div>
  );
  const variableLibrary = (
    <div className="right-workbench__variable-library">
      <VariableLibrary />
    </div>
  );

  if (tabbed) {
    return (
      <Tabs
        className="right-workbench right-workbench--tabbed"
        value={activeTab}
        onValueChange={(value) => {
          onActiveTabChange(value as RightWorkbenchTab);
        }}
      >
        <TabsList aria-label={t("shell.workbench.title")}>
          <TabsTrigger value="device">
            <ProductIcon icon="panel.device" size="small" />
            {t("shell.workbench.device")}
          </TabsTrigger>
          <TabsTrigger value="inspector">
            <ProductIcon icon="panel.inspector" size="small" />
            {t("shell.workbench.inspector")}
          </TabsTrigger>
          <TabsTrigger value="functions">
            <ProductIcon icon="node.variable" size="small" />
            {t("shell.workbench.functions")}
          </TabsTrigger>
          <TabsTrigger value="variables">
            <ProductIcon icon="panel.values" size="small" />
            {t("shell.workbench.variables")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="device">
          <DevicePreviewPanel
            metrics={metrics}
            surfaceVisible={activeTab === "device"}
          />
        </TabsContent>
        <TabsContent value="inspector">
          <InspectorPanel />
        </TabsContent>
        <TabsContent value="functions">{functionLibrary}</TabsContent>
        <TabsContent value="variables">{variableLibrary}</TabsContent>
      </Tabs>
    );
  }

  const titleKey =
    activeTab === "inspector"
      ? "shell.workbench.inspector"
      : activeTab === "functions"
        ? "shell.workbench.functions"
        : activeTab === "variables"
          ? "shell.workbench.variables"
          : "shell.workbench.title";
  const iconName =
    activeTab === "inspector"
      ? "panel.inspector"
      : activeTab === "functions"
        ? "node.variable"
        : activeTab === "variables"
          ? "panel.values"
          : "panel.device";

  return (
    <aside
      className="application-panel right-workbench"
      aria-label={t(titleKey)}
      style={{ "--preview-ratio": previewRatio } as React.CSSProperties}
    >
      <header className="panel-header right-workbench__header">
        <div className="panel-title">
          <ProductIcon icon={iconName} />
          <h2>{t(titleKey)}</h2>
        </div>
        <div className="right-workbench__header-actions">
          <IconAction
            active={activeTab === "functions"}
            icon="node.variable"
            label={t("shell.workbench.functions")}
            onClick={() => {
              onActiveTabChange("functions");
            }}
          />
          <IconAction
            active={activeTab === "variables"}
            icon="panel.values"
            label={t("shell.workbench.variables")}
            onClick={() => {
              onActiveTabChange("variables");
            }}
          />
          {onCollapse === undefined ? null : (
            <IconAction
              icon="action.collapseRight"
              label={t("common.actions.collapse")}
              onClick={onCollapse}
            />
          )}
        </div>
      </header>
      <div
        className={`right-workbench__content ${
          activeTab !== "device" ? "right-workbench__content--single" : ""
        }`}
      >
        {activeTab === "device" ? (
          <>
            <DevicePreviewPanel metrics={metrics} surfaceVisible={true} />
            <ResizeHandle
              axis="vertical"
              ariaLabel={t("shell.resize.preview")}
              minimum={layoutLimits.previewRatio.minimum * 100}
              maximum={layoutLimits.previewRatio.maximum * 100}
              value={previewRatio * 100}
              onChange={onPreviewRatioChange}
            />
            <InspectorPanel />
          </>
        ) : activeTab === "functions" ? (
          functionLibrary
        ) : activeTab === "variables" ? (
          variableLibrary
        ) : (
          <InspectorPanel />
        )}
      </div>
    </aside>
  );
}
