import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app/App";
import { ProblemsPanel } from "../app-shell/ProblemsPanel";
import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import { defaultLayoutPreferences } from "../preferences/layout-preferences";
import { useLayoutPreferenceStore } from "../preferences/layout-preference-store";
import { TooltipProvider } from "../components/ui/Tooltip";
import { ApplicationErrorBoundary } from "./ApplicationErrorBoundary";
import { ApplicationErrorScreen } from "./ApplicationErrorScreen";
import {
  MAXIMUM_RETAINED_PROBLEMS,
  MAXIMUM_VISIBLE_NOTIFICATIONS,
} from "./diagnostic-model";
import { useDiagnosticStore } from "./diagnostic-store";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";
import { NotificationRegion } from "./NotificationRegion";
import { ProblemsList } from "./ProblemsList";

function FailingComponent(): never {
  throw new Error("component failure with a private detail");
}

/** Icon-only controls require a tooltip provider, which the application mounts at its
 * root; isolated component tests supply the same boundary. */
function renderWithTooltips(element: ReactElement): void {
  render(<TooltipProvider>{element}</TooltipProvider>);
}

function resetStores(): void {
  window.localStorage.clear();
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
  void applicationI18n.changeLanguage("zh-CN");
  useDiagnosticStore.setState({ problems: [], notifications: [] });
  useLayoutPreferenceStore.setState({
    layout: { ...defaultLayoutPreferences },
  });
}

describe("diagnostic store", () => {
  beforeEach(resetStores);

  it("keeps the newest problems and bounds the retained list", () => {
    const { reportProblem } = useDiagnosticStore.getState();

    for (let index = 0; index < MAXIMUM_RETAINED_PROBLEMS + 10; index += 1) {
      reportProblem({
        severity: "warning",
        source: "runtime",
        titleKey: "diagnostics.featureError.title",
        descriptionKey: "diagnostics.featureError.description",
        parameters: { feature: String(index) },
      });
    }

    const { problems } = useDiagnosticStore.getState();
    expect(problems).toHaveLength(MAXIMUM_RETAINED_PROBLEMS);
    expect(problems[0]?.parameters?.["feature"]).toBe(
      String(MAXIMUM_RETAINED_PROBLEMS + 9),
    );
  });

  it("bounds visible notifications to the newest few", () => {
    const { notify } = useDiagnosticStore.getState();

    for (let index = 0; index < MAXIMUM_VISIBLE_NOTIFICATIONS + 3; index += 1) {
      notify({ severity: "info", titleKey: "diagnostics.problems.emptyTitle" });
    }

    expect(useDiagnosticStore.getState().notifications).toHaveLength(
      MAXIMUM_VISIBLE_NOTIFICATIONS,
    );
  });

  it("clears problems by source without touching other sources", () => {
    const { reportProblem, clearProblems } = useDiagnosticStore.getState();
    reportProblem({
      severity: "error",
      source: "runtime",
      titleKey: "diagnostics.applicationError.title",
      descriptionKey: "diagnostics.applicationError.description",
    });
    reportProblem({
      severity: "error",
      source: "feature",
      titleKey: "diagnostics.featureError.title",
      descriptionKey: "diagnostics.featureError.description",
      parameters: { feature: "canvas" },
    });

    clearProblems("runtime");

    const { problems } = useDiagnosticStore.getState();
    expect(problems).toHaveLength(1);
    expect(problems[0]?.source).toBe("feature");
  });
});

describe("FeatureErrorBoundary", () => {
  beforeEach(resetStores);

  it("does not insert a layout element around successful content", () => {
    const { container } = render(
      <FeatureErrorBoundary feature="canvas">
        <main data-testid="canvas-content" />
      </FeatureErrorBoundary>,
    );

    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(
      screen.getByTestId("canvas-content"),
    );
  });

  it("contains the failure, reports a problem, and offers recovery", () => {
    // React logs the caught error; the assertion below is about what the user sees.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // Intentionally silent for this test.
    });

    render(
      <div>
        <FeatureErrorBoundary feature="canvas">
          <FailingComponent />
        </FeatureErrorBoundary>
        <p>其余界面</p>
      </div>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("其余界面")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();

    const { problems } = useDiagnosticStore.getState();
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe("FEATURE_RENDER_FAILED_CANVAS");
    expect(problems[0]?.source).toBe("feature");

    consoleError.mockRestore();
  });

  it("never records the caught error message in the diagnostic", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // Intentionally silent for this test.
    });

    render(
      <FeatureErrorBoundary feature="palette">
        <FailingComponent />
      </FeatureErrorBoundary>,
    );

    const recorded = JSON.stringify(useDiagnosticStore.getState().problems);
    expect(recorded).not.toContain("private detail");

    consoleError.mockRestore();
  });
});

describe("ApplicationErrorBoundary", () => {
  beforeEach(resetStores);

  it("renders a localized recovery screen and records the failure", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // Intentionally silent for this test.
    });

    render(
      <ApplicationErrorBoundary>
        <FailingComponent />
      </ApplicationErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Rino 遇到了问题" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("component failure with a private detail"),
    ).toBeInTheDocument();
    expect(screen.getByText("详细信息")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新加载窗口" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制详细信息" }),
    ).toBeInTheDocument();
    expect(useDiagnosticStore.getState().problems[0]?.code).toBe(
      "APPLICATION_RENDER_FAILED",
    );
    expect(
      JSON.stringify(useDiagnosticStore.getState().problems),
    ).not.toContain("private detail");

    consoleError.mockRestore();
  });
});

describe("ApplicationErrorScreen", () => {
  it("copies technical details and announces the result", async () => {
    const user = userEvent.setup();
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      render(
        <ApplicationErrorScreen
          failure={{
            name: "TypeError",
            message: "private detail stays in the page only",
            stack: "TypeError: private detail stays in the page only",
          }}
        />,
      );

      await user.click(screen.getByRole("button", { name: "复制详细信息" }));

      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("private detail stays in the page only"),
      );
      expect(await screen.findByText("详细信息已复制。")).toBeInTheDocument();
    } finally {
      if (originalClipboard === undefined) {
        Reflect.deleteProperty(navigator, "clipboard");
      } else {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      }
    }
  });

  it("announces when the clipboard is unavailable", async () => {
    const user = userEvent.setup();
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    try {
      render(
        <ApplicationErrorScreen
          failure={{ name: "Error", message: "render failed" }}
        />,
      );

      await user.click(screen.getByRole("button", { name: "复制详细信息" }));

      expect(
        await screen.findByText("无法访问剪贴板，请展开后手动复制。"),
      ).toBeInTheDocument();
    } finally {
      if (originalClipboard === undefined) {
        Reflect.deleteProperty(navigator, "clipboard");
      } else {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      }
    }
  });
});

describe("ProblemsList", () => {
  beforeEach(resetStores);

  it("renders nothing until a problem is reported, leaving the panel to say so", () => {
    const { container } = render(
      <TooltipProvider>
        <ProblemsList />
      </TooltipProvider>,
    );

    expect(container).toBeEmptyDOMElement();

    renderWithTooltips(<ProblemsPanel />);
    expect(screen.getByText("暂无问题")).toBeInTheDocument();
  });

  it("renders a reported problem and dismisses it on request", async () => {
    const user = userEvent.setup();
    useDiagnosticStore.getState().reportProblem({
      severity: "error",
      source: "runtime",
      titleKey: "diagnostics.applicationError.title",
      descriptionKey: "diagnostics.applicationError.description",
      code: "RUNTIME_EXAMPLE",
    });

    renderWithTooltips(<ProblemsList />);
    expect(screen.getByText("RUNTIME_EXAMPLE")).toBeInTheDocument();
    expect(screen.getByText("错误")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "忽略" }));

    expect(useDiagnosticStore.getState().problems).toHaveLength(0);
  });
});

describe("NotificationRegion", () => {
  beforeEach(resetStores);

  it("announces transient outcomes politely and dismisses them", async () => {
    const user = userEvent.setup();
    useDiagnosticStore.getState().notify({
      severity: "info",
      titleKey: "diagnostics.problems.emptyTitle",
    });

    renderWithTooltips(<NotificationRegion />);
    const region = screen.getByRole("list", { name: "临时通知" });
    expect(region).toHaveAttribute("aria-live", "polite");

    await user.click(screen.getByRole("button", { name: "忽略" }));

    expect(useDiagnosticStore.getState().notifications).toHaveLength(0);
  });
});

describe("appearance settings", () => {
  beforeEach(resetStores);

  it("exposes explicit theme and language overrides", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));

    const themeGroup = screen.getByRole("radiogroup", { name: "界面主题" });
    const darkOption = within(themeGroup).getByRole("radio", { name: "深色" });
    await user.click(darkOption);
    expect(document.documentElement.dataset["theme"]).toBe("dark");

    const localeGroup = screen.getByRole("radiogroup", { name: "界面语言" });
    expect(
      within(localeGroup).getByRole("radio", { name: "简体中文" }),
    ).toBeInTheDocument();
  });
});
