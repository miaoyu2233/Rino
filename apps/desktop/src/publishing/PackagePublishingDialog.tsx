import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";
import { Dialog, DialogContent } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import { saveProject } from "../graph/project/project-actions";
import { useDocumentStore } from "../graph/store/document-store";
import {
  exportPackage,
  isPublishingAvailable,
  loginGithub,
  logoutGithub,
  PublishingCommandError,
  publishPackage,
  readGithubStatus,
  type GithubStatus,
  type PackageOptions,
  type PackageOutput,
  type PublishOutput,
  type PublishingErrorCode,
} from "./publishing-transport";

export interface PackagePublishingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PublishingActivity =
  "idle" | "checking" | "loggingIn" | "loggingOut" | "exporting" | "publishing";

const INITIAL_GITHUB_STATUS: GithubStatus = {
  available: false,
  authenticated: false,
};

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

function initialOptions(
  projectName: string,
): Omit<PackageOptions, "releasedAt"> {
  const projectSlug = slug(projectName) || "rino-project";
  return {
    packageId: `io.rino.project.${projectSlug}`,
    version: "1.0.0",
    summary: `${projectName} automation project`,
    publisherId: "rino.publisher",
    publisherDisplayName: "Rino Publisher",
    licenseIdentifier: "LicenseRef-Proprietary",
    githubOwner: "",
    githubRepository: projectSlug,
  };
}

function errorCode(cause: unknown): PublishingErrorCode {
  return cause instanceof PublishingCommandError
    ? cause.code
    : "DESKTOP_COMMAND_FAILED";
}

export function PackagePublishingDialog(
  props: Parameters<typeof PackagePublishingDialogContent>[0],
) {
  return (
    <PackagePublishingDialogContent
      key={props.open ? "open" : "closed"}
      {...props}
    />
  );
}

function PackagePublishingDialogContent({
  open,
  onOpenChange,
}: PackagePublishingDialogProps) {
  const { t } = useTranslation();
  const projectName = useDocumentStore(
    (state) => state.history?.document.metadata.name ?? "Rino project",
  );
  const defaults = useMemo(() => initialOptions(projectName), [projectName]);
  const [options, setOptions] = useState(defaults);
  const [activity, setActivity] = useState<PublishingActivity>(() =>
    isPublishingAvailable() ? "checking" : "idle",
  );
  const [githubStatus, setGithubStatus] = useState<GithubStatus>(
    INITIAL_GITHUB_STATUS,
  );
  const [logoutConfirmation, setLogoutConfirmation] = useState(false);
  const [error, setError] = useState<PublishingErrorCode>();
  const [output, setOutput] = useState<PackageOutput | PublishOutput>();

  useEffect(() => {
    if (!open || !isPublishingAvailable()) return;
    void readGithubStatus()
      .then((status) => {
        setGithubStatus(status);
      })
      .catch(() => {
        setGithubStatus(INITIAL_GITHUB_STATUS);
      })
      .finally(() => {
        setActivity("idle");
      });
  }, [open]);

  const busy = activity !== "idle";

  const update = (field: keyof typeof options, value: string) => {
    setOptions((current) => ({ ...current, [field]: value }));
    setError(undefined);
    setOutput(undefined);
  };

  const completeOptions = (): PackageOptions => ({
    ...options,
    releasedAt: new Date().toISOString(),
  });

  const saveBeforePublishing = async (): Promise<boolean> => {
    const outcome = await saveProject();
    if (outcome.status === "completed") return true;
    setError("PACKAGE_WRITE_FAILED");
    return false;
  };

  const handleExport = async () => {
    setActivity("exporting");
    setError(undefined);
    setOutput(undefined);
    try {
      if (!(await saveBeforePublishing())) return;
      const result = await exportPackage(
        {
          title: t("publishing.dialog.exportTitle"),
          fileTypeLabel: t("publishing.dialog.fileTypeLabel"),
        },
        completeOptions(),
      );
      if (result) setOutput(result);
    } catch (cause) {
      setError(errorCode(cause));
    } finally {
      setActivity("idle");
    }
  };

  const runPublish = async () => {
    setActivity("publishing");
    setError(undefined);
    setOutput(undefined);
    try {
      if (!(await saveBeforePublishing())) return;
      setOutput(await publishPackage(completeOptions()));
    } catch (cause) {
      setError(errorCode(cause));
    } finally {
      setActivity("idle");
    }
  };

  const handleLogin = async () => {
    if (!githubStatus.available || busy) return;
    setActivity("loggingIn");
    setError(undefined);
    setOutput(undefined);
    try {
      setGithubStatus(await loginGithub());
    } catch (cause) {
      setError(errorCode(cause));
    } finally {
      setActivity("idle");
    }
  };

  const requestLogout = () => {
    if (!githubStatus.authenticated || busy) return;
    setError(undefined);
    setOutput(undefined);
    setLogoutConfirmation(true);
  };

  const cancelLogout = () => {
    if (!busy) setLogoutConfirmation(false);
  };

  const handleLogout = async () => {
    if (!githubStatus.authenticated || busy) return;
    setActivity("loggingOut");
    setError(undefined);
    setOutput(undefined);
    try {
      setGithubStatus(await logoutGithub());
    } catch (cause) {
      setError(errorCode(cause));
    } finally {
      setActivity("idle");
    }
  };

  const handlePublish = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runPublish();
  };

  const canPublish = githubStatus.authenticated && !busy;
  const publishOutput = output && "releaseUrl" in output ? output : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="publishing-dialog"
        closeLabel={t("common.actions.close")}
        title={t("publishing.dialog.title")}
        description={t("publishing.dialog.description")}
      >
        <form className="publishing-form" onSubmit={handlePublish}>
          <div className="publishing-form__notice">
            <ProductIcon icon="action.publish" />
            <span>{t("publishing.dialog.publicNotice")}</span>
          </div>

          <section
            className="publishing-form__auth"
            aria-labelledby="publishing-auth-title"
          >
            <div className="publishing-form__auth-heading">
              <div>
                <h2 id="publishing-auth-title">
                  {t("publishing.dialog.authTitle")}
                </h2>
                <p className="publishing-form__auth-description">
                  {t("publishing.dialog.authDescription")}
                </p>
              </div>
              <p className="publishing-form__status" role="status">
                {activity === "checking"
                  ? t("publishing.status.checking")
                  : githubStatus.authenticated
                    ? t("publishing.status.authenticated")
                    : githubStatus.available
                      ? t("publishing.status.loginRequired")
                      : t("publishing.status.cliRequired")}
              </p>
            </div>

            <p className="publishing-form__auth-flow">
              {t("publishing.dialog.authFlow")}
            </p>

            <div className="publishing-form__auth-actions">
              {githubStatus.authenticated ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={requestLogout}
                >
                  {activity === "loggingOut"
                    ? t("publishing.actions.loggingOut")
                    : t("publishing.actions.logout")}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={busy || !githubStatus.available}
                  onClick={() => void handleLogin()}
                >
                  {activity === "loggingIn"
                    ? t("publishing.actions.loggingIn")
                    : t("publishing.actions.login")}
                </Button>
              )}
            </div>

            {logoutConfirmation ? (
              <div className="publishing-form__logout-warning" role="alert">
                <p>{t("publishing.dialog.logoutWarning")}</p>
                <div className="publishing-form__inline-actions">
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void handleLogout()}
                  >
                    {t("publishing.actions.logoutConfirm")}
                  </Button>
                  <Button disabled={busy} onClick={cancelLogout}>
                    {t("publishing.actions.logoutCancel")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <div className="publishing-form__grid">
            <label>
              <span>{t("publishing.fields.packageId")}</span>
              <Input
                required
                value={options.packageId}
                onChange={(event) => {
                  update("packageId", event.target.value);
                }}
              />
            </label>
            <label>
              <span>{t("publishing.fields.version")}</span>
              <Input
                required
                pattern="(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
                value={options.version}
                onChange={(event) => {
                  update("version", event.target.value);
                }}
              />
            </label>
            <label className="publishing-form__wide">
              <span>{t("publishing.fields.summary")}</span>
              <Input
                required
                maxLength={2048}
                value={options.summary}
                onChange={(event) => {
                  update("summary", event.target.value);
                }}
              />
            </label>
            <label>
              <span>{t("publishing.fields.publisherId")}</span>
              <Input
                required
                value={options.publisherId}
                onChange={(event) => {
                  update("publisherId", event.target.value);
                }}
              />
            </label>
            <label>
              <span>{t("publishing.fields.publisherName")}</span>
              <Input
                required
                value={options.publisherDisplayName}
                onChange={(event) => {
                  update("publisherDisplayName", event.target.value);
                }}
              />
            </label>
            <label>
              <span>{t("publishing.fields.license")}</span>
              <Input
                required
                value={options.licenseIdentifier}
                onChange={(event) => {
                  update("licenseIdentifier", event.target.value);
                }}
              />
            </label>
            <label>
              <span>{t("publishing.fields.githubOwner")}</span>
              <Input
                required
                value={options.githubOwner}
                onChange={(event) => {
                  update("githubOwner", event.target.value);
                }}
              />
            </label>
            <label className="publishing-form__wide">
              <span>{t("publishing.fields.githubRepository")}</span>
              <Input
                required
                value={options.githubRepository}
                onChange={(event) => {
                  update("githubRepository", event.target.value);
                }}
              />
            </label>
          </div>

          <p className="publishing-form__field-help">
            {t("publishing.fields.metadataNotice")}
          </p>

          {error ? (
            <p className="publishing-form__error" role="alert">
              {t(`publishing.errors.${error}`)}
            </p>
          ) : null}
          {output ? (
            <div className="publishing-form__result" role="status">
              <strong>
                {publishOutput
                  ? t("publishing.result.published")
                  : t("publishing.result.exported")}
              </strong>
              <span>{output.assetName}</span>
              <span>
                {t("publishing.result.keyId", { keyId: output.keyId })}
              </span>
              <span className="publishing-form__digest">
                {t("publishing.result.publicKey", {
                  publicKey: output.publicKeyBase64,
                })}
              </span>
              <span className="publishing-form__digest">
                SHA-256 {output.sha256}
              </span>
              {publishOutput ? <span>{publishOutput.releaseUrl}</span> : null}
            </div>
          ) : null}

          <div className="publishing-form__actions">
            <Button disabled={busy} onClick={() => void handleExport()}>
              {activity === "exporting"
                ? t("publishing.actions.exporting")
                : t("publishing.actions.export")}
            </Button>
            <Button type="submit" variant="primary" disabled={!canPublish}>
              {activity === "publishing"
                ? t("publishing.actions.publishing")
                : t("publishing.actions.publish")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
