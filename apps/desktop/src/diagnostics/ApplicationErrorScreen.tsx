import type { ParseKeys } from "i18next";
import { useState } from "react";

import { applicationI18n } from "../localization/i18n";
import type { ApplicationFailureDetails } from "./application-failure";

export interface ApplicationErrorScreenProps {
  failure: ApplicationFailureDetails;
}

/** The recovery surface shown when the whole application failed to render.
 *
 * This screen may render after the provider tree failed, so it reads the localization
 * instance directly instead of through a React context, and falls back to the primary
 * locale text when even that is unavailable.
 */
export function ApplicationErrorScreen({
  failure,
}: ApplicationErrorScreenProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const translate = (key: ParseKeys, fallback: string): string => {
    try {
      const translated: string = applicationI18n.t(key);
      return translated === key ? fallback : translated;
    } catch {
      return fallback;
    }
  };
  const message =
    failure.message ??
    translate(
      "diagnostics.applicationError.unknownMessage",
      "发生了未知错误。",
    );
  const technicalDetails = [
    `${translate("diagnostics.applicationError.errorType", "错误类型")}：${failure.name}`,
    `${translate("diagnostics.applicationError.errorMessage", "错误信息")}：${message}`,
    failure.stack === undefined
      ? undefined
      : `${translate("diagnostics.applicationError.stackTrace", "堆栈跟踪")}：\n${failure.stack}`,
    failure.componentStack === undefined
      ? undefined
      : `${translate("diagnostics.applicationError.componentStack", "组件堆栈")}：\n${failure.componentStack}`,
  ]
    .filter((section): section is string => section !== undefined)
    .join("\n\n");

  const copyDetails = (): void => {
    try {
      const clipboard = Reflect.get(navigator, "clipboard") as
        Clipboard | undefined;
      if (clipboard === undefined) {
        setCopyState("failed");
        return;
      }
      void clipboard.writeText(technicalDetails).then(
        () => {
          setCopyState("copied");
        },
        () => {
          setCopyState("failed");
        },
      );
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="application-error" role="alert">
      <div className="application-error__panel">
        <h1 className="application-error__title">
          {translate("diagnostics.applicationError.title", "Rino 遇到了问题")}
        </h1>
        <p className="application-error__description">
          {translate(
            "diagnostics.applicationError.description",
            "程序遇到了无法恢复的界面错误。重新加载窗口可能丢失尚未保存的修改。",
          )}
        </p>
        <p className="application-error__summary">{message}</p>
        <details className="application-error__details">
          <summary>
            {translate("diagnostics.applicationError.details", "详细信息")}
          </summary>
          <pre>{technicalDetails}</pre>
        </details>
        <div className="application-error__actions">
          <button
            type="button"
            className="ui-button ui-button--secondary ui-button--standard"
            onClick={copyDetails}
          >
            {translate(
              "diagnostics.applicationError.copyDetails",
              "复制详细信息",
            )}
          </button>
          <button
            type="button"
            className="ui-button ui-button--primary ui-button--standard"
            onClick={() => {
              window.location.reload();
            }}
          >
            {translate("diagnostics.actions.reloadWindow", "重新加载窗口")}
          </button>
        </div>
        <p className="application-error__copy-status" aria-live="polite">
          {copyState === "copied"
            ? translate(
                "diagnostics.applicationError.detailsCopied",
                "详细信息已复制。",
              )
            : copyState === "failed"
              ? translate(
                  "diagnostics.applicationError.copyFailed",
                  "无法访问剪贴板，请展开后手动复制。",
                )
              : null}
        </p>
      </div>
    </div>
  );
}
