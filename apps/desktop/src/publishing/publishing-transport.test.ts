import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, isTauri } = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));

import {
  exportPackage,
  isPublishingAvailable,
  loginGithub,
  logoutGithub,
  PublishingCommandError,
  publishPackage,
  readGithubStatus,
  type PackageOptions,
} from "./publishing-transport";

const options: PackageOptions = {
  packageId: "io.rino.project.example",
  version: "1.0.0",
  summary: "Example",
  publisherId: "example.publisher",
  publisherDisplayName: "Example Publisher",
  licenseIdentifier: "LicenseRef-Proprietary",
  githubOwner: "example-owner",
  githubRepository: "example-repository",
  releasedAt: "2026-08-12T12:00:00.000Z",
};

describe("publishing transport", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("uses only typed publishing commands and never accepts a local path", async () => {
    invoke.mockResolvedValueOnce({
      available: true,
      authenticated: true,
    });
    invoke.mockResolvedValueOnce({
      available: true,
      authenticated: true,
    });
    invoke.mockResolvedValueOnce({
      available: true,
      authenticated: false,
    });
    invoke.mockResolvedValueOnce(null);
    invoke.mockResolvedValueOnce({
      releaseUrl: "https://github.com/example/release",
    });

    await readGithubStatus();
    await loginGithub();
    await logoutGithub();
    await exportPackage(
      { title: "Export", fileTypeLabel: "Rino package" },
      options,
    );
    await publishPackage(options);

    expect(invoke.mock.calls).toEqual([
      ["publishing_status"],
      ["publishing_login"],
      ["publishing_logout"],
      [
        "publishing_export",
        {
          captions: { title: "Export", fileTypeLabel: "Rino package" },
          options,
        },
      ],
      ["publishing_publish", { options }],
    ]);
    expect(isPublishingAvailable()).toBe(true);
  });

  it("preserves allowlisted native error codes and rejects unknown ones", async () => {
    invoke.mockRejectedValueOnce({ code: "CREDENTIAL_UNAVAILABLE" });
    await expect(readGithubStatus()).rejects.toMatchObject({
      code: "CREDENTIAL_UNAVAILABLE",
    });

    invoke.mockRejectedValueOnce({ code: "PACKAGE_VERSION_EXISTS" });
    await expect(readGithubStatus()).rejects.toMatchObject({
      code: "PACKAGE_VERSION_EXISTS",
    });

    invoke.mockRejectedValueOnce({ code: "GITHUB_AUTHENTICATION_FAILED" });
    await expect(loginGithub()).rejects.toMatchObject({
      code: "GITHUB_AUTHENTICATION_FAILED",
    });

    invoke.mockRejectedValueOnce({ code: "GITHUB_LOGOUT_FAILED" });
    await expect(logoutGithub()).rejects.toMatchObject({
      code: "GITHUB_LOGOUT_FAILED",
    });

    invoke.mockRejectedValueOnce({ code: "ARBITRARY_ERROR" });
    await expect(readGithubStatus()).rejects.toEqual(
      new PublishingCommandError("DESKTOP_COMMAND_FAILED"),
    );
  });
});
