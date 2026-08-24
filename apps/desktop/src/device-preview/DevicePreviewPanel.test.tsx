import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DevicePreviewPanel } from "./DevicePreviewPanel";
import { useEditorSessionStore } from "../graph/store/editor-session-store";
import { useDocumentStore } from "../graph/store/document-store";
import { createEmptyProject } from "../graph/project-factory";
import { useCoordinatePickerStore } from "./coordinate-picker-store";
import type { WindowMetrics } from "../platform/useWindowMetrics";
import { RuntimeContext } from "../ipc/runtime-context";
import { DevicePreviewSessionProvider } from "../ipc/DevicePreviewSessionProvider";
import { TooltipProvider } from "../components/ui/Tooltip";
import type { ReactNode } from "react";
import type { RinoProjectDocumentV1 } from "@rino/contracts";
import type { RuntimeStatus } from "../ipc/runtime-contract";

import { useRuntimeStore } from "../ipc/runtime-store";
import { applicationI18n } from "../localization/i18n";

import * as useDevicePreviewModule from "../ipc/useDevicePreview";
import * as useCaptureWorkbenchModule from "./useCaptureWorkbench";

vi.mock("../ipc/useDevicePreview", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ipc/useDevicePreview")>();
  return {
    ...actual,
    useDevicePreview: vi.fn(),
  };
});

vi.mock("./useCaptureWorkbench", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useCaptureWorkbench")>();
  return {
    ...actual,
    useCaptureWorkbench: vi.fn(),
  };
});

class DummyResizeObserver {
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: {
            left: 0,
            top: 0,
            width: 500,
            height: 400,
            right: 500,
            bottom: 400,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
        } as ResizeObserverEntry,
      ],
      this,
    );
  }
  unobserve(): void {
    return;
  }
  disconnect(): void {
    return;
  }
}
globalThis.ResizeObserver = DummyResizeObserver;

const defaultMetrics: WindowMetrics = {
  width: 1280,
  height: 720,
  scaleFactor: 1,
};

const dummyStatus: RuntimeStatus = {
  state: "ready",
  generation: 1,
  automaticRestarts: 0,
  protocolVersion: 1,
  maximumFrameBytes: 1048576,
  featureFlags: [
    "runtime.deviceManagement",
    "runtime.devicePreview",
    "runtime.deviceControl",
  ],
};

function renderWithProviders(
  ui: ReactNode,
  hasPreview = true,
  canUseDeviceManagement = true,
) {
  void applicationI18n.changeLanguage("zh-CN");
  const status: RuntimeStatus = {
    ...dummyStatus,
  };
  act(() => {
    useRuntimeStore.setState({
      status: {
        ...status,
        devices: hasPreview
          ? [
              {
                deviceKey: "dev-1",
                displayName: "Test Device",
                state: "connected",
              },
            ]
          : [],
        selectedDeviceKey: hasPreview ? "dev-1" : undefined,
      } as unknown as never,
    });
  });

  const sampleDevice = {
    deviceKey: "dev-1",
    displayName: "Test Device",
    state: "connected" as const,
    controllerFamily: "adb" as const,
  };
  const samplePreview = hasPreview
    ? {
        descriptor: {
          previewToken: "tok-1",
          mediaType: "image/png" as const,
          byteLength: 40,
          sourceWidth: 1000,
          sourceHeight: 800,
          width: 1000,
          height: 800,
          expiresInMilliseconds: 60000,
          sourceCoordinateSpaceId: "space-1",
          sourceGeneration: 1,
        },
        objectUrl: "blob:http://localhost/test",
      }
    : undefined;
  const releasePreviewLease = vi.fn();

  const controller = {
    devices: hasPreview ? [sampleDevice] : [],
    selectedDevice: hasPreview ? sampleDevice : undefined,
    selectedDeviceKey: hasPreview ? "dev-1" : "",
    preview: samplePreview,
    phase: canUseDeviceManagement
      ? hasPreview
        ? "ready"
        : "disconnected"
      : "unavailable",
    canUseDeviceManagement,
    canCapturePreview: true,
    canControlDevice: true,
    interactionPending: false,
    selectDevice: vi.fn(),
    refreshDevices: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(true),
    refreshPreview: vi.fn().mockResolvedValue(true),
    getLastCaptureFailure: vi.fn().mockReturnValue(undefined),
    interact: vi.fn().mockResolvedValue(true),
    acquirePreviewLease: vi.fn(() =>
      samplePreview === undefined
        ? undefined
        : { preview: samplePreview, release: releasePreviewLease },
    ),
  } satisfies ReturnType<typeof useDevicePreviewModule.useDevicePreview>;
  vi.mocked(useDevicePreviewModule.useDevicePreview).mockReturnValue(
    controller,
  );

  return {
    ...render(
      <RuntimeContext.Provider
        value={{
          start: () => Promise.resolve(status),
          restart: () => Promise.resolve(status),
          shutdown: () => Promise.resolve({ ...status, state: "stopped" }),
          request: ((req: { method?: string }) => {
            if (req.method === "device.list" || req.method === "deviceList") {
              const devList = hasPreview
                ? [
                    {
                      deviceKey: "dev-1",
                      displayName: "Test Device",
                      state: "connected",
                    },
                  ]
                : [];
              return Promise.resolve({
                ok: true,
                devices: devList,
                selectedDeviceKey: hasPreview ? "dev-1" : undefined,
                payload: {
                  devices: devList,
                  selectedDeviceKey: hasPreview ? "dev-1" : undefined,
                },
              });
            }
            return Promise.resolve({ ok: true, payload: {} });
          }) as unknown as never,
          readPreview: () => {
            if (!hasPreview) return Promise.resolve(new Uint8Array([]));
            const buffer = new ArrayBuffer(40);
            const view = new DataView(buffer);
            const encoder = new TextEncoder();
            new Uint8Array(buffer).set(encoder.encode("rinoprev"), 0);
            view.setUint32(8, 1, true);
            view.setUint32(12, 1000, true);
            view.setUint32(16, 800, true);
            view.setBigUint64(20, BigInt(1), true);
            new Uint8Array(buffer).set(encoder.encode("space-1\0"), 28);
            return Promise.resolve(new Uint8Array(buffer));
          },
          readCapture: () => Promise.resolve(new Uint8Array()),
        }}
      >
        <TooltipProvider>
          <DevicePreviewSessionProvider>{ui}</DevicePreviewSessionProvider>
        </TooltipProvider>
      </RuntimeContext.Provider>,
    ),
    controller,
    releasePreviewLease,
  };
}

function setupTestDocument(): { doc: RinoProjectDocumentV1; graphId: string } {
  const doc = createEmptyProject({
    name: "测试项目",
    entryGraphName: "主图",
    createdAt: "2026-07-28T00:00:00.000Z",
  });
  const graph = doc.graphs[0];
  if (!graph) {
    throw new Error("Test graph must exist");
  }

  graph.nodes.push(
    {
      nodeId: "point-node-1",
      typeKey: "core.geometry.point",
      typeVersion: 1,
      position: { x: 0, y: 0 },
      properties: {},
      inputValues: {
        x: 100,
        y: 200,
        referenceWidth: 1000,
        referenceHeight: 800,
      },
    },
    {
      nodeId: "rect-node-1",
      typeKey: "core.geometry.rectangle",
      typeVersion: 1,
      position: { x: 100, y: 0 },
      properties: {},
      inputValues: {
        x: 50,
        y: 50,
        width: 200,
        height: 150,
        referenceWidth: 1000,
        referenceHeight: 800,
      },
    },
    {
      nodeId: "mismatch-point-node",
      typeKey: "core.geometry.point",
      typeVersion: 1,
      position: { x: 200, y: 0 },
      properties: {},
      inputValues: {
        x: 100,
        y: 200,
        referenceWidth: 1920,
        referenceHeight: 1080,
      },
    },
    {
      nodeId: "normal-node-1",
      typeKey: "core.flow.start",
      typeVersion: 1,
      position: { x: 300, y: 0 },
      properties: {},
      inputValues: {},
    },
    {
      nodeId: "quick-click-node-1",
      typeKey: "automation.clickPoint",
      typeVersion: 1,
      position: { x: 400, y: 0 },
      properties: { inputMode: "point" },
      inputValues: {},
    },
  );

  act(() => {
    useDocumentStore.setState({
      history: {
        document: doc,
        undoable: [],
        redoable: [],
        savedPositionId: 0,
        nextPositionId: 1,
        truncated: false,
      },
      executionLocked: false,
    });
    useEditorSessionStore.setState({
      activeGraphId: graph.graphId,
      selectedNodeIds: [],
    });
    useCoordinatePickerStore.setState({
      pendingRequest: undefined,
      session: undefined,
    });
  });

  return { doc, graphId: graph.graphId };
}

describe("DevicePreviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCaptureWorkbenchModule.useCaptureWorkbench).mockReturnValue({
      state: { phase: "idle" },
      prepare: vi.fn().mockResolvedValue(true),
      setDisplayName: vi.fn().mockReturnValue(true),
      commit: vi.fn().mockResolvedValue(true),
      retrySave: vi.fn().mockResolvedValue(true),
      discard: vi.fn().mockResolvedValue(true),
      reset: vi.fn().mockReturnValue(true),
    });
  });

  it("renders no coordinate toolbar when no coordinate node is selected", () => {
    setupTestDocument();
    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    expect(
      screen.queryByText(
        /从画面选择坐标|shell\.device\.coordinatePicker\.selectPoint/,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /从画面框选区域|shell\.device\.coordinatePicker\.selectRectangle/,
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps the preview surface at the source aspect ratio while picker controls change", () => {
    const { graphId } = setupTestDocument();
    const { container } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );

    const previewSurface = container.querySelector<HTMLElement>(
      ".device-preview__screen",
    );
    expect(previewSurface?.style.aspectRatio).toBe("1000 / 800");

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["rect-node-1"],
      });
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /(重新框选区域|从画面框选区域)/i,
      }),
    );

    expect(previewSurface?.style.aspectRatio).toBe("1000 / 800");
    expect(useCoordinatePickerStore.getState().session?.kind).toBe("rectangle");
  });

  it("starts a requested workflow-group region selection without a second click", async () => {
    const { graphId } = setupTestDocument();
    const { container } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["rect-node-1"],
      });
      useCoordinatePickerStore.getState().requestSelection("rectangle", {
        graphId,
        nodeId: "rect-node-1",
        nodeTypeKey: "core.geometry.rectangle",
      });
    });

    await waitFor(() => {
      expect(useCoordinatePickerStore.getState().session?.kind).toBe(
        "rectangle",
      );
    });
    expect(
      container.querySelector(".coordinate-picker-overlay--active"),
    ).toBeInTheDocument();
    expect(container.querySelector(".device-control-overlay")).toBeNull();
  });

  it("shows point coordinate toolbar when a point node is selected", () => {
    const { graphId } = setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["point-node-1"],
      });
    });

    expect(
      screen.getByText(
        /(重新选择坐标|从画面选择坐标|selectPoint|reselectPoint)/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /已存坐标: X 100, Y 200|shell\.device\.coordinatePicker\.selectedSummaryPoint/,
      ),
    ).toBeInTheDocument();
  });

  it("offers quick click picking for a click node", async () => {
    const { graphId } = setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["quick-click-node-1"],
      });
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /快捷点击：从画面取点|Quick click: pick from screen/,
      }),
    );

    await waitFor(() => {
      expect(useCoordinatePickerStore.getState().session?.kind).toBe("point");
    });
  });

  it("shows rectangle coordinate toolbar when a rectangle node is selected", () => {
    const { graphId } = setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["rect-node-1"],
      });
    });

    expect(
      screen.getByText(
        /(重新框选区域|从画面框选区域|selectRectangle|reselectRectangle)/i,
      ),
    ).toBeInTheDocument();
  });

  it("disables picker action button when device is disconnected and explains requirement", () => {
    const { graphId } = setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />, false);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["point-node-1"],
      });
    });

    const actionBtn = screen.getByRole("button", {
      name: /(重新选择坐标|从画面选择坐标|selectPoint|reselectPoint)/i,
    });
    expect(actionBtn).toBeDisabled();
  });

  it("distinguishes an unavailable device backend from an empty device scan", () => {
    setupTestDocument();

    renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
      false,
      false,
    );

    expect(
      screen.getByText(
        "当前运行时没有可用的本地 ADB 后端，无法发现或连接 Android 设备。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("未发现设备")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "设备" })).toBeDisabled();
  });

  it("renders resolution mismatch warning and resolutions when reference dimensions differ", () => {
    const { graphId } = setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />, true);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["mismatch-point-node"],
      });
    });

    const activeNodes = useDocumentStore
      .getState()
      .history?.document.graphs.find((g) => g.graphId === graphId)?.nodes;
    const mismatchNode = activeNodes?.find(
      (n) => n.nodeId === "mismatch-point-node",
    );
    expect(mismatchNode?.inputValues["referenceWidth"]).toBe(1920);
    expect(mismatchNode?.inputValues["referenceHeight"]).toBe(1080);
  });

  it("cancels session without document mutation when session becomes invalid", () => {
    const { graphId } = setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["point-node-1"],
      });
      useCoordinatePickerStore.setState({
        session: {
          sessionId: 99,
          kind: "point",
          target: {
            graphId: graphId,
            nodeId: "point-node-1",
            nodeTypeKey: "core.geometry.point",
          },
          source: {
            width: 1000,
            height: 800,
            coordinateSpaceId: "space-1",
            sourceGeneration: 1,
          },
        },
      });
    });

    act(() => {
      useCoordinatePickerStore.getState().cancel(99);
    });

    expect(useCoordinatePickerStore.getState().session).toBeUndefined();
  });

  it("starts point and rectangle sessions with exact visible source descriptor", async () => {
    const { graphId } = setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["point-node-1"],
      });
    });

    const startPointBtn = await screen.findByRole("button", {
      name: /(重新选择坐标|从画面选择坐标)/i,
    });
    act(() => {
      fireEvent.click(startPointBtn);
    });

    const pointSession = useCoordinatePickerStore.getState().session;
    expect(pointSession).toBeDefined();
    expect(pointSession?.kind).toBe("point");
    expect(pointSession?.source).toEqual({
      width: 1000,
      height: 800,
      coordinateSpaceId: "space-1",
      sourceGeneration: 1,
    });

    act(() => {
      useCoordinatePickerStore.getState().cancel();
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["rect-node-1"],
      });
    });

    const startRectBtn = screen.getByRole("button", {
      name: /(重新框选区域|从画面框选区域)/i,
    });
    act(() => {
      fireEvent.click(startRectBtn);
    });

    const rectSession = useCoordinatePickerStore.getState().session;
    expect(rectSession).toBeDefined();
    expect(rectSession?.kind).toBe("rectangle");
    expect(rectSession?.source).toEqual({
      width: 1000,
      height: 800,
      coordinateSpaceId: "space-1",
      sourceGeneration: 1,
    });
  });

  it("shows existing matching selection summary and overlay input", async () => {
    const { graphId } = setupTestDocument();

    const { container } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );
    await screen.findByAltText(/设备画面|preview/i);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["point-node-1"],
      });
    });

    expect(screen.getByText(/已存坐标: X 100, Y 200/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /重新选择坐标/ }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".coordinate-picker-overlay__saved"),
    ).toBeInTheDocument();
  });

  it("restores focus and leaves one history entry after successful commit", async () => {
    const { graphId } = setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);
    await screen.findByAltText(/设备画面|preview/i);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["point-node-1"],
      });
    });

    const actionBtn = screen.getByRole("button", { name: /重新选择坐标/ });
    act(() => {
      fireEvent.click(actionBtn);
    });

    const session = useCoordinatePickerStore.getState().session;
    expect(session).toBeDefined();

    const interactionSurface = screen.getByRole("application");
    fireEvent.keyDown(interactionSurface, { key: "Enter" });

    expect(useCoordinatePickerStore.getState().session).toBeUndefined();
    const history = useDocumentStore.getState().history;
    expect(history?.undoable.length).toBe(1);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /重新选择坐标/ }),
      ).toHaveFocus();
    });
  });

  it("retains session and shows associated error when execution is locked or command rejected", () => {
    const { graphId } = setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["point-node-1"],
      });
      useDocumentStore.setState({ executionLocked: true });
    });

    const actionBtn = screen.getByRole("button", { name: /重新选择坐标/ });
    expect(actionBtn).toBeDisabled();
  });

  it("renders controls in narrow panel and expanded English language without missing elements", async () => {
    const { graphId } = setupTestDocument();

    const narrowMetrics: WindowMetrics = {
      width: 480,
      height: 600,
      scaleFactor: 1,
    };

    renderWithProviders(<DevicePreviewPanel metrics={narrowMetrics} />);

    act(() => {
      void applicationI18n.changeLanguage("en-US");
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["point-node-1"],
      });
    });

    expect(
      await screen.findByRole("button", {
        name: /Select Point|Reselect Point|Repick point/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /Device|设备/ }),
    ).toBeInTheDocument();
  });

  it("maintains single useDevicePreview controller instance and handles reduced motion styling", () => {
    const { graphId } = setupTestDocument();

    const { container } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );

    act(() => {
      useEditorSessionStore.setState({
        activeGraphId: graphId,
        selectedNodeIds: ["point-node-1"],
      });
    });

    expect(container.querySelector(".device-preview")).toBeInTheDocument();
  });

  it("toggles pause and resume preview, showing status badge and announcing state", () => {
    setupTestDocument();

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    const pauseBtn = screen.getByRole("button", { name: "暂停预览" });
    fireEvent.click(pauseBtn);

    expect(screen.getByText("已暂停")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "恢复预览" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "恢复预览" }));
    expect(screen.queryByText("已暂停")).not.toBeInTheDocument();
  });

  it("enables direct device control by default and refreshes after a keyboard click", async () => {
    setupTestDocument();
    const { controller } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );

    const surface = await screen.findByRole("application", {
      name: "设备直接控制区",
    });
    expect(
      screen.queryByRole("button", { name: /控制设备|退出控制/ }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(surface, { key: "Enter" });

    await waitFor(() => {
      expect(controller.interact).toHaveBeenCalledWith({
        kind: "click",
        point: {
          x: 500,
          y: 400,
          coordinateSpaceId: "space-1",
          sourceGeneration: 1,
        },
      });
    });
    await waitFor(() => {
      expect(controller.refreshPreview).toHaveBeenCalledTimes(1);
    });
  });

  it("shows direct-control failures without requiring a coordinate node selection", async () => {
    setupTestDocument();
    const { controller } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );
    controller.interact.mockResolvedValueOnce(false);

    fireEvent.keyDown(
      await screen.findByRole("application", {
        name: "设备直接控制区",
      }),
      { key: "Enter" },
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "设备操作未能确认，请检查连接；该操作不会自动重试。",
    );
  });

  it("opens a centered large preview using the current image source", async () => {
    setupTestDocument();
    const { baseElement } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "放大预览" }));

    const dialog = await screen.findByRole("dialog", {
      name: "设备大屏预览",
    });
    expect(within(dialog).getByText("5 FPS")).toBeInTheDocument();
    const images = baseElement.querySelectorAll(
      'img[src="blob:http://localhost/test"]',
    );
    expect(images).toHaveLength(2);
  });

  it("routes Escape in the expanded preview to Android Back without closing it", async () => {
    setupTestDocument();
    const user = userEvent.setup();
    const { controller } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "放大预览" }));
    const dialog = await screen.findByRole("dialog", {
      name: "设备大屏预览",
    });

    await user.keyboard("{Escape}");

    expect(controller.interact).toHaveBeenCalledWith({
      kind: "key",
      key: "back",
    });
    expect(dialog).toBeInTheDocument();
  });

  it("holds the selected frame while preparing a full-frame capture", async () => {
    setupTestDocument();
    const prepareMock = vi.fn().mockResolvedValue(true);

    vi.mocked(useCaptureWorkbenchModule.useCaptureWorkbench).mockReturnValue({
      state: { phase: "idle" },
      prepare: prepareMock,
      setDisplayName: vi.fn().mockReturnValue(true),
      commit: vi.fn().mockResolvedValue(true),
      retrySave: vi.fn().mockResolvedValue(true),
      discard: vi.fn().mockResolvedValue(true),
      reset: vi.fn().mockReturnValue(true),
    });

    const { controller, releasePreviewLease } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );

    const fullFrameBtn = screen.getByRole("button", { name: "截取整屏" });
    fireEvent.click(fullFrameBtn);

    await waitFor(() => {
      expect(prepareMock).toHaveBeenCalledWith({
        previewToken: "tok-1",
        mediaType: "image/png",
        byteLength: 40,
        sourceWidth: 1000,
        sourceHeight: 800,
        width: 1000,
        height: 800,
        expiresInMilliseconds: 60000,
        sourceCoordinateSpaceId: "space-1",
        sourceGeneration: 1,
      });
    });
    expect(controller.acquirePreviewLease).toHaveBeenCalledOnce();
    expect(releasePreviewLease).toHaveBeenCalledOnce();
  });

  it("leaves capture preparation failures to the workbench dialog", async () => {
    setupTestDocument();
    const prepare = vi.fn().mockResolvedValue(false);
    vi.mocked(useCaptureWorkbenchModule.useCaptureWorkbench).mockReturnValue({
      state: { phase: "idle" },
      prepare,
      setDisplayName: vi.fn().mockReturnValue(true),
      commit: vi.fn().mockResolvedValue(true),
      retrySave: vi.fn().mockResolvedValue(true),
      discard: vi.fn().mockResolvedValue(true),
      reset: vi.fn().mockReturnValue(true),
    });

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);
    fireEvent.click(screen.getByRole("button", { name: "截取整屏" }));

    await waitFor(() => {
      expect(prepare).toHaveBeenCalledOnce();
    });
    expect(
      screen.queryByText("处理截图画面失败，请重试。"),
    ).not.toBeInTheDocument();
  });

  it("shows the preview capture stage and safe error code", async () => {
    setupTestDocument();
    const { controller } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );
    controller.capture.mockResolvedValueOnce(false);
    controller.getLastCaptureFailure.mockReturnValueOnce({
      stage: "previewRead",
      diagnosticCode: "PREVIEW_UNAVAILABLE",
    });

    fireEvent.click(screen.getByRole("button", { name: "截取整屏" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "设备画面已取得，但桌面端无法读取预览数据。 错误代码：PREVIEW_UNAVAILABLE",
    );
  });

  it("does not leave capture actions locked after a preparation failure", () => {
    setupTestDocument();
    vi.mocked(useCaptureWorkbenchModule.useCaptureWorkbench).mockReturnValue({
      state: { phase: "failed", reason: "prepareFailed" },
      prepare: vi.fn().mockResolvedValue(true),
      setDisplayName: vi.fn().mockReturnValue(true),
      commit: vi.fn().mockResolvedValue(true),
      retrySave: vi.fn().mockResolvedValue(true),
      discard: vi.fn().mockResolvedValue(true),
      reset: vi.fn().mockReturnValue(true),
    });

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    expect(
      screen.getByRole("button", { name: "截取整屏", hidden: true }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "框选区域", hidden: true }),
    ).toBeEnabled();
  });

  it("enters region selection mode on region action click and toggles back", async () => {
    setupTestDocument();

    const { releasePreviewLease } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} />,
    );

    const regionBtn = screen.getByRole("button", { name: "框选区域" });
    fireEvent.click(regionBtn);

    expect(
      await screen.findByRole("button", { name: "取消框选" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("application")).toBeInTheDocument();
    expect(releasePreviewLease).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "取消框选" }));
    expect(releasePreviewLease).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("application", { name: "设备直接控制区" }),
    ).toBeInTheDocument();
  });

  it("opens the naming confirmation after an accepted region capture", async () => {
    setupTestDocument();
    const prepare = vi.fn().mockResolvedValue(true);
    const commit = vi.fn().mockResolvedValue(true);
    const reset = vi.fn();
    vi.mocked(useCaptureWorkbenchModule.useCaptureWorkbench).mockReturnValue({
      state: { phase: "idle" },
      prepare,
      setDisplayName: vi.fn().mockReturnValue(true),
      commit,
      retrySave: vi.fn().mockResolvedValue(true),
      discard: vi.fn().mockResolvedValue(true),
      reset,
    });

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);
    fireEvent.click(screen.getByRole("button", { name: "框选区域" }));
    await screen.findByRole("button", { name: "取消框选" });
    fireEvent.keyDown(screen.getByRole("application"), { key: "Enter" });

    await waitFor(() => {
      expect(prepare).toHaveBeenCalledTimes(1);
    });
    expect(prepare.mock.calls[0]?.[1]).toMatchObject({
      width: 500,
      height: 400,
    });
    expect(commit).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("locks every frame-replacing device control during region selection", async () => {
    setupTestDocument();
    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    fireEvent.click(screen.getByRole("button", { name: "框选区域" }));
    await screen.findByRole("button", { name: "取消框选" });

    expect(screen.getByRole("button", { name: "暂停预览" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "截取画面" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "断开设备" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "刷新设备列表" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "设备" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消框选" })).toBeEnabled();
  });

  it("cancels region selection when the open project changes", async () => {
    setupTestDocument();
    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);
    fireEvent.click(screen.getByRole("button", { name: "框选区域" }));
    expect(screen.getByRole("application")).toBeInTheDocument();

    const replacement = createEmptyProject({
      name: "替换项目",
      entryGraphName: "新主图",
      createdAt: "2026-07-28T12:00:00.000Z",
    });
    act(() => {
      useDocumentStore.setState((state) => ({
        history: state.history
          ? { ...state.history, document: replacement }
          : undefined,
      }));
    });

    await waitFor(() => {
      expect(
        screen.getByRole("application", { name: "设备直接控制区" }),
      ).toBeInTheDocument();
    });
  });

  it("disables screenshot capture actions when no project document is open", () => {
    act(() => {
      useDocumentStore.setState({ history: undefined });
    });

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    expect(screen.getByRole("button", { name: "截取整屏" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "框选区域" })).toBeDisabled();
  });

  it("renders with surfaceVisible=false without crashing", () => {
    setupTestDocument();

    const { container } = renderWithProviders(
      <DevicePreviewPanel metrics={defaultMetrics} surfaceVisible={false} />,
    );

    expect(container.querySelector(".device-preview")).toBeInTheDocument();
  });

  it("passes controller actions to ConfirmationDialog and restores focus on reset", () => {
    setupTestDocument();
    const retrySaveMock = vi.fn().mockResolvedValue(true);
    const resetMock = vi.fn();

    vi.mocked(useCaptureWorkbenchModule.useCaptureWorkbench).mockReturnValue({
      state: {
        phase: "saveFailed",
        assetId: "asset-1",
        displayName: "capture-1",
        reason: "saveFailed",
      },
      prepare: vi.fn().mockResolvedValue(true),
      setDisplayName: vi.fn().mockReturnValue(true),
      commit: vi.fn().mockResolvedValue(true),
      retrySave: retrySaveMock,
      discard: vi.fn().mockResolvedValue(true),
      reset: resetMock,
    });

    renderWithProviders(<DevicePreviewPanel metrics={defaultMetrics} />);

    expect(screen.getByText("写入项目文件失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    expect(retrySaveMock).toHaveBeenCalledTimes(1);
  });
});
