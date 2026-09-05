import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import { createEmptyProject } from "../graph/project-factory";
import { useDocumentStore } from "../graph/store/document-store";

const mocks = vi.hoisted(() => ({
  exportPackage: vi.fn(),
  loginGithub: vi.fn(),
  logoutGithub: vi.fn(),
  publishPackage: vi.fn(),
  readGithubStatus: vi.fn(),
  saveProject: vi.fn(),
}));

vi.mock("../graph/project/project-actions", () => ({
  saveProject: mocks.saveProject,
}));

vi.mock("./publishing-transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./publishing-transport")>()),
  exportPackage: mocks.exportPackage,
  isPublishingAvailable: () => true,
  loginGithub: mocks.loginGithub,
  logoutGithub: mocks.logoutGithub,
  publishPackage: mocks.publishPackage,
  readGithubStatus: mocks.readGithubStatus,
}));

import { PackagePublishingDialog } from "./PackagePublishingDialog";

describe("PackagePublishingDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    useDocumentStore.getState().openDocument(
      createEmptyProject({
        name: "示例项目",
        entryGraphName: "主图",
        createdAt: "2026-08-12T00:00:00.000Z",
      }),
    );
    mocks.saveProject.mockReset();
    mocks.exportPackage.mockReset();
    mocks.loginGithub.mockReset();
    mocks.logoutGithub.mockReset();
    mocks.publishPackage.mockReset();
    mocks.readGithubStatus.mockReset();
    mocks.readGithubStatus.mockResolvedValue({
      available: true,
      authenticated: true,
      publisher: {
        publisherId: "example-owner",
        displayName: "Example Publisher",
      },
    });
    mocks.loginGithub.mockResolvedValue({
      available: true,
      authenticated: true,
      publisher: {
        publisherId: "example-owner",
        displayName: "Example Publisher",
      },
    });
    mocks.logoutGithub.mockResolvedValue({
      available: true,
      authenticated: false,
      publisher: null,
    });
    mocks.saveProject.mockResolvedValue({ status: "completed" });
    mocks.exportPackage.mockResolvedValue({
      assetName: "RinoProject",
      byteLength: 100,
      sha256: "a".repeat(64),
      keyId: "example-key",
      publicKeyBase64: "public-key",
      publisherDisplayName: "Example Publisher",
    });
  });

  it("discloses public upload scope and saves before local export", async () => {
    const user = userEvent.setup();
    render(<PackagePublishingDialog open onOpenChange={vi.fn()} />);

    expect(
      screen.getByText(/发布会把已保存的项目图、项目元数据和项目素材公开上传/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("GitHub CLI 已认证")).toBeInTheDocument(),
    );
    expect(screen.getByText("example-owner")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "导出到本地" }));

    expect(mocks.saveProject).toHaveBeenCalledOnce();
    expect(mocks.exportPackage).toHaveBeenCalledOnce();
    expect(screen.getByText("资源目录已导出")).toBeInTheDocument();
    expect(screen.getByText("发布者公钥：public-key")).toBeInTheDocument();
  });

  it("exports an application with the selected WFP update policy", async () => {
    const user = userEvent.setup();
    mocks.exportPackage.mockResolvedValue({
      assetName: "示例项目_1.0.0_Setup.exe",
      byteLength: 200,
      sha256: "b".repeat(64),
      keyId: "example-key",
      publicKeyBase64: "public-key",
      publisherDisplayName: "Example Publisher",
    });
    render(<PackagePublishingDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /导出可运行应用/ }));
    expect(
      screen.getByRole("checkbox", {
        name: "本地导出前同步最新 Rino_WFP",
      }),
    ).toBeChecked();
    await user.click(screen.getByRole("button", { name: "导出到本地" }));

    expect(mocks.exportPackage).toHaveBeenCalledWith(
      {
        title: "导出 Rino Windows 应用",
        fileTypeLabel: "Windows 安装程序",
      },
      expect.objectContaining({
        content: "application",
        applicationName: "示例项目",
        updateWfp: true,
      }),
    );
    expect(screen.getByText("可运行应用已导出")).toBeInTheDocument();
  });
  it("runs the official CLI login flow and reflects its returned status", async () => {
    const user = userEvent.setup();
    mocks.readGithubStatus.mockResolvedValue({
      available: true,
      authenticated: false,
      publisher: null,
    });
    render(<PackagePublishingDialog open onOpenChange={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "登录 GitHub CLI" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "登录 GitHub CLI" }));

    expect(mocks.loginGithub).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByText("GitHub CLI 已认证")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "退出 GitHub CLI" }),
    ).toBeInTheDocument();
  });

  it("requires inline confirmation before removing local CLI auth", async () => {
    const user = userEvent.setup();
    render(<PackagePublishingDialog open onOpenChange={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "退出 GitHub CLI" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "退出 GitHub CLI" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "只会移除本机 GH CLI 的登录配置",
    );
    expect(mocks.logoutGithub).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认退出" }));
    expect(mocks.logoutGithub).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.getByText(
          "GitHub CLI 尚未登录。点击登录并按官方浏览器/设备流程完成授权。",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("keeps GitHub publishing disabled when the CLI is not authenticated", async () => {
    mocks.readGithubStatus.mockResolvedValue({
      available: true,
      authenticated: false,
      publisher: null,
    });
    render(<PackagePublishingDialog open onOpenChange={vi.fn()} />);

    const publish = screen.getByRole("button", { name: "一键发布到 GitHub" });
    await waitFor(() => expect(publish).toBeDisabled());
    expect(
      screen.getByText(
        "GitHub CLI 尚未登录。点击登录并按官方浏览器/设备流程完成授权。",
      ),
    ).toBeInTheDocument();
  });

  it("uses GitHub identity and keeps internal package metadata read-only", async () => {
    render(<PackagePublishingDialog open onOpenChange={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("GitHub CLI 已认证")).toBeInTheDocument(),
    );
    expect(screen.getByText("example-owner")).toBeInTheDocument();
    expect(screen.getByText("Example Publisher")).toBeInTheDocument();
    expect(screen.getByText("LicenseRef-Proprietary")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "项目唯一标识" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "许可证" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "GitHub 用户或组织" }),
    ).toHaveValue("example-owner");
  });

  it("uses plain-language labels for package settings", () => {
    render(<PackagePublishingDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByText("项目唯一标识")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "项目简介" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "仓库名称" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/项目唯一标识由项目内部 ID 自动生成/),
    ).toBeInTheDocument();
  });
});
