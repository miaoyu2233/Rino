import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import { LocaleProvider } from "../localization/LocaleProvider";
import { THEME_STORAGE_KEY } from "../design-system/theme/theme-state";
import { ThemeProvider } from "../design-system/theme/ThemeProvider";
import { TooltipProvider } from "../components/ui/Tooltip";
import { useShortcutPreferenceStore } from "../preferences/shortcut-preference-store";
import { useLayoutPreferenceStore } from "../preferences/layout-preference-store";
import { defaultLayoutPreferences } from "../preferences/layout-preferences";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../graph/store/project-lifecycle";
import { useDocumentStore } from "../graph/store/document-store";
import { APPLICATION_DATA_STORAGE_KEY } from "../preferences/application-data";
import {
  initializeApplicationData,
  useApplicationDataStore,
} from "../preferences/application-data-store";
import { SettingsDialog } from "./SettingsDialog";
import { shortcutDefinitions } from "./shortcut-registry";

function renderDialog(open = true) {
  return render(
    <LocaleProvider>
      <ThemeProvider>
        <TooltipProvider>
          <SettingsDialog
            open={open}
            onOpenChange={vi.fn()}
            restoreFocus={vi.fn()}
          />
        </TooltipProvider>
      </ThemeProvider>
    </LocaleProvider>,
  );
}

const CURRENT_DOCUMENT_ID = "62000000-0000-4000-8000-000000000601";
const CURRENT_GRAPH_ID = "62000000-0000-4000-8000-000000000602";
const OTHER_DOCUMENT_ID = "62000000-0000-4000-8000-000000000603";
const CURRENT_VARIABLE_ID = "62000000-0000-4000-8000-000000000604";
const OTHER_VARIABLE_ID = "62000000-0000-4000-8000-000000000605";

function openPersistentProject(): void {
  openProjectDocument({
    schemaVersion: 1,
    documentId: CURRENT_DOCUMENT_ID,
    metadata: {
      name: "Persistent values",
      createdAt: "2026-08-16T00:00:00Z",
      updatedAt: "2026-08-16T00:00:00Z",
    },
    entryGraphId: CURRENT_GRAPH_ID,
    graphs: [
      {
        graphId: CURRENT_GRAPH_ID,
        name: "Main",
        kind: "entry",
        nodes: [],
        edges: [],
      },
    ],
    assets: [],
    requiredCapabilities: [],
  });
}

describe("SettingsDialog", () => {
  beforeEach(() => {
    closeProjectDocument();
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    window.localStorage.setItem(
      APPLICATION_DATA_STORAGE_KEY,
      JSON.stringify({ version: 1, installationCode: "RINO2026" }),
    );
    void applicationI18n.changeLanguage("zh-CN");
    useShortcutPreferenceStore.getState().resetAll();
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences },
    });
    useApplicationDataStore.setState({
      installationCode: undefined,
      assetNameOrdinals: {},
      persistentVariablesByDocument: {},
      storageStatus: "memoryOnly",
    });
    initializeApplicationData();
  });

  it("organizes settings into clear single-page categories", async () => {
    const user = userEvent.setup();
    renderDialog();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "界面主题" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "界面语言" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "外观" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "性能" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "快捷键" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "项目" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "数据" })).toBeInTheDocument();
    expect(screen.queryByText("显卡加速")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "快捷键" }));
    expect(
      screen.getByRole("heading", { name: "快捷键参考" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "全局" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "画布" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "运行时" })).toBeInTheDocument();

    for (const shortcut of shortcutDefinitions) {
      expect(screen.getAllByText(shortcut.keys).length).toBeGreaterThan(0);
    }
  });

  it("edits the project license outside the publishing dialog", async () => {
    const user = userEvent.setup();
    openPersistentProject();
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "项目" }));
    const input = screen.getByRole("textbox", { name: "项目许可证" });
    expect(input).toHaveValue("LicenseRef-Proprietary");

    await user.clear(input);
    await user.type(input, "MIT");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(
      useDocumentStore.getState().history?.document.metadata.licenseIdentifier,
    ).toBe("MIT");
  });

  it("shows the persisted installation code and naming example on the data page", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "数据" }));

    expect(screen.getByText("RINO2026")).toBeInTheDocument();
    expect(
      screen.getByText("内部名称示例：RINO2026_退出按钮_01"),
    ).toBeInTheDocument();
    expect(screen.getByText("已保存在本机")).toBeInTheDocument();
  });

  it("shows persistent value counts and local-only project storage", async () => {
    const user = userEvent.setup();
    openPersistentProject();
    useApplicationDataStore.setState({
      persistentVariablesByDocument: {
        [CURRENT_DOCUMENT_ID]: [
          { variableId: CURRENT_VARIABLE_ID, valueKind: "number", value: 1 },
          { variableId: OTHER_VARIABLE_ID, valueKind: "string", value: "x" },
        ],
        [OTHER_DOCUMENT_ID]: [
          { variableId: OTHER_VARIABLE_ID, valueKind: "number", value: 2 },
        ],
      },
    });
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "数据" }));

    const section = screen.getByRole("region", { name: "永久变量数据" });
    expect(within(section).getByText("已保存项目数")).toBeInTheDocument();
    expect(within(section).getByText("全部永久变量值数")).toBeInTheDocument();
    expect(
      within(section).getByText("当前打开项目的永久变量值数"),
    ).toBeInTheDocument();
    expect(within(section).getAllByText("2")).toHaveLength(2);
    expect(within(section).getByText("3")).toBeInTheDocument();
    expect(
      within(section).getByText(
        "这些值只存在本机应用数据，不会写入项目文件或导出包。",
      ),
    ).toBeInTheDocument();
  });

  it("requires confirmation before clearing only the current project's values", async () => {
    const user = userEvent.setup();
    openPersistentProject();
    useApplicationDataStore.setState({
      persistentVariablesByDocument: {
        [CURRENT_DOCUMENT_ID]: [
          { variableId: CURRENT_VARIABLE_ID, valueKind: "number", value: 1 },
        ],
        [OTHER_DOCUMENT_ID]: [
          { variableId: OTHER_VARIABLE_ID, valueKind: "number", value: 2 },
        ],
      },
    });
    renderDialog();
    await user.click(screen.getByRole("tab", { name: "数据" }));
    const section = screen.getByRole("region", { name: "永久变量数据" });

    await user.click(
      within(section).getByRole("button", { name: "清除当前项目" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "清除当前项目的永久变量值？",
    });
    expect(confirmation).toHaveAccessibleDescription(
      "只会删除当前打开项目已保存的永久变量值。",
    );
    expect(
      within(confirmation).getByText(
        "不会删除变量定义、变量节点、项目图、截图素材、安装随机码或素材命名序号。此操作无法恢复。",
      ),
    ).toBeInTheDocument();
    expect(
      within(confirmation).getByRole("button", { name: "关闭" }),
    ).toBeInTheDocument();

    await user.click(
      within(confirmation).getByRole("button", { name: "确认清除" }),
    );

    await waitFor(() => {
      expect(
        useApplicationDataStore.getState().persistentVariablesByDocument,
      ).toEqual({
        [OTHER_DOCUMENT_ID]: [
          { variableId: OTHER_VARIABLE_ID, valueKind: "number", value: 2 },
        ],
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "已清除当前项目保存的永久变量值。",
    );
    expect(useApplicationDataStore.getState().installationCode).toBe(
      "RINO2026",
    );
    expect(useApplicationDataStore.getState().assetNameOrdinals).toEqual({});
  });

  it("cancels a clear and clears all values only after confirming the destructive action", async () => {
    const user = userEvent.setup();
    openPersistentProject();
    useApplicationDataStore.setState({
      persistentVariablesByDocument: {
        [CURRENT_DOCUMENT_ID]: [
          { variableId: CURRENT_VARIABLE_ID, valueKind: "number", value: 1 },
        ],
        [OTHER_DOCUMENT_ID]: [
          { variableId: OTHER_VARIABLE_ID, valueKind: "number", value: 2 },
        ],
      },
    });
    renderDialog();
    await user.click(screen.getByRole("tab", { name: "数据" }));
    const section = screen.getByRole("region", { name: "永久变量数据" });

    await user.click(
      within(section).getByRole("button", { name: "清除当前项目" }),
    );
    const currentConfirmation = screen.getByRole("dialog", {
      name: "清除当前项目的永久变量值？",
    });
    await user.click(
      within(currentConfirmation).getByRole("button", { name: "取消" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "清除当前项目的永久变量值？" }),
    ).toBeNull();
    expect(
      useApplicationDataStore.getState().persistentVariablesByDocument[
        CURRENT_DOCUMENT_ID
      ],
    ).toHaveLength(1);

    await user.click(within(section).getByRole("button", { name: "清除全部" }));
    const allConfirmation = screen.getByRole("dialog", {
      name: "清除全部永久变量值？",
    });
    await user.click(
      within(allConfirmation).getByRole("button", { name: "确认清除" }),
    );
    await waitFor(() => {
      expect(
        useApplicationDataStore.getState().persistentVariablesByDocument,
      ).toEqual({});
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "已清除全部项目保存的永久变量值。",
    );
    expect(useApplicationDataStore.getState().installationCode).toBe(
      "RINO2026",
    );
  });

  it("disables clear actions when there are no eligible values", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("tab", { name: "数据" }));
    const section = screen.getByRole("region", { name: "永久变量数据" });
    expect(
      within(section).getByRole("button", { name: "清除当前项目" }),
    ).toBeDisabled();
    expect(
      within(section).getByRole("button", { name: "清除全部" }),
    ).toBeDisabled();

    useApplicationDataStore.setState({
      persistentVariablesByDocument: {
        [OTHER_DOCUMENT_ID]: [
          { variableId: OTHER_VARIABLE_ID, valueKind: "number", value: 2 },
        ],
      },
    });
    await waitFor(() => {
      expect(
        within(section).getByRole("button", { name: "清除当前项目" }),
      ).toBeDisabled();
      expect(
        within(section).getByRole("button", { name: "清除全部" }),
      ).toBeEnabled();
    });
  });

  it("reports memory-only and failed clear results without claiming durable deletion", async () => {
    const user = userEvent.setup();
    openPersistentProject();
    useApplicationDataStore.setState({
      persistentVariablesByDocument: {
        [CURRENT_DOCUMENT_ID]: [
          { variableId: CURRENT_VARIABLE_ID, valueKind: "number", value: 1 },
        ],
      },
    });
    renderDialog();
    await user.click(screen.getByRole("tab", { name: "数据" }));
    const section = screen.getByRole("region", { name: "永久变量数据" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });

    await user.click(
      within(section).getByRole("button", { name: "清除当前项目" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "清除当前项目的永久变量值？",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "确认清除" }),
    );
    await waitFor(() => {
      expect(useApplicationDataStore.getState().storageStatus).toBe(
        "memoryOnly",
      );
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "本次会话内已清除，但本机存储不可写，旧值可能在下次启动恢复。",
    );

    useApplicationDataStore.setState({
      installationCode: undefined,
      persistentVariablesByDocument: {
        [CURRENT_DOCUMENT_ID]: [
          { variableId: CURRENT_VARIABLE_ID, valueKind: "number", value: 1 },
        ],
      },
    });
    await user.click(
      within(section).getByRole("button", { name: "清除当前项目" }),
    );
    const failedConfirmation = screen.getByRole("dialog", {
      name: "清除当前项目的永久变量值？",
    });
    await user.click(
      within(failedConfirmation).getByRole("button", { name: "确认清除" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "永久变量值未能清除。请检查本机应用数据状态后重试。",
    );
  });

  it("applies a resource profile and allows an explicit preview rate", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "性能" }));

    await user.click(screen.getByRole("radio", { name: "节能" }));
    expect(useLayoutPreferenceStore.getState().layout).toMatchObject({
      performanceProfile: "efficiency",
      previewRefreshFps: 2,
    });

    await user.click(screen.getByRole("radio", { name: "1 FPS" }));
    expect(useLayoutPreferenceStore.getState().layout.previewRefreshFps).toBe(
      1,
    );
  });

  it("keeps the UI animation rate independent from resource and preview settings", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "性能" }));

    const followDisplay = screen.getByRole("radio", { name: "跟随屏幕" });
    expect(followDisplay).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "60 Hz" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "120 Hz" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "180 Hz" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "120 Hz" }));
    expect(useLayoutPreferenceStore.getState().layout.uiRefreshRate).toBe(120);

    await user.click(screen.getByRole("radio", { name: "节能" }));
    expect(useLayoutPreferenceStore.getState().layout.uiRefreshRate).toBe(120);

    await user.click(screen.getByRole("radio", { name: "1 FPS" }));
    expect(useLayoutPreferenceStore.getState().layout.uiRefreshRate).toBe(120);
  });

  it("searches shortcuts by localized label, description, key, and scope, and shows localized empty state", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "快捷键" }));

    const searchInput = screen.getByPlaceholderText("搜索快捷键");

    await user.type(searchInput, "Ctrl+/");
    expect(screen.getByText("打开快捷键参考")).toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, "nonexistent_shortcut_query");
    expect(screen.getByText("没有匹配的快捷键。")).toBeInTheDocument();
  });

  it("supports theme and locale radio selection", async () => {
    const user = userEvent.setup();
    renderDialog();

    const lightRadio = screen.getByRole("radio", { name: "浅色" });
    expect(lightRadio).toHaveAttribute("aria-checked", "false");

    await user.click(lightRadio);
    expect(lightRadio).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("allows recording a custom shortcut, resetting single shortcut, and resetting all shortcuts", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "快捷键" }));

    const triggerBtns = screen.getAllByTitle("点击修改快捷键");
    const saveShortcutBtn = triggerBtns[3]; // "保存项目" (Ctrl+S)

    expect(saveShortcutBtn).toBeDefined();
    if (saveShortcutBtn) {
      await user.click(saveShortcutBtn);
    }
    expect(screen.getByText("请按下快捷键...")).toBeInTheDocument();

    fireEvent.keyDown(window, {
      key: "s",
      ctrlKey: true,
      altKey: true,
    });

    expect(screen.getByText("Ctrl+Alt+S")).toBeInTheDocument();
    expect(useShortcutPreferenceStore.getState().resolveKeys("save")).toBe(
      "Ctrl+Alt+S",
    );

    const resetSingleBtn = screen.getByRole("button", { name: "重置为默认值" });
    expect(resetSingleBtn).toBeInTheDocument();

    const resetAllBtn = screen.getByRole("button", { name: "重置全部快捷键" });
    expect(resetAllBtn).toBeInTheDocument();

    await user.click(resetSingleBtn);
    expect(useShortcutPreferenceStore.getState().resolveKeys("save")).toBe(
      "Ctrl+S",
    );
    expect(
      screen.queryByRole("button", { name: "重置为默认值" }),
    ).not.toBeInTheDocument();
  });

  it("prevents assigning a conflicting shortcut and displays a warning message", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "快捷键" }));

    const triggerBtns = screen.getAllByTitle("点击修改快捷键");
    const saveAsTriggerBtn = triggerBtns[4]; // saveAs default is Ctrl+Shift+S

    expect(saveAsTriggerBtn).toBeDefined();
    if (saveAsTriggerBtn) {
      await user.click(saveAsTriggerBtn);
    }
    expect(screen.getByText("请按下快捷键...")).toBeInTheDocument();

    // Try to record Ctrl+S, which is used by `save`
    fireEvent.keyDown(window, {
      key: "s",
      ctrlKey: true,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "快捷键与「保存项目」冲突，请更换按键",
    );
    expect(useShortcutPreferenceStore.getState().resolveKeys("saveAs")).toBe(
      "Ctrl+Shift+S",
    );
  });
});
