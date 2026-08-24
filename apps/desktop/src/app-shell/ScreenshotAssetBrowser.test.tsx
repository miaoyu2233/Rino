import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/Tooltip";
import { createEmptyProject } from "../graph/project-factory";
import * as projectActions from "../graph/project/project-actions";
import { useDocumentStore } from "../graph/store/document-store";
import { applicationI18n } from "../localization/i18n";
import { ScreenshotAssetBrowser } from "./ScreenshotAssetBrowser";

const revokeObjectUrl = vi.fn();

vi.mock("../graph/project/project-actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../graph/project/project-actions")>();
  return {
    ...actual,
    readProjectImageAsset: vi.fn(),
  };
});

function addAsset(
  assetId: string,
  displayName: string,
  createdAt: string,
  contentHash: string,
) {
  useDocumentStore.getState().runCommand("graph.history.addAsset", {
    kind: "addAsset",
    asset: {
      assetId,
      displayName,
      contentHash,
      mediaType: "image/png",
      byteLength: 4,
      coordinateSpace: {
        spaceId: `${assetId}-space`,
        width: 720,
        height: 1280,
      },
      sourceKind: "deviceCapture",
      createdAt,
    },
  });
}

describe("ScreenshotAssetBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void applicationI18n.changeLanguage("zh-CN");
    useDocumentStore.getState().openDocument(
      createEmptyProject({
        name: "截图项目",
        entryGraphName: "Main",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
    );
    addAsset(
      "asset-older",
      "A按钮",
      "2026-08-01T08:00:00.000Z",
      "a".repeat(64),
    );
    addAsset(
      "asset-newer",
      "B按钮",
      "2026-08-01T09:00:00.000Z",
      "b".repeat(64),
    );
    vi.mocked(projectActions.readProjectImageAsset).mockResolvedValue(
      new Uint8Array([137, 80, 78, 71]),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:http://localhost/screenshot"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
  });

  it("defaults to newest-first order and supports name sorting", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TooltipProvider>
        <ScreenshotAssetBrowser />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开截图素材库" }));

    const visibleNames = () =>
      Array.from(
        container.querySelectorAll(".screenshot-browser__asset-copy strong"),
      ).map((element) => element.textContent);
    expect(visibleNames()).toEqual(["B按钮", "A按钮"]);

    await user.click(screen.getByRole("combobox", { name: "截图排序方式" }));
    await user.click(screen.getByRole("option", { name: "按名称" }));

    expect(visibleNames()).toEqual(["A按钮", "B按钮"]);
  });

  it("loads image previews lazily and switches to compact list preview", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TooltipProvider>
        <ScreenshotAssetBrowser />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开截图素材库" }));
    expect(screen.getByRole("button", { name: "图片预览" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => {
      expect(projectActions.readProjectImageAsset).toHaveBeenCalledTimes(2);
    });

    await user.click(screen.getByRole("button", { name: "列表预览" }));

    expect(screen.getByRole("button", { name: "列表预览" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      container.querySelector(".screenshot-browser__list--list"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(revokeObjectUrl).toHaveBeenCalled();
    });
  });
});
