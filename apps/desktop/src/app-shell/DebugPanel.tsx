import { useTranslation } from "react-i18next";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/Tabs";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import {
  debugPanelTabs,
  type DebugPanelTab,
} from "../preferences/layout-preferences";
import { EmptyState } from "./EmptyState";
import { IconAction } from "./IconAction";
import { ProblemsPanel } from "./ProblemsPanel";
import { RuntimeExecutionPanel } from "./RuntimeExecutionPanel";

const debugPanelIcons = {
  problems: "panel.problems",
  logs: "panel.logs",
  values: "panel.values",
  ocr: "panel.ocr",
  execution: "panel.execution",
  breakpoints: "panel.breakpoints",
} as const;

export interface DebugPanelProps {
  activeTab: DebugPanelTab;
  collapsed: boolean;
  onActiveTabChange: (tab: DebugPanelTab) => void;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function DebugPanel({
  activeTab,
  collapsed,
  onActiveTabChange,
  onCollapsedChange,
}: DebugPanelProps) {
  const { t } = useTranslation();

  return (
    <Tabs
      className="debug-panel"
      value={activeTab}
      onValueChange={(value) => {
        onActiveTabChange(value as DebugPanelTab);
      }}
    >
      <div className="debug-panel__header">
        <TabsList aria-label={t("shell.debug.title")}>
          {debugPanelTabs.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              <ProductIcon icon={debugPanelIcons[tab]} size="small" />
              <span>{t(`shell.debug.${tab}`)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <IconAction
          icon={collapsed ? "action.expandUp" : "action.collapseDown"}
          label={t(
            collapsed ? "common.actions.expand" : "common.actions.collapse",
          )}
          onClick={() => {
            onCollapsedChange(!collapsed);
          }}
        />
      </div>
      {collapsed
        ? null
        : debugPanelTabs.map((tab) => (
            <TabsContent key={tab} value={tab}>
              {tab === "problems" ? (
                <ProblemsPanel />
              ) : tab === "execution" || tab === "logs" || tab === "values" ? (
                <RuntimeExecutionPanel mode={tab} />
              ) : (
                <EmptyState
                  icon={debugPanelIcons[tab]}
                  title={t(`shell.debug.empty.${tab}.title`)}
                  description={t("shell.debug.emptyDescription")}
                />
              )}
            </TabsContent>
          ))}
    </Tabs>
  );
}
