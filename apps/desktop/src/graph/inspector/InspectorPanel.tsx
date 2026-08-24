import type { NodeV1 } from "@rino/contracts";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "../../app-shell/EmptyState";
import { IconAction } from "../../app-shell/IconAction";
import { ScrollArea } from "../../components/ui/ScrollArea";
import { Tooltip } from "../../components/ui/Tooltip";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { resolveProductIcon } from "../../design-system/icons/product-icons";
import { translateDataKey } from "../../localization/data-keys";
import { displayPortType } from "../canvas/port-presentation";
import type { EditableValue } from "../commands/graph-commands";
import { FieldControl } from "../fields/FieldControl";
import {
  commitDisplayAlias,
  commitInputLiteral,
  commitNodeProperty,
} from "../fields/field-commands";
import {
  formatFieldValue,
  MAXIMUM_DISPLAY_ALIAS_LENGTH,
  type FieldEditor,
} from "../fields/field-editor";
import {
  buildLiteralFields,
  connectedInputPortIds,
  type LiteralField,
} from "../fields/literal-fields";
import {
  readPropertyFields,
  type PropertyField,
  type PropertyFieldSet,
} from "../fields/property-schema";
import { NodeRegistryIndex } from "../node-registry-index";
import { capabilityState, type PaletteEntry } from "../palette/palette-model";
import { useProblemFocusStore } from "../problems/problem-focus";
import { usePaletteCatalog } from "../palette/usePaletteCatalog";
import { useNodeRegistry } from "../registry/registry-store";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import { variableValueKindForNodeTypeKey } from "../variables/variable-authoring";
import { OcrInspectorSection } from "./OcrInspectorSection";
import { resolveEffectiveConfidenceThreshold } from "./ocr-inspector-model";
import { NumericWorkflowInspectorSection } from "./NumericWorkflowInspectorSection";
import { TaskChoiceInspectorSection } from "./TaskChoiceInspectorSection";
import { FunctionSignatureEditor } from "../functions/FunctionSignatureEditor";
import "./inspector.css";

interface FieldHelpProps {
  label: string;
  lines: readonly string[];
}

/** Hover and focus help for one field.
 *
 * The help supplements the label rather than replacing it: the control keeps its own
 * accessible name, and the explanation reaches keyboard users because the trigger is
 * focusable.
 */
function FieldHelp({ label, lines }: FieldHelpProps) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <Tooltip
      side="left"
      content={
        <div className="inspector-field__help-content">
          <strong>{label}</strong>
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      }
    >
      <button
        type="button"
        className="inspector-field__help"
        aria-label={label}
      >
        <ProductIcon icon="action.help" size="small" />
      </button>
    </Tooltip>
  );
}

/** The identity of the field that edits one input port's literal.
 *
 * A diagnostic names a port, not a control, so the panel needs a way to find the control
 * that port is edited through. Both sides derive it here rather than agreeing on a string
 * in two places. */
function literalFieldKey(portId: string): string {
  return `input:${portId}`;
}

interface InspectorFieldProps {
  label: string;
  required: boolean;
  helpLines: readonly string[];
  control: ReactNode;
  actions?: ReactNode;
  /** Marks the field so a problem that names it can move focus here. */
  fieldKey?: string;
}

function InspectorField({
  label,
  required,
  helpLines,
  control,
  actions,
  fieldKey,
}: InspectorFieldProps) {
  const { t } = useTranslation();

  return (
    <div className="inspector-field" data-field-key={fieldKey}>
      <div className="inspector-field__header">
        <span className="inspector-field__label">{label}</span>
        {required ? (
          <span
            className="inspector-field__required"
            title={t("graph.inspector.required")}
            aria-label={t("graph.inspector.required")}
          >
            *
          </span>
        ) : null}
        <FieldHelp label={label} lines={helpLines} />
      </div>
      <div className="inspector-field__body">
        {control}
        {actions}
      </div>
    </div>
  );
}

interface EditorSummaryOptions {
  editor: FieldEditor;
  translateUnit: (unitKey: string) => string;
  describeRange: (
    minimum: number | undefined,
    maximum: number | undefined,
  ) => string | undefined;
}

/** Describes the accepted values of an editor, so the help states limits and units
 * explicitly instead of leaving the user to discover them by being refused. */
function describeEditor({
  editor,
  translateUnit,
  describeRange,
}: EditorSummaryOptions): string[] {
  const lines: string[] = [];
  if (editor.kind === "number") {
    if (editor.unitKey !== undefined) {
      const unit = translateUnit(editor.unitKey);
      if (unit.length > 0) {
        lines.push(unit);
      }
    }
    const range = describeRange(editor.minimum, editor.maximum);
    if (range !== undefined) {
      lines.push(range);
    }
  }
  if (editor.kind === "text") {
    const range = describeRange(editor.minimumLength, editor.maximumLength);
    if (range !== undefined) {
      lines.push(range);
    }
  }
  return lines;
}

/** Stored properties the definition's schema does not declare.
 *
 * A document saved by a newer definition, or by a build that knew a property this one does
 * not, keeps those values. They are shown read-only so the panel never suggests a node
 * holds less configuration than it does. */
function undeclaredProperties(
  properties: Record<string, EditableValue>,
  propertySet: PropertyFieldSet,
): Record<string, EditableValue> {
  const declared = new Set(
    propertySet.fields.map((field) => field.propertyKey),
  );
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => !declared.has(key)),
  );
}

interface NodeInspectorProps {
  graphId: string;
  node: NodeV1;
  connectedPortIds: ReadonlySet<string>;
}

function NodeInspector({
  graphId,
  node,
  connectedPortIds,
}: NodeInspectorProps) {
  const { t } = useTranslation();
  const registry = useNodeRegistry();
  const catalog = usePaletteCatalog();

  const index = useMemo(
    () => (registry ? new NodeRegistryIndex(registry) : undefined),
    [registry],
  );
  const indexed = index?.find(node.typeKey);
  const entry: PaletteEntry | undefined = catalog?.entries.find(
    (candidate) => candidate.kind === "node" && candidate.key === node.typeKey,
  );

  const translateUnit = (unitKey: string): string =>
    translateDataKey(t, unitKey, "");

  /** A registry help key that resolves to nothing contributes no help line, so a field
   * without documentation shows no empty tooltip row. */
  const describeDataKey = (key: string | undefined): string[] => {
    if (key === undefined) {
      return [];
    }
    const text = translateDataKey(t, key, "");
    return text.length === 0 ? [] : [text];
  };

  const describeRange = (
    minimum: number | undefined,
    maximum: number | undefined,
  ): string | undefined => {
    if (minimum !== undefined && maximum !== undefined) {
      return t("graph.inspector.help.range", { minimum, maximum });
    }
    if (minimum !== undefined) {
      return t("graph.inspector.help.minimum", { minimum });
    }
    if (maximum !== undefined) {
      return t("graph.inspector.help.maximum", { maximum });
    }
    return undefined;
  };

  const aliasField = (
    <InspectorField
      label={t("graph.inspector.alias")}
      required={false}
      helpLines={[t("graph.inspector.aliasHelp")]}
      control={
        <FieldControl
          editor={{
            kind: "text",
            minimumLength: undefined,
            maximumLength: MAXIMUM_DISPLAY_ALIAS_LENGTH,
          }}
          value={node.displayAlias}
          required={false}
          label={t("graph.inspector.alias")}
          onCommit={(value) =>
            commitDisplayAlias(
              node.nodeId,
              typeof value === "string" ? value : "",
            )
          }
        />
      }
    />
  );

  if (!indexed) {
    // The registry has no definition for this type. The stored configuration is shown as
    // it is, and no editor is offered, because the editor cannot know what the values
    // mean without the definition that declared them.
    return (
      <div className="inspector-content">
        <header className="inspector-identity">
          <ProductIcon icon="runtime.warning" />
          <div className="inspector-identity__names">
            <span className="inspector-identity__title">
              {t("graph.node.unresolvedTitle", { typeKey: node.typeKey })}
            </span>
            <code className="inspector-identity__type font-code">
              {node.typeKey}
            </code>
          </div>
        </header>
        <p className="inspector-notice">
          {t("graph.node.unresolvedDescription")}
        </p>
        {aliasField}
        <StoredValueList
          title={t("graph.inspector.storedProperties")}
          values={node.properties}
        />
        <StoredValueList
          title={t("graph.inspector.storedInputValues")}
          values={node.inputValues}
        />
      </div>
    );
  }

  const definition = indexed.definition;
  const labels = entry && catalog ? catalog.describe(entry) : undefined;
  const title = labels?.title ?? translateDataKey(t, definition.titleKey);
  // No runtime has reported its capabilities yet, so the state is unknown rather than
  // unavailable, exactly as the palette reports it. Claiming a node cannot run would be a
  // guess about a backend that has not spoken.
  const capability = entry
    ? capabilityState(entry, undefined)
    : ("satisfied" as const);
  const propertySet = readPropertyFields(definition);
  const isVariableNode =
    variableValueKindForNodeTypeKey(node.typeKey) !== undefined;
  const visiblePropertyFields =
    node.typeKey === "core.logic.taskChoice"
      ? propertySet.fields.filter(
          (field) => field.propertyKey !== "selectedCaseId",
        )
      : propertySet.fields;
  const authorablePropertyFields = isVariableNode
    ? visiblePropertyFields.filter(
        (field) => field.propertyKey !== "variableId",
      )
    : visiblePropertyFields;
  const literalFields = buildLiteralFields(indexed, node, connectedPortIds);
  const confidenceField = propertySet.fields.find(
    (field) => field.propertyKey === "confidenceThreshold",
  );
  const effectiveConfidenceThreshold = resolveEffectiveConfidenceThreshold(
    node.properties["confidenceThreshold"],
    confidenceField?.defaultValue,
  );
  const storedProperties = undeclaredProperties(node.properties, propertySet);
  if (isVariableNode) {
    delete storedProperties["variableId"];
  }

  return (
    <div className="inspector-content">
      <header className="inspector-identity">
        <ProductIcon
          icon={resolveProductIcon(definition.iconKey, "category.flow")}
        />
        <div className="inspector-identity__names">
          <span className="inspector-identity__title">{title}</span>
        </div>
      </header>

      {capability === "satisfied" ? null : (
        <p className="inspector-notice" data-severity="warning">
          {t(
            capability === "unknown"
              ? "graph.palette.capability.unknown"
              : "graph.palette.capability.unavailable",
            {
              capabilities: (definition.requiredCapabilities ?? []).join("、"),
            },
          )}
        </p>
      )}

      {definition.deprecation === undefined ? null : (
        <p className="inspector-notice" data-severity="warning">
          {translateDataKey(
            t,
            definition.deprecation.reasonKey,
            t("graph.diagnostics.nodeTypeDeprecated"),
          )}
        </p>
      )}

      {aliasField}

      {node.typeKey === "vision.ocr" ? (
        <OcrInspectorSection
          graphId={graphId}
          nodeId={node.nodeId}
          roiConnected={connectedPortIds.has("roi")}
          effectiveConfidenceThreshold={effectiveConfidenceThreshold}
        />
      ) : null}

      <NumericWorkflowInspectorSection
        node={node}
        definition={definition}
        connectedPortIds={connectedPortIds}
      />

      {node.typeKey === "core.logic.taskChoice" ? (
        <TaskChoiceInspectorSection node={node} />
      ) : null}

      <section
        className="inspector-section"
        aria-label={t("graph.inspector.properties")}
      >
        <h3 className="inspector-section__title">
          {t("graph.inspector.properties")}
        </h3>
        {propertySet.schemaUnreadable ? (
          <p className="inspector-notice" data-severity="warning">
            {t("graph.inspector.unsupported.declarationInvalid")}
          </p>
        ) : null}
        {authorablePropertyFields.length === 0 &&
        !propertySet.schemaUnreadable ? (
          <p className="inspector-empty-note">
            {t("graph.inspector.noProperties")}
          </p>
        ) : (
          authorablePropertyFields.map((field) => (
            <PropertyRow
              key={field.propertyKey}
              field={field}
              node={node}
              helpLines={[
                ...describeDataKey(field.descriptionKey),
                ...describeEditor({
                  editor: field.editor,
                  translateUnit,
                  describeRange,
                }),
                ...(field.defaultValue === undefined
                  ? []
                  : [
                      t("graph.inspector.help.default", {
                        value: formatFieldValue(field.defaultValue),
                      }),
                    ]),
              ]}
            />
          ))
        )}
        {propertySet.hiddenFieldCount === 0 ? null : (
          <p className="inspector-notice" data-severity="warning">
            {t("graph.inspector.hiddenProperties", {
              count: propertySet.hiddenFieldCount,
            })}
          </p>
        )}
        <StoredValueList
          title={t("graph.inspector.storedProperties")}
          values={storedProperties}
        />
      </section>

      <section
        className="inspector-section"
        aria-label={t("graph.inspector.inputs")}
      >
        <h3 className="inspector-section__title">
          {t("graph.inspector.inputs")}
        </h3>
        {literalFields.length === 0 ? (
          <p className="inspector-empty-note">
            {t("graph.inspector.noInputs")}
          </p>
        ) : (
          literalFields.map((field) => (
            <LiteralRow
              key={field.portId}
              field={field}
              node={node}
              helpLines={[
                ...describeDataKey(field.descriptionKey),
                t("graph.inspector.help.type", {
                  type: displayPortType(t, field.typeLabel, "full"),
                }),
                ...describeEditor({
                  editor: field.editor,
                  translateUnit,
                  describeRange,
                }),
              ]}
            />
          ))
        )}
      </section>
    </div>
  );
}

interface StoredValueListProps {
  title: string;
  values: Record<string, EditableValue>;
}

/** Shows values the editor keeps but cannot edit, so a document is never reduced to what
 * this build happens to understand. */
function StoredValueList({ title, values }: StoredValueListProps) {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return null;
  }
  return (
    <dl className="inspector-stored">
      <dt className="inspector-section__title">{title}</dt>
      {entries.map(([key, value]) => (
        <dd key={key} className="inspector-stored__row">
          <code className="font-code">{key}</code>
          <code className="font-code">{formatFieldValue(value)}</code>
        </dd>
      ))}
    </dl>
  );
}

interface PropertyRowProps {
  field: PropertyField;
  node: NodeV1;
  helpLines: readonly string[];
}

function PropertyRow({ field, node, helpLines }: PropertyRowProps) {
  const { t } = useTranslation();
  const label = translateDataKey(t, field.labelKey, field.propertyKey);
  const value = Object.hasOwn(node.properties, field.propertyKey)
    ? node.properties[field.propertyKey]
    : undefined;
  const resettable =
    field.defaultValue !== undefined && !Object.is(value, field.defaultValue);

  return (
    <InspectorField
      label={label}
      required={field.required}
      helpLines={helpLines}
      control={
        <FieldControl
          editor={field.editor}
          value={value}
          required={field.required}
          label={label}
          onCommit={(next) =>
            commitNodeProperty(node.nodeId, field.propertyKey, next)
          }
        />
      }
      actions={
        field.defaultValue === undefined ? null : (
          <IconAction
            icon="run.restart"
            disabled={!resettable}
            label={t("graph.inspector.resetToDefault")}
            tooltip={t("graph.inspector.resetToDefaultHelp", {
              value: formatFieldValue(field.defaultValue),
            })}
            onClick={() => {
              commitNodeProperty(
                node.nodeId,
                field.propertyKey,
                field.defaultValue,
                "graph.history.resetProperty",
              );
            }}
          />
        )
      }
    />
  );
}

interface LiteralRowProps {
  field: LiteralField;
  node: NodeV1;
  helpLines: readonly string[];
}

function LiteralRow({ field, node, helpLines }: LiteralRowProps) {
  const { t } = useTranslation();
  const label = translateDataKey(t, field.labelKey, field.portId);

  // An input whose value cannot come from this panel says so in words rather than offering
  // a disabled box: the user needs to know where the value does come from.
  const unavailableReason = field.connected
    ? t("graph.inspector.drivenByConnection")
    : field.acceptsLiteral
      ? undefined
      : t("graph.inspector.literalNotAccepted");

  return (
    <InspectorField
      label={label}
      required={field.required}
      helpLines={helpLines}
      fieldKey={literalFieldKey(field.portId)}
      control={
        unavailableReason === undefined ? (
          <FieldControl
            editor={field.editor}
            value={field.value}
            required={field.required}
            label={label}
            onCommit={(next) =>
              commitInputLiteral(node.nodeId, field.portId, next)
            }
          />
        ) : (
          <div className="inspector-field__state">
            <p>{unavailableReason}</p>
            {field.value === undefined ? null : (
              <code className="font-code">{formatFieldValue(field.value)}</code>
            )}
          </div>
        )
      }
    />
  );
}

/** The selected-node inspector.
 *
 * It subscribes to the selected node itself and to a signature of that node's connected
 * inputs, rather than to the graph's node array, so an edit elsewhere in the graph does
 * not re-render the panel.
 */
export function InspectorPanel() {
  const { t } = useTranslation();
  const activeGraphId = useEditorSessionStore((store) => store.activeGraphId);
  const selectedNodeIds = useEditorSessionStore(
    (store) => store.selectedNodeIds,
  );
  const selectedNodeId =
    selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined;

  const activeGraph = useDocumentStore((store) =>
    activeGraphId === undefined
      ? undefined
      : store.history?.document.graphs.find(
          (candidate) => candidate.graphId === activeGraphId,
        ),
  );
  const functionGraph =
    activeGraph?.kind === "function" ? activeGraph : undefined;

  const node = useDocumentStore((store) =>
    activeGraphId === undefined || selectedNodeId === undefined
      ? undefined
      : store.history?.document.graphs
          .find((graph) => graph.graphId === activeGraphId)
          ?.nodes.find((candidate) => candidate.nodeId === selectedNodeId),
  );

  // A primitive signature keeps the panel from re-rendering when an unrelated connection
  // changes, while still reacting the moment this node's own inputs are rewired.
  const connectedSignature = useDocumentStore((store) => {
    if (activeGraphId === undefined || selectedNodeId === undefined) {
      return "";
    }
    const graph = store.history?.document.graphs.find(
      (candidate) => candidate.graphId === activeGraphId,
    );
    return graph
      ? [...connectedInputPortIds(graph.edges, selectedNodeId)].sort().join(" ")
      : "";
  });

  const connectedPortIds = useMemo(
    () => new Set(connectedSignature.split(" ").filter((id) => id.length > 0)),
    [connectedSignature],
  );

  const panelRef = useRef<HTMLElement>(null);
  const focusRequest = useProblemFocusStore((store) => store.request);
  const focusedRequestRef = useRef<number | undefined>(undefined);

  /** Answers the field part of a reveal request.
   *
   * The request survives until the affected node is both selected and rendered, so the
   * panel can move focus after the canvas has changed the selection rather than racing it.
   */
  useEffect(() => {
    const portId = focusRequest?.portId;
    if (
      focusRequest === undefined ||
      portId === undefined ||
      focusRequest.requestId === focusedRequestRef.current ||
      focusRequest.nodeId !== selectedNodeId ||
      node === undefined
    ) {
      return;
    }
    focusedRequestRef.current = focusRequest.requestId;

    const wanted = literalFieldKey(portId);
    for (const field of panelRef.current?.querySelectorAll(
      "[data-field-key]",
    ) ?? []) {
      if (field.getAttribute("data-field-key") !== wanted) {
        continue;
      }
      field
        .querySelector<HTMLElement>("input, select, textarea")
        ?.focus({ preventScroll: false });
      return;
    }
  }, [focusRequest, node, selectedNodeId]);

  const emptyState = (
    <EmptyState
      icon="panel.inspector"
      title={
        selectedNodeIds.length > 1
          ? t("graph.inspector.multipleSelectedTitle")
          : t("shell.workbench.inspectorEmptyTitle")
      }
      description={
        selectedNodeIds.length > 1
          ? t("graph.inspector.multipleSelectedDescription", {
              count: selectedNodeIds.length,
            })
          : t("shell.workbench.inspectorEmptyDescription")
      }
    />
  );

  return (
    <section
      ref={panelRef}
      className="workbench-section inspector-panel"
      aria-label={t("shell.workbench.inspector")}
    >
      <header className="workbench-section__header">
        <span>
          <ProductIcon icon="panel.inspector" />
          {t("shell.workbench.inspector")}
        </span>
      </header>
      {functionGraph !== undefined ? (
        <ScrollArea className="inspector-panel__scroll">
          <FunctionSignatureEditor graph={functionGraph} />
          {node === undefined ? (
            selectedNodeIds.length > 0 ? (
              emptyState
            ) : null
          ) : activeGraphId === undefined ? null : (
            <NodeInspector
              graphId={activeGraphId}
              node={node}
              connectedPortIds={connectedPortIds}
            />
          )}
        </ScrollArea>
      ) : node === undefined ? (
        emptyState
      ) : activeGraphId === undefined ? null : (
        <ScrollArea className="inspector-panel__scroll">
          <NodeInspector
            graphId={activeGraphId}
            node={node}
            connectedPortIds={connectedPortIds}
          />
        </ScrollArea>
      )}
    </section>
  );
}
