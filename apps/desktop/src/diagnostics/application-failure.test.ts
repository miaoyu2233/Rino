import { describe, expect, it, vi } from "vitest";

import {
  createApplicationFailureGate,
  installGlobalApplicationFailureHandlers,
  normalizeApplicationFailure,
} from "./application-failure";

describe("application failure details", () => {
  it("keeps bounded error and React component details in memory", () => {
    const error = new TypeError("render failed");
    error.stack = "TypeError: render failed\n at private-local-path";

    expect(normalizeApplicationFailure(error, "at BrokenPanel")).toEqual({
      name: "TypeError",
      message: "render failed",
      stack: "TypeError: render failed\n at private-local-path",
      componentStack: "at BrokenPanel",
    });
  });

  it("does not serialize arbitrary rejected objects", () => {
    const privateValue = { token: "must-not-be-rendered" };

    expect(normalizeApplicationFailure(privateValue)).toEqual({
      name: "Error",
    });
  });

  it("forwards only the first fatal failure to avoid duplicate fallback renders", () => {
    const showFailure = vi.fn();
    const reportFailure = createApplicationFailureGate(showFailure);

    reportFailure(normalizeApplicationFailure(new Error("first failure")));
    reportFailure(normalizeApplicationFailure("duplicate rejection"));

    expect(showFailure).toHaveBeenCalledTimes(1);
    expect(showFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: "first failure" }),
    );
  });

  it("ignores browser ResizeObserver notifications without an Error", () => {
    const showFailure = vi.fn();
    const dispose = installGlobalApplicationFailureHandlers(showFailure);
    const events = [
      new ErrorEvent("error", {
        cancelable: true,
        message:
          "ResizeObserver loop completed with undelivered notifications.",
      }),
      new ErrorEvent("error", {
        cancelable: true,
        message: "ResizeObserver loop limit exceeded",
      }),
    ];

    for (const event of events) {
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }

    expect(showFailure).not.toHaveBeenCalled();
    dispose();
  });

  it("reports a real Error with a ResizeObserver message", () => {
    const showFailure = vi.fn();
    const dispose = installGlobalApplicationFailureHandlers(showFailure);
    const error = new Error("ResizeObserver loop limit exceeded");
    const event = new ErrorEvent("error", {
      cancelable: true,
      error,
      message: error.message,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(showFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: error.message }),
    );
    dispose();
  });

  it("captures global errors and unhandled rejections until disposed", () => {
    const showFailure = vi.fn();
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const dispose = installGlobalApplicationFailureHandlers(showFailure);

    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("global failure") }),
    );
    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", {
      configurable: true,
      value: "promise failure",
    });
    window.dispatchEvent(rejection);

    expect(showFailure).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: "global failure" }),
    );
    expect(showFailure).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: "promise failure" }),
    );

    dispose();
    expect(removeEventListener).toHaveBeenCalledWith(
      "error",
      expect.any(Function),
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "unhandledrejection",
      expect.any(Function),
    );
    expect(showFailure).toHaveBeenCalledTimes(2);
  });
});
