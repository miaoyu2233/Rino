import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { useActiveDocument } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";

/** A non-persistent breadcrumb for the function graph currently being authored. */
export function FunctionNavigationBar() {
  const { t } = useTranslation();
  const activeGraphId = useEditorSessionStore((store) => store.activeGraphId);
  const leaveGraph = useEditorSessionStore((store) => store.leaveGraph);
  const document = useActiveDocument();
  const graph = document?.graphs.find(
    (candidate) => candidate.graphId === activeGraphId,
  );

  if (graph?.kind !== "function") {
    return null;
  }

  return (
    <nav
      className="function-navigation-bar"
      aria-label={t("graph.function.navigation.label")}
    >
      <div className="function-navigation-bar__identity">
        <ProductIcon icon="node.variable" size="small" />
        <span>{t("graph.function.navigation.prefix")}</span>
        <strong title={graph.name}>{graph.name}</strong>
      </div>
      <Button
        className="function-navigation-bar__back"
        size="compact"
        variant="ghost"
        title={t("graph.function.navigation.back")}
        aria-label={t("graph.function.navigation.back")}
        onClick={() => {
          leaveGraph(document?.entryGraphId);
        }}
      >
        <ProductIcon icon="action.collapseLeft" size="small" />
        <span>{t("graph.function.navigation.back")}</span>
      </Button>
    </nav>
  );
}
