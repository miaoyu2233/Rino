import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";

export interface ShortcutRecorderProps {
  currentKeys: string;
  defaultKeys: string;
  disabled?: boolean;
  onRecord: (newKeys: string) => void;
  onReset: () => void;
}

function eventToShortcutString(event: KeyboardEvent): string | null {
  const key = event.key;
  const lowerKey = key.toLowerCase();

  if (
    lowerKey === "control" ||
    lowerKey === "alt" ||
    lowerKey === "shift" ||
    lowerKey === "meta"
  ) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");

  const mainKey =
    lowerKey === " "
      ? "Space"
      : key.length === 1
        ? key.toUpperCase()
        : key.charAt(0).toUpperCase() + key.slice(1);

  parts.push(mainKey);
  return parts.join("+");
}

export function ShortcutRecorder({
  currentKeys,
  defaultKeys,
  disabled = false,
  onRecord,
  onReset,
}: ShortcutRecorderProps) {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<string | null>(null);

  const startRecording = useCallback(() => {
    if (disabled) return;
    setIsRecording(true);
    setPendingKeys(null);
  }, [disabled]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setPendingKeys(null);
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        stopRecording();
        return;
      }

      const combo = eventToShortcutString(event);
      if (combo) {
        onRecord(combo);
        stopRecording();
      } else {
        // Show current modifiers while waiting for main key
        const parts: string[] = [];
        if (event.ctrlKey) parts.push("Ctrl");
        if (event.altKey) parts.push("Alt");
        if (event.shiftKey) parts.push("Shift");
        if (event.metaKey) parts.push("Meta");
        if (parts.length > 0) {
          setPendingKeys(`${parts.join("+")}+...`);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isRecording, onRecord, stopRecording]);

  const isCustomized = currentKeys !== defaultKeys;

  if (isRecording) {
    return (
      <div className="shortcut-recorder shortcut-recorder--active">
        <kbd className="shortcut-recorder__kbd shortcut-recorder__kbd--recording">
          {pendingKeys ?? t("shell.settings.recordingPrompt")}
        </kbd>
        <Button
          size="compact"
          variant="ghost"
          onClick={stopRecording}
          title={t("common.actions.cancel")}
        >
          {t("common.actions.cancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className="shortcut-recorder">
      <button
        type="button"
        className="shortcut-recorder__trigger"
        onClick={startRecording}
        title={t("shell.settings.clickToChangeShortcut")}
      >
        <kbd
          className={`shortcut-recorder__kbd ${isCustomized ? "shortcut-recorder__kbd--customized" : ""}`}
        >
          {currentKeys}
        </kbd>
      </button>

      {isCustomized ? (
        <Button
          size="compact"
          variant="ghost"
          className="shortcut-recorder__reset-btn"
          onClick={onReset}
          title={t("shell.settings.resetToDefault")}
          aria-label={t("shell.settings.resetToDefault")}
        >
          {t("shell.settings.resetSingle")}
        </Button>
      ) : null}
    </div>
  );
}
