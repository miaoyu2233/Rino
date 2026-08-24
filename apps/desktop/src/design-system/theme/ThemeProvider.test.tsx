import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./ThemeProvider";
import { THEME_STORAGE_KEY } from "./theme-state";
import { useTheme } from "./useTheme";

interface ControllableMediaQuery {
  mediaQuery: MediaQueryList;
  setMatches: (matches: boolean) => void;
}

function createControllableMediaQuery(
  initialMatches: boolean,
): ControllableMediaQuery {
  let matches = initialMatches;
  let changeListener: ((event: MediaQueryListEvent) => void) | undefined;

  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        changeListener = listener;
      },
    ),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList;

  return {
    mediaQuery,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      changeListener?.({ matches: nextMatches } as MediaQueryListEvent);
    },
  };
}

function ThemePreferenceHarness() {
  const { preference, resolvedTheme, setPreference } = useTheme();

  return (
    <div>
      <output aria-label="theme state">{`${preference}:${resolvedTheme}`}</output>
      <button
        type="button"
        onClick={() => {
          setPreference("dark");
        }}
      >
        set dark
      </button>
      <button
        type="button"
        onClick={() => {
          setPreference("system");
        }}
      >
        use system
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    delete document.documentElement.dataset["theme"];
    delete document.documentElement.dataset["themePreference"];
  });

  it("updates the document and local preference from an explicit override", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(
        () =>
          ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      ),
    );

    render(
      <ThemeProvider>
        <ThemePreferenceHarness />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "set dark" }));

    expect(screen.getByLabelText("theme state")).toHaveTextContent("dark:dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("returns to the current system theme when the override is cleared", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(
        () =>
          ({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      ),
    );
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");

    render(
      <ThemeProvider>
        <ThemePreferenceHarness />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "use system" }));

    expect(screen.getByLabelText("theme state")).toHaveTextContent(
      "system:dark",
    );
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("tracks operating-system changes while the system preference is active", () => {
    const controllableQuery = createControllableMediaQuery(false);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => controllableQuery.mediaQuery),
    );

    render(
      <ThemeProvider>
        <ThemePreferenceHarness />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("theme state")).toHaveTextContent(
      "system:light",
    );

    act(() => {
      controllableQuery.setMatches(true);
    });

    expect(screen.getByLabelText("theme state")).toHaveTextContent(
      "system:dark",
    );
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });
});
