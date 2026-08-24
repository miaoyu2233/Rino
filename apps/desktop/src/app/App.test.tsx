import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset["theme"];
    delete document.documentElement.dataset["themePreference"];
    document.documentElement.lang = "zh-CN";
    document.documentElement.dir = "";
  });

  it("provides the desktop application root", () => {
    render(<App />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(document.documentElement.dataset["themePreference"]).toBe("system");
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.title).toBe("Rino");
  });
});
