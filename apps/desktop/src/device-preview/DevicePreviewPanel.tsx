import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DeviceInteractionV1,
  NodeV1,
  PreviewArtifactDescriptorV1,
} from "@rino/contracts";

import { Tooltip } from "../components/ui/Tooltip";
import { Select } from "../components/ui/Select";
import { Dialog, DialogContent } from "../components/ui/Dialog";
import { EmptyState } from "../app-shell/EmptyState";
import { IconAction } from "../app-shell/IconAction";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import {
  useDevicePreviewSession,
  type DevicePreviewCaptureFailure,
  type PreviewLease,
} from "../ipc/device-preview-session-context";
import {
  isGraphRunActive,
  useRuntimeExecutionStore,
} from "../ipc/runtime-execution-store";
import {
  useWindowInteraction,
  type WindowMetrics,
} from "../platform/useWindowMetrics";
import {
  createAuthoringSelectionOverlay,
  readAuthoringCoordinateSelection,
  type AuthoringCoordinateSelection,
  type CoordinateNodeTypeKey,
} from "./authoring-selection";
import {
  commitPointPickerSelection,
  commitRectanglePickerSelection,
} from "./coordinate-picker-commands";
import {
  coordinatePickerUsesCurrentFrame,
  useCoordinatePickerStore,
  type CoordinatePickerKind,
} from "./coordinate-picker-store";
import { CoordinatePickerOverlay } from "./CoordinatePickerOverlay";
import { CaptureRegionOverlay } from "./CaptureRegionOverlay";
import { CaptureConfirmationDialog } from "./CaptureConfirmationDialog";
import { DeviceControlOverlay } from "./DeviceControlOverlay";
import { ExpandedDevicePreview } from "./ExpandedDevicePreview";
import { useCaptureWorkbench } from "./useCaptureWorkbench";
import { usePreviewRefresh, useWindowActivity } from "./usePreviewRefresh";
import {
  createFitPreviewTransform,
  type SourceCoordinateSpace,
  type SourcePoint,
  type SourceRectangle,
} from "./geometry";
import { projectDeviceOverlay, type DeviceOverlay } from "./overlay-model";
import { useEditorSessionStore } from "../graph/store/editor-session-store";
import { useDocumentStore } from "../graph/store/document-store";
import {
  previewRefreshRates,
  type PreviewRefreshRate,
} from "../preferences/layout-preferences";
import { useLayoutPreferenceStore } from "../preferences/layout-preference-store";

export interface DevicePreviewPanelProps {
  metrics: WindowMetrics;
  surfaceVisible?: boolean;
}

interface CaptureRegionSession {
  projectDocumentId: string;
  preview: PreviewArtifactDescriptorV1;
}

export function DevicePreviewPanel({
  metrics,
  surfaceVisible = true,
}: DevicePreviewPanelProps) {
  const { t } = useTranslation();
  const controller = useDevicePreviewSession();
  const captureWorkbench = useCaptureWorkbench();
  const windowActive = useWindowActivity();
  const windowInteracting = useWindowInteraction();

  const viewportRef = useRef<HTMLDivElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const fullFrameButtonRef = useRef<HTMLButtonElement>(null);
  const regionButtonRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const focusRestorePendingRef = useRef(false);
  const captureFocusTargetRef = useRef<"fullFrame" | "region" | undefined>(
    undefined,
  );
  const capturePreviewLeaseRef = useRef<PreviewLease | undefined>(undefined);

  const [userPaused, setUserPaused] = useState(false);
  const [expandedPreviewOpen, setExpandedPreviewOpen] = useState(false);
  const [regionSession, setRegionSession] = useState<CaptureRegionSession>();
  const previewRefreshFps = useLayoutPreferenceStore(
    (state) => state.layout.previewRefreshFps,
  );
  const updateLayoutPreference = useLayoutPreferenceStore(
    (state) => state.updateLayout,
  );

  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);
        setViewportSize((prev) => {
          if (prev.width === width && prev.height === height) {
            return prev;
          }
          return { width, height };
        });
      }
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const selectedNodeIds = useEditorSessionStore(
    (state) => state.selectedNodeIds,
  );
  const activeGraphId = useEditorSessionStore((state) => state.activeGraphId);
  const executionLocked = useDocumentStore((state) => state.executionLocked);
  const projectDocumentId = useDocumentStore(
    (state) => state.history?.document.documentId,
  );
  const hasOpenProject = projectDocumentId !== undefined;
  const runActive = useRuntimeExecutionStore((state) =>
    isGraphRunActive(state.run?.state),
  );

  const activeGraphNodes = useDocumentStore((state) => {
    if (!activeGraphId || !state.history) return undefined;
    const graph = state.history.document.graphs.find(
      (g) => g.graphId === activeGraphId,
    );
    return graph?.nodes;
  });

  const selectedCoordinateNode = useMemo<NodeV1 | undefined>(() => {
    if (!activeGraphNodes || selectedNodeIds.length !== 1) return undefined;
    const nodeId = selectedNodeIds[0];
    const node = activeGraphNodes.find((n) => n.nodeId === nodeId);
    if (
      node &&
      (node.typeKey === "core.geometry.point" ||
        node.typeKey === "core.geometry.rectangle" ||
        node.typeKey === "automation.clickPoint")
    ) {
      return node;
    }
    return undefined;
  }, [activeGraphNodes, selectedNodeIds]);

  const nodeSelection = useMemo<
    AuthoringCoordinateSelection | undefined
  >(() => {
    if (!selectedCoordinateNode) return undefined;
    return readAuthoringCoordinateSelection(selectedCoordinateNode);
  }, [selectedCoordinateNode]);

  const currentSource = useMemo<SourceCoordinateSpace | undefined>(() => {
    if (!controller.preview) return undefined;
    return {
      width: controller.preview.descriptor.sourceWidth,
      height: controller.preview.descriptor.sourceHeight,
      coordinateSpaceId: controller.preview.descriptor.sourceCoordinateSpaceId,
      sourceGeneration: controller.preview.descriptor.sourceGeneration,
    };
  }, [controller.preview]);

  const transform = useMemo(() => {
    if (!currentSource || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return undefined;
    }
    return createFitPreviewTransform(currentSource, viewportSize);
  }, [currentSource, viewportSize]);

  const isResolutionMismatch = useMemo(() => {
    if (!nodeSelection || !currentSource) return false;
    return (
      nodeSelection.referenceWidth !== currentSource.width ||
      nodeSelection.referenceHeight !== currentSource.height
    );
  }, [currentSource, nodeSelection]);

  const savedRawOverlay = useMemo<DeviceOverlay | undefined>(() => {
    if (!nodeSelection || !currentSource || isResolutionMismatch)
      return undefined;
    return createAuthoringSelectionOverlay(
      nodeSelection,
      currentSource,
      "saved-selection-overlay",
    );
  }, [currentSource, isResolutionMismatch, nodeSelection]);

  const savedProjectedOverlay = useMemo(() => {
    if (!savedRawOverlay || !transform) return undefined;
    return projectDeviceOverlay(transform, savedRawOverlay);
  }, [savedRawOverlay, transform]);

  const pickerSession = useCoordinatePickerStore((state) => state.session);
  const pickerRequest = useCoordinatePickerStore(
    (state) => state.pendingRequest,
  );

  const [announcement, setAnnouncement] = useState<string>("");
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  const captureFailureMessage =
    captureWorkbench.state.phase === "failed"
      ? t(
          `shell.device.captureWorkbench.failures.${captureWorkbench.state.reason}`,
        )
      : undefined;
  const devicePreviewWindowErrorMessage = controller.devicePreviewWindowError
    ? t("shell.device.independentWindow.failure")
    : undefined;

  const restoreFocus = useCallback(() => {
    if (actionButtonRef.current) {
      actionButtonRef.current.focus();
    } else if (regionButtonRef.current) {
      regionButtonRef.current.focus();
    } else if (fullFrameButtonRef.current) {
      fullFrameButtonRef.current.focus();
    } else if (headerRef.current) {
      headerRef.current.focus();
    }
  }, []);

  const requestFocusRestore = useCallback(() => {
    focusRestorePendingRef.current = true;
  }, []);

  const restoreCaptureFocus = useCallback(() => {
    const target = captureFocusTargetRef.current;
    captureFocusTargetRef.current = undefined;
    const button =
      target === "fullFrame"
        ? fullFrameButtonRef.current
        : target === "region"
          ? regionButtonRef.current
          : undefined;
    (button ?? headerRef.current)?.focus();
  }, []);

  const releaseCapturePreviewLease = useCallback(() => {
    capturePreviewLeaseRef.current?.release();
    capturePreviewLeaseRef.current = undefined;
  }, []);

  useEffect(
    () => () => {
      releaseCapturePreviewLease();
    },
    [releaseCapturePreviewLease],
  );

  useEffect(() => {
    if (pickerSession === undefined && focusRestorePendingRef.current) {
      focusRestorePendingRef.current = false;
      restoreFocus();
    }
  }, [pickerSession, restoreFocus]);

  const isConnected = controller.selectedDevice?.state === "connected";
  const isBusy =
    controller.phase === "loadingDevices" ||
    controller.phase === "connecting" ||
    controller.phase === "capturing";
  const deviceOperationBusy = isBusy || controller.interactionPending;
  const visiblePreview = controller.preview;
  const previewPhase = controller.phase;
  const canCapturePreview = controller.canCapturePreview;
  const capturePreview = controller.capture;

  const isPickingActive = pickerSession !== undefined;
  const isCaptureWorkbenchActive =
    captureWorkbench.state.phase !== "idle" &&
    captureWorkbench.state.phase !== "failed";

  const isRegionModeActive = regionSession !== undefined;
  const interactionLocked =
    isPickingActive || isRegionModeActive || isCaptureWorkbenchActive;

  const canControlPreview =
    isConnected &&
    controller.preview !== undefined &&
    controller.canControlDevice &&
    !runActive &&
    !executionLocked &&
    !interactionLocked;

  useEffect(() => {
    if (controller.preview === undefined && expandedPreviewOpen) {
      window.queueMicrotask(() => {
        setExpandedPreviewOpen(false);
      });
    }
  }, [controller.preview, expandedPreviewOpen]);

  useEffect(() => {
    if (regionSession === undefined) {
      return;
    }
    const descriptor = visiblePreview?.descriptor;
    const stillCurrent =
      isConnected &&
      projectDocumentId === regionSession.projectDocumentId &&
      descriptor !== undefined &&
      !isPickingActive &&
      !isCaptureWorkbenchActive;
    if (stillCurrent) {
      return;
    }
    window.queueMicrotask(() => {
      setRegionSession(undefined);
      releaseCapturePreviewLease();
      setAnnouncement(
        t(
          "shell.device.captureWorkbench.regionOverlay.announcements.cancelled",
        ),
      );
      restoreCaptureFocus();
    });
  }, [
    isCaptureWorkbenchActive,
    isConnected,
    isPickingActive,
    projectDocumentId,
    regionSession,
    releaseCapturePreviewLease,
    restoreCaptureFocus,
    t,
    visiblePreview,
  ]);

  useEffect(() => {
    if (
      isConnected &&
      visiblePreview === undefined &&
      previewPhase === "ready" &&
      canCapturePreview &&
      !isBusy &&
      !windowInteracting &&
      !isPickingActive &&
      !isRegionModeActive &&
      !isCaptureWorkbenchActive
    ) {
      void capturePreview();
    }
  }, [
    isConnected,
    canCapturePreview,
    capturePreview,
    isBusy,
    isPickingActive,
    isRegionModeActive,
    isCaptureWorkbenchActive,
    windowInteracting,
    previewPhase,
    visiblePreview,
  ]);

  const refreshEnabled =
    !deviceOperationBusy &&
    !isPickingActive &&
    !isRegionModeActive &&
    captureWorkbench.state.phase === "idle";

  usePreviewRefresh({
    enabled: refreshEnabled,
    deviceConnected: isConnected,
    userPaused,
    surfaceVisible,
    windowActive,
    windowInteracting,
    deviceBusy: isBusy,
    graphInteracting: false,
    runActive,
    targetRefreshFps: previewRefreshFps,
    refreshPreview: controller.refreshPreview,
  });

  useEffect(() => {
    if (!pickerSession) return;

    const isInvalid =
      selectedCoordinateNode?.nodeId !== pickerSession.target.nodeId ||
      !activeGraphId ||
      activeGraphId !== pickerSession.target.graphId ||
      !currentSource ||
      !coordinatePickerUsesCurrentFrame(pickerSession, currentSource);

    if (isInvalid) {
      requestFocusRestore();
      useCoordinatePickerStore.getState().cancel(pickerSession.sessionId);
      window.queueMicrotask(() => {
        setAnnouncement(
          t("shell.device.coordinatePicker.announcements.cancelled"),
        );
      });
    }
  }, [
    activeGraphId,
    currentSource,
    pickerSession,
    requestFocusRestore,
    restoreFocus,
    selectedCoordinateNode,
    t,
  ]);

  const handleTogglePause = useCallback(() => {
    setUserPaused((prev) => {
      const next = !prev;
      setAnnouncement(
        next
          ? t("shell.device.previewRefresh.announcements.paused")
          : t("shell.device.previewRefresh.announcements.resumed"),
      );
      return next;
    });
  }, [t]);

  const handleDeviceInteraction = useCallback(
    async (interaction: DeviceInteractionV1) => {
      if (!canControlPreview || controller.interactionPending) {
        return;
      }
      const completed = await controller.interact(interaction);
      if (!completed) {
        setLastError(t("shell.device.control.failure"));
        setAnnouncement(t("shell.device.control.failure"));
        return;
      }
      setLastError(undefined);
      setAnnouncement(
        interaction.kind === "click"
          ? t("shell.device.control.announcements.click")
          : interaction.kind === "longPress"
            ? t("shell.device.control.announcements.longPress")
            : interaction.kind === "swipe"
              ? t("shell.device.control.announcements.swipe")
              : t("shell.device.control.announcements.back"),
      );
      await controller.refreshPreview();
    },
    [canControlPreview, controller, t],
  );

  const handleStartPicking = useCallback(() => {
    if (
      !selectedCoordinateNode ||
      !activeGraphId ||
      !currentSource ||
      executionLocked
    ) {
      return;
    }

    setRegionSession(undefined);
    const kind: CoordinatePickerKind =
      selectedCoordinateNode.typeKey === "core.geometry.point" ||
      selectedCoordinateNode.typeKey === "automation.clickPoint"
        ? "point"
        : "rectangle";

    const target = {
      graphId: activeGraphId,
      nodeId: selectedCoordinateNode.nodeId,
      nodeTypeKey: selectedCoordinateNode.typeKey as CoordinateNodeTypeKey,
    };

    useCoordinatePickerStore.getState().begin(kind, target, currentSource);
    setLastError(undefined);

    setAnnouncement(
      kind === "point"
        ? t("shell.device.coordinatePicker.announcements.pointStarted")
        : t("shell.device.coordinatePicker.announcements.rectangleStarted"),
    );
  }, [
    activeGraphId,
    currentSource,
    executionLocked,
    selectedCoordinateNode,
    t,
  ]);

  useEffect(() => {
    if (pickerRequest === undefined) {
      return;
    }
    if (
      pickerRequest.target.graphId !== activeGraphId ||
      pickerRequest.target.nodeId !== selectedCoordinateNode?.nodeId
    ) {
      return;
    }
    if (
      currentSource === undefined ||
      executionLocked ||
      !isConnected ||
      controller.preview === undefined
    ) {
      useCoordinatePickerStore.getState().clearRequest(pickerRequest.requestId);
      return;
    }

    const requestId = pickerRequest.requestId;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (
        !cancelled &&
        useCoordinatePickerStore.getState().pendingRequest?.requestId ===
          requestId
      ) {
        handleStartPicking();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeGraphId,
    controller.preview,
    currentSource,
    executionLocked,
    handleStartPicking,
    isConnected,
    pickerRequest,
    selectedCoordinateNode,
  ]);

  const handleCancelPicking = useCallback(
    (sessionId?: number) => {
      if (useCoordinatePickerStore.getState().cancel(sessionId)) {
        requestFocusRestore();
        setAnnouncement(
          t("shell.device.coordinatePicker.announcements.cancelled"),
        );
        setLastError(undefined);
      }
    },
    [requestFocusRestore, t],
  );

  const handleCommitPoint = useCallback(
    (sessionId: number, point: SourcePoint) => {
      const result = commitPointPickerSelection(sessionId, point);
      if (result.ok && result.selection.kind === "point") {
        requestFocusRestore();
        setLastError(undefined);
        setAnnouncement(
          t("shell.device.coordinatePicker.announcements.pointCommitted", {
            x: result.selection.x,
            y: result.selection.y,
          }),
        );
      } else {
        const errorMsg = result.ok
          ? ""
          : result.reason === "commandRejected"
            ? t("shell.device.coordinatePicker.announcements.commandRejected")
            : t("shell.device.coordinatePicker.announcements.staleFrame");
        setLastError(errorMsg);
        setAnnouncement(errorMsg);
      }
    },
    [requestFocusRestore, t],
  );

  const handleCommitRectangle = useCallback(
    (sessionId: number, rectangle: SourceRectangle) => {
      const result = commitRectanglePickerSelection(sessionId, rectangle);
      if (result.ok && result.selection.kind === "rectangle") {
        requestFocusRestore();
        setLastError(undefined);
        setAnnouncement(
          t("shell.device.coordinatePicker.announcements.rectangleCommitted", {
            x: result.selection.x,
            y: result.selection.y,
            width: result.selection.width,
            height: result.selection.height,
          }),
        );
      } else {
        const errorMsg = result.ok
          ? ""
          : result.reason === "commandRejected"
            ? t("shell.device.coordinatePicker.announcements.commandRejected")
            : t("shell.device.coordinatePicker.announcements.staleFrame");
        setLastError(errorMsg);
        setAnnouncement(errorMsg);
      }
    },
    [requestFocusRestore, t],
  );

  const handleError = useCallback((message: string) => {
    setLastError(message);
    setAnnouncement(message);
  }, []);

  const formatPreviewCaptureFailure = useCallback(
    (failure: DevicePreviewCaptureFailure | undefined): string => {
      const message =
        failure?.stage === "previewRead"
          ? t("shell.device.captureWorkbench.failures.preview.previewRead")
          : failure?.stage === "previewValidation"
            ? t(
                "shell.device.captureWorkbench.failures.preview.previewValidation",
              )
            : failure?.stage === "previewPresentation"
              ? t(
                  "shell.device.captureWorkbench.failures.preview.previewPresentation",
                )
              : t(
                  "shell.device.captureWorkbench.failures.preview.runtimeCapture",
                );
      return failure?.diagnosticCode
        ? `${message} ${t("shell.device.captureWorkbench.diagnosticCode", {
            code: failure.diagnosticCode,
          })}`
        : message;
    },
    [t],
  );

  const handleFullFrameCapture = useCallback(async () => {
    if (!hasOpenProject) return;
    captureFocusTargetRef.current = "fullFrame";
    setLastError(undefined);
    setAnnouncement(t("shell.device.captureWorkbench.steps.preparing"));
    const refreshed = await controller.capture();
    if (!refreshed) {
      const failure = controller.getLastCaptureFailure();
      const message = formatPreviewCaptureFailure(failure);
      setLastError(message);
      setAnnouncement(message);
      return;
    }
    const lease = controller.acquirePreviewLease();
    if (lease === undefined) {
      const message = t("shell.device.captureWorkbench.failures.stalePreview");
      setLastError(message);
      setAnnouncement(message);
      return;
    }
    let ok: boolean;
    try {
      ok = await captureWorkbench.prepare(lease.preview.descriptor);
    } finally {
      lease.release();
    }
    if (!ok) {
      setLastError(undefined);
    }
  }, [
    captureWorkbench,
    controller,
    formatPreviewCaptureFailure,
    hasOpenProject,
    t,
  ]);

  const handleToggleRegionMode = useCallback(async () => {
    if (isRegionModeActive) {
      setRegionSession(undefined);
      releaseCapturePreviewLease();
      restoreCaptureFocus();
      setAnnouncement(
        t(
          "shell.device.captureWorkbench.regionOverlay.announcements.cancelled",
        ),
      );
    } else {
      setLastError(undefined);
      setAnnouncement(t("shell.device.captureWorkbench.steps.preparing"));
      const refreshed = await controller.capture();
      if (!refreshed) {
        const failure = controller.getLastCaptureFailure();
        const message = formatPreviewCaptureFailure(failure);
        setLastError(message);
        setAnnouncement(message);
        return;
      }
      const lease = controller.acquirePreviewLease();
      if (
        lease === undefined ||
        projectDocumentId === undefined ||
        isPickingActive ||
        isCaptureWorkbenchActive
      ) {
        lease?.release();
        return;
      }
      const descriptor = lease.preview.descriptor;
      releaseCapturePreviewLease();
      capturePreviewLeaseRef.current = lease;
      captureFocusTargetRef.current = "region";
      setRegionSession({
        projectDocumentId,
        preview: descriptor,
      });
      setAnnouncement(
        t("shell.device.captureWorkbench.regionOverlay.announcements.started"),
      );
    }
  }, [
    controller,
    formatPreviewCaptureFailure,
    isCaptureWorkbenchActive,
    isPickingActive,
    isRegionModeActive,
    projectDocumentId,
    releaseCapturePreviewLease,
    restoreCaptureFocus,
    t,
  ]);

  const handleAcceptRegion = useCallback(
    async (region: SourceRectangle) => {
      const session = regionSession;
      const descriptor = session?.preview;
      const leasedDescriptor =
        capturePreviewLeaseRef.current?.preview.descriptor;
      const sessionIsCurrent =
        descriptor !== undefined &&
        session !== undefined &&
        projectDocumentId === session.projectDocumentId &&
        leasedDescriptor?.previewToken === descriptor.previewToken;
      setRegionSession(undefined);
      if (!sessionIsCurrent) {
        releaseCapturePreviewLease();
        setAnnouncement(
          t("shell.device.captureWorkbench.failures.stalePreview"),
        );
        restoreCaptureFocus();
        return;
      }
      setAnnouncement(
        t(
          "shell.device.captureWorkbench.regionOverlay.announcements.accepted",
          { w: region.width, h: region.height },
        ),
      );
      let ok: boolean;
      try {
        ok = await captureWorkbench.prepare(descriptor, region);
      } finally {
        releaseCapturePreviewLease();
      }
      if (!ok) {
        setLastError(undefined);
        return;
      }
      setLastError(undefined);
      setAnnouncement(
        t(
          "shell.device.captureWorkbench.regionOverlay.announcements.readyForName",
        ),
      );
    },
    [
      captureWorkbench,
      projectDocumentId,
      regionSession,
      releaseCapturePreviewLease,
      restoreCaptureFocus,
      t,
    ],
  );

  const activityLabel = controller.interactionPending
    ? t("shell.device.phase.controlling")
    : controller.phase === "loadingDevices"
      ? t("shell.device.phase.loadingDevices")
      : controller.phase === "connecting"
        ? t("shell.device.phase.connecting")
        : t("shell.device.phase.capturing");

  const isPointNode = selectedCoordinateNode?.typeKey === "core.geometry.point";
  const isQuickClickNode =
    selectedCoordinateNode?.typeKey === "automation.clickPoint";

  const pickerActionText = useMemo(() => {
    if (isQuickClickNode) {
      return nodeSelection && !isResolutionMismatch
        ? t("shell.device.coordinatePicker.reselectQuickClick")
        : t("shell.device.coordinatePicker.selectQuickClick");
    }
    if (isPointNode) {
      return nodeSelection && !isResolutionMismatch
        ? t("shell.device.coordinatePicker.reselectPoint")
        : t("shell.device.coordinatePicker.selectPoint");
    }
    return nodeSelection && !isResolutionMismatch
      ? t("shell.device.coordinatePicker.reselectRectangle")
      : t("shell.device.coordinatePicker.selectRectangle");
  }, [isPointNode, isQuickClickNode, isResolutionMismatch, nodeSelection, t]);

  const selectionSummaryText = useMemo(() => {
    if (!selectedCoordinateNode) return undefined;
    if (nodeSelection) {
      if (nodeSelection.kind === "point") {
        return t("shell.device.coordinatePicker.selectedSummaryPoint", {
          x: nodeSelection.x,
          y: nodeSelection.y,
        });
      }
      return t("shell.device.coordinatePicker.selectedSummaryRect", {
        x: nodeSelection.x,
        y: nodeSelection.y,
        w: nodeSelection.width,
        h: nodeSelection.height,
      });
    }
    return isPointNode || isQuickClickNode
      ? t("shell.device.coordinatePicker.unselectedSummaryPoint")
      : t("shell.device.coordinatePicker.unselectedSummaryRect");
  }, [isPointNode, isQuickClickNode, nodeSelection, selectedCoordinateNode, t]);

  const buttonTooltip = useMemo(() => {
    if (!isConnected) {
      return t("shell.device.coordinatePicker.requiresDevice");
    }
    if (!controller.preview) {
      return t("shell.device.coordinatePicker.requiresFrame");
    }
    return undefined;
  }, [isConnected, controller.preview, t]);

  const captureTooltip = useMemo(() => {
    if (!hasOpenProject) {
      return t("shell.toolbar.unavailableWithoutProject");
    }
    if (!isConnected) {
      return t("shell.toolbar.unavailableWithoutDevice");
    }
    if (!controller.preview) {
      return t("shell.device.coordinatePicker.requiresFrame");
    }
    return undefined;
  }, [hasOpenProject, isConnected, controller.preview, t]);

  const independentPreviewTooltip = controller.canOpenDevicePreviewWindow
    ? t("shell.device.independentWindow.open")
    : t("shell.device.independentWindow.unavailable");

  const captureDisabled =
    !hasOpenProject ||
    !isConnected ||
    !controller.preview ||
    isBusy ||
    executionLocked ||
    isPickingActive ||
    isCaptureWorkbenchActive;

  return (
    <section className="workbench-section device-preview">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <header
        ref={headerRef}
        tabIndex={-1}
        className="workbench-section__header"
      >
        <span>
          <ProductIcon icon="panel.device" />
          {t("shell.workbench.device")}
          {userPaused && (
            <span className="device-preview__status-badge font-code">
              {t("shell.device.previewRefresh.pausedLabel")}
            </span>
          )}
        </span>
      </header>

      <div className="device-preview__device-row">
        <label htmlFor="rino-device-selector" className="sr-only">
          {t("shell.device.selectorLabel")}
        </label>
        <Select
          id="rino-device-selector"
          disabled={
            !controller.canUseDeviceManagement || isBusy || interactionLocked
          }
          value={controller.selectedDeviceKey}
          placeholder={
            controller.canUseDeviceManagement
              ? t("shell.device.noDevices")
              : t("shell.device.backendUnavailable")
          }
          options={controller.devices.map((device) => ({
            value: device.deviceKey,
            label: device.displayName,
          }))}
          onValueChange={(deviceKey) => {
            controller.selectDevice(deviceKey);
          }}
        />
        <IconAction
          disabled={
            !controller.canUseDeviceManagement || isBusy || interactionLocked
          }
          icon="device.refresh"
          label={t("shell.device.refreshDevices")}
          onClick={() => {
            void controller.refreshDevices();
          }}
        />
        <div className="device-preview__device-actions">
          <IconAction
            disabled={!isConnected || isBusy || interactionLocked}
            icon={userPaused ? "run.start" : "run.pause"}
            label={
              userPaused
                ? t("shell.device.previewRefresh.resume")
                : t("shell.device.previewRefresh.pause")
            }
            onClick={handleTogglePause}
            tooltip={
              userPaused
                ? t("shell.device.previewRefresh.resume")
                : t("shell.device.previewRefresh.pause")
            }
          />
          <IconAction
            disabled={
              !isConnected ||
              !controller.canCapturePreview ||
              isBusy ||
              interactionLocked
            }
            icon="device.refresh"
            label={t("shell.device.capture")}
            onClick={() => {
              void controller.capture();
            }}
            tooltip={
              isConnected
                ? t("shell.device.captureDescription")
                : t("shell.toolbar.unavailableWithoutDevice")
            }
          />
          <IconAction
            disabled={
              controller.selectedDevice === undefined ||
              isBusy ||
              interactionLocked
            }
            icon={isConnected ? "device.disconnect" : "device.connect"}
            label={
              isConnected
                ? t("shell.device.disconnect")
                : t("shell.device.connect")
            }
            onClick={() => {
              void (isConnected
                ? controller.disconnect()
                : controller.connect());
            }}
          />
        </div>
      </div>

      <div className="device-preview__control-bar">
        <div className="device-preview__control-group">
          <label
            className="device-preview__refresh-rate"
            htmlFor="rino-preview-refresh-rate"
          >
            <span className="sr-only">
              {t("shell.device.previewRefresh.frameRate")}
            </span>
            <Select
              id="rino-preview-refresh-rate"
              value={previewRefreshFps.toString()}
              options={previewRefreshRates.map((rate) => ({
                value: rate.toString(),
                label: t("shell.device.previewRefresh.framesPerSecond", {
                  count: rate,
                }),
              }))}
              onValueChange={(value) => {
                const nextRate = Number(value);
                if (previewRefreshRates.some((rate) => rate === nextRate)) {
                  updateLayoutPreference({
                    previewRefreshFps: nextRate as PreviewRefreshRate,
                  });
                }
              }}
            />
          </label>
        </div>
        <div className="device-preview__metadata-inline">
          <span title={t("shell.device.resolution")} className="font-code">
            {controller.preview === undefined
              ? "—"
              : `${controller.preview.descriptor.sourceWidth.toString()}×${controller.preview.descriptor.sourceHeight.toString()}`}
          </span>
          <span title={t("shell.device.scaleFactor")} className="font-code">
            {metrics.scaleFactor.toFixed(2)}×
          </span>
        </div>
        <IconAction
          disabled={controller.preview === undefined}
          icon="action.expandPreview"
          label={t("shell.device.expandedPreview.open")}
          onClick={() => {
            setExpandedPreviewOpen(true);
          }}
          tooltip={t("shell.device.expandedPreview.open")}
        />
        <IconAction
          disabled={!controller.canOpenDevicePreviewWindow}
          icon="action.expandPreview"
          label={t("shell.device.independentWindow.open")}
          onClick={() => {
            void controller.openDevicePreviewWindow();
          }}
          tooltip={independentPreviewTooltip}
        />
      </div>

      <div className="device-preview__capture-bar">
        {captureTooltip && captureDisabled ? (
          <Tooltip content={captureTooltip}>
            <span className="icon-action__disabled-trigger">
              <button
                ref={fullFrameButtonRef}
                type="button"
                className="device-preview__capture-btn"
                disabled={captureDisabled}
                onClick={() => {
                  void handleFullFrameCapture();
                }}
              >
                <ProductIcon icon="node.imageRecognition" size="small" />
                {t("shell.device.captureWorkbench.fullFrame")}
              </button>
            </span>
          </Tooltip>
        ) : (
          <button
            ref={fullFrameButtonRef}
            type="button"
            className="device-preview__capture-btn"
            disabled={captureDisabled || isRegionModeActive}
            onClick={() => {
              void handleFullFrameCapture();
            }}
          >
            <ProductIcon icon="node.imageRecognition" size="small" />
            {t("shell.device.captureWorkbench.fullFrame")}
          </button>
        )}

        {captureTooltip && captureDisabled ? (
          <Tooltip content={captureTooltip}>
            <span className="icon-action__disabled-trigger">
              <button
                ref={regionButtonRef}
                type="button"
                className={`device-preview__capture-btn ${
                  isRegionModeActive
                    ? "device-preview__capture-btn--primary"
                    : ""
                }`}
                disabled={captureDisabled}
                onClick={() => {
                  void handleToggleRegionMode();
                }}
              >
                <ProductIcon icon="node.coordinate" size="small" />
                {isRegionModeActive
                  ? t("shell.device.captureWorkbench.cancelRegion")
                  : t("shell.device.captureWorkbench.region")}
              </button>
            </span>
          </Tooltip>
        ) : (
          <button
            ref={regionButtonRef}
            type="button"
            className={`device-preview__capture-btn ${
              isRegionModeActive ? "device-preview__capture-btn--primary" : ""
            }`}
            disabled={captureDisabled}
            onClick={() => {
              void handleToggleRegionMode();
            }}
          >
            <ProductIcon icon="node.coordinate" size="small" />
            {isRegionModeActive
              ? t("shell.device.captureWorkbench.cancelRegion")
              : t("shell.device.captureWorkbench.region")}
          </button>
        )}
      </div>

      {(selectedCoordinateNode !== undefined || isPickingActive) && (
        <div
          className={`device-preview__coordinate-toolbar ${
            isResolutionMismatch
              ? "device-preview__coordinate-toolbar--warning"
              : ""
          }`}
        >
          {isResolutionMismatch ? (
            <div className="device-preview__coordinate-toolbar-warning-row">
              <ProductIcon icon="runtime.warning" />
              <span>
                {t("shell.device.coordinatePicker.mismatchWarning", {
                  currentWidth: currentSource?.width ?? 0,
                  currentHeight: currentSource?.height ?? 0,
                  refWidth: nodeSelection?.referenceWidth ?? 0,
                  refHeight: nodeSelection?.referenceHeight ?? 0,
                })}
              </span>
            </div>
          ) : null}

          <div className="device-preview__coordinate-toolbar-main">
            {isPickingActive ? (
              <span className="device-preview__coordinate-instruction">
                {isPointNode || isQuickClickNode
                  ? t("shell.device.coordinatePicker.pointInstruction")
                  : t("shell.device.coordinatePicker.rectangleInstruction")}
              </span>
            ) : (
              <span className="device-preview__coordinate-summary">
                {selectionSummaryText}
              </span>
            )}

            <div className="device-preview__coordinate-actions">
              {isPickingActive ? (
                <button
                  type="button"
                  className="device-preview__coordinate-btn device-preview__coordinate-btn--cancel"
                  onClick={() => {
                    handleCancelPicking(pickerSession.sessionId);
                  }}
                >
                  <ProductIcon icon="action.close" size="small" />
                  {t("shell.device.coordinatePicker.cancel")}
                </button>
              ) : buttonTooltip ? (
                <Tooltip content={buttonTooltip}>
                  <span className="icon-action__disabled-trigger">
                    <button
                      ref={actionButtonRef}
                      type="button"
                      className="device-preview__coordinate-btn device-preview__coordinate-btn--primary"
                      disabled={
                        !isConnected ||
                        !controller.preview ||
                        isBusy ||
                        executionLocked ||
                        isRegionModeActive ||
                        isCaptureWorkbenchActive
                      }
                      onClick={handleStartPicking}
                    >
                      <ProductIcon icon="node.coordinate" size="small" />
                      {pickerActionText}
                    </button>
                  </span>
                </Tooltip>
              ) : (
                <button
                  ref={actionButtonRef}
                  type="button"
                  className="device-preview__coordinate-btn device-preview__coordinate-btn--primary"
                  disabled={
                    !isConnected ||
                    !controller.preview ||
                    isBusy ||
                    executionLocked ||
                    isRegionModeActive ||
                    isCaptureWorkbenchActive
                  }
                  onClick={handleStartPicking}
                >
                  <ProductIcon icon="node.coordinate" size="small" />
                  {pickerActionText}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {(lastError ??
      devicePreviewWindowErrorMessage ??
      captureFailureMessage) ? (
        <div className="device-preview__operation-error" role="alert">
          <ProductIcon icon="runtime.warning" size="small" />
          {lastError ??
            devicePreviewWindowErrorMessage ??
            captureFailureMessage}
        </div>
      ) : null}

      <div
        ref={viewportRef}
        className={`device-preview__screen ${
          userPaused ? "device-preview__screen--paused" : ""
        }`}
        style={{
          aspectRatio: currentSource
            ? `${currentSource.width.toString()} / ${currentSource.height.toString()}`
            : "16 / 9",
        }}
        aria-busy={isBusy}
      >
        {controller.preview === undefined ? (
          <EmptyState
            icon={
              controller.phase === "error" || !controller.canUseDeviceManagement
                ? "runtime.warning"
                : "panel.device"
            }
            title={
              controller.phase === "error"
                ? t("shell.device.previewError")
                : !controller.canUseDeviceManagement
                  ? t("shell.device.backendUnavailable")
                  : isConnected
                    ? t("shell.device.readyToCapture")
                    : t("shell.device.disconnected")
            }
            description={
              controller.phase === "error"
                ? t("shell.device.previewErrorDescription")
                : !controller.canUseDeviceManagement
                  ? t("shell.device.backendUnavailableDescription")
                  : isConnected
                    ? t("shell.device.readyToCaptureDescription")
                    : t("shell.device.disconnectedDescription")
            }
          />
        ) : (
          <img
            src={controller.preview.objectUrl}
            alt={t("shell.device.previewLabel")}
            draggable={false}
          />
        )}

        {transform &&
        controller.preview &&
        (isPickingActive || savedProjectedOverlay !== undefined) ? (
          <CoordinatePickerOverlay
            key={pickerSession ? pickerSession.sessionId : "saved-overlay"}
            transform={transform}
            session={pickerSession}
            savedOverlay={savedProjectedOverlay}
            savedRawOverlay={savedRawOverlay}
            onCommitPoint={handleCommitPoint}
            onCommitRectangle={handleCommitRectangle}
            onCancel={handleCancelPicking}
            onError={handleError}
            errorMessage={lastError ?? undefined}
            disabled={isBusy}
          />
        ) : null}

        {transform && controller.preview && isRegionModeActive ? (
          <CaptureRegionOverlay
            transform={transform}
            active={isRegionModeActive}
            onAcceptRegion={(region) => {
              void handleAcceptRegion(region);
            }}
            onCancel={() => {
              setRegionSession(undefined);
              releaseCapturePreviewLease();
              restoreCaptureFocus();
              setAnnouncement(
                t(
                  "shell.device.captureWorkbench.regionOverlay.announcements.cancelled",
                ),
              );
            }}
            onError={handleError}
            disabled={isBusy}
          />
        ) : null}

        {transform && controller.preview ? (
          <DeviceControlOverlay
            active={canControlPreview}
            disabled={deviceOperationBusy}
            label={t("shell.device.control.surfaceLabel")}
            transform={transform}
            onInteraction={(interaction) => {
              void handleDeviceInteraction(interaction);
            }}
          />
        ) : null}

        {deviceOperationBusy ? (
          <div className="device-preview__activity" role="status">
            <ProductIcon icon="runtime.running" />
            {activityLabel}
          </div>
        ) : null}
      </div>

      <CaptureConfirmationDialog
        state={captureWorkbench.state}
        onDisplayNameChange={(displayName) => {
          captureWorkbench.setDisplayName(displayName);
        }}
        onConfirm={() => {
          void captureWorkbench.commit();
        }}
        onRetrySave={() => {
          void captureWorkbench.retrySave();
        }}
        onDiscard={() => {
          void captureWorkbench.discard().then((discarded) => {
            if (discarded) {
              restoreCaptureFocus();
            }
          });
        }}
        onReset={() => {
          captureWorkbench.reset();
          restoreCaptureFocus();
        }}
      />

      <Dialog
        open={expandedPreviewOpen && controller.preview !== undefined}
        onOpenChange={setExpandedPreviewOpen}
      >
        <DialogContent
          className="expanded-device-preview"
          title={t("shell.device.expandedPreview.title")}
          description={t("shell.device.expandedPreview.description")}
          closeLabel={t("shell.device.expandedPreview.close")}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            void handleDeviceInteraction({ kind: "key", key: "back" });
          }}
        >
          {controller.preview === undefined ||
          currentSource === undefined ? null : (
            <>
              <div className="expanded-device-preview__toolbar">
                <span className="expanded-device-preview__rate font-code">
                  {t("shell.device.previewRefresh.framesPerSecond", {
                    count: previewRefreshFps,
                  })}
                </span>
              </div>
              <ExpandedDevicePreview
                controlActive={canControlPreview}
                controlDisabled={deviceOperationBusy}
                controlLabel={t("shell.device.control.surfaceLabel")}
                imageAlt={t("shell.device.previewLabel")}
                objectUrl={controller.preview.objectUrl}
                source={currentSource}
                onInteraction={(interaction) => {
                  void handleDeviceInteraction(interaction);
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
