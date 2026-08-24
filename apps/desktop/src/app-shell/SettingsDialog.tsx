import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";
import { Dialog, DialogContent } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { ScrollArea } from "../components/ui/ScrollArea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/Tabs";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import type { ProductIconKey } from "../design-system/icons/product-icons";
import { useActiveDocument } from "../graph/store/document-store";
import { useApplicationDataStore } from "../preferences/application-data-store";
import {
  checkShortcutConflict,
  DEFAULT_SHORTCUT_DEFINITIONS,
  type ShortcutId,
  type ShortcutScope,
} from "../preferences/shortcut-preferences";
import { useShortcutPreferenceStore } from "../preferences/shortcut-preference-store";
import { useLayoutPreferenceStore } from "../preferences/layout-preference-store";
import {
  canvasPerformanceProfiles,
  performanceProfiles,
  previewRefreshRates,
  uiRefreshRates,
  type PerformanceProfile,
  type UiRefreshRate,
} from "../preferences/layout-preferences";
import { AppearanceSettings } from "./AppearanceSettings";
import { ShortcutRecorder } from "./ShortcutRecorder";
import {
  shortcutDefinitions,
  type ShortcutDefinition,
} from "./shortcut-registry";

export interface SettingsDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocus: () => void;
}

interface ShortcutRowProps {
  conflict: string | null;
  currentKeys: string;
  shortcut: ShortcutDefinition;
  onRecord: (newKeys: string) => void;
  onReset: () => void;
}

const UI_REFRESH_RATE_OPTION_KEYS: Record<
  UiRefreshRate,
  | "shell.settings.uiRefreshRateOptions.display"
  | "shell.settings.uiRefreshRateOptions.60"
  | "shell.settings.uiRefreshRateOptions.120"
  | "shell.settings.uiRefreshRateOptions.180"
> = {
  display: "shell.settings.uiRefreshRateOptions.display",
  60: "shell.settings.uiRefreshRateOptions.60",
  120: "shell.settings.uiRefreshRateOptions.120",
  180: "shell.settings.uiRefreshRateOptions.180",
};

function ShortcutRow({
  conflict,
  currentKeys,
  shortcut,
  onRecord,
  onReset,
}: ShortcutRowProps) {
  const { t } = useTranslation();

  return (
    <li
      className={`shortcut-row ${conflict ? "shortcut-row--has-conflict" : ""}`}
    >
      <span className="shortcut-row__command">
        <strong>{t(`shell.shortcuts.${shortcut.id}.label`)}</strong>
        <span>{t(`shell.shortcuts.${shortcut.id}.description`)}</span>
        {conflict ? (
          <span className="shortcut-row__conflict-error" role="alert">
            {conflict}
          </span>
        ) : null}
      </span>
      <ShortcutRecorder
        currentKeys={currentKeys}
        defaultKeys={shortcut.defaultKeys}
        onRecord={onRecord}
        onReset={onReset}
      />
    </li>
  );
}

function PerformanceSettings() {
  const { t } = useTranslation();
  const performanceProfile = useLayoutPreferenceStore(
    (state) => state.layout.performanceProfile,
  );
  const previewRefreshFps = useLayoutPreferenceStore(
    (state) => state.layout.previewRefreshFps,
  );
  const uiRefreshRate = useLayoutPreferenceStore(
    (state) => state.layout.uiRefreshRate,
  );
  const updateLayout = useLayoutPreferenceStore((state) => state.updateLayout);

  const selectProfile = (profile: PerformanceProfile) => {
    updateLayout({
      performanceProfile: profile,
      previewRefreshFps:
        canvasPerformanceProfiles[profile].suggestedPreviewRefreshFps,
    });
  };

  return (
    <section
      className="performance-settings"
      aria-labelledby="performance-title"
    >
      <div className="performance-settings__intro">
        <h3 id="performance-title">{t("shell.settings.performanceTitle")}</h3>
        <p>{t("shell.settings.performanceDescription")}</p>
      </div>

      <div className="performance-settings__group">
        <h4>{t("shell.settings.resourceProfile")}</h4>
        <p>{t("shell.settings.resourceProfileDescription")}</p>
        <div
          className="performance-settings__options"
          role="radiogroup"
          aria-label={t("shell.settings.resourceProfile")}
        >
          {performanceProfiles.map((profile) => (
            <Button
              key={profile}
              role="radio"
              size="compact"
              aria-checked={performanceProfile === profile}
              variant={performanceProfile === profile ? "primary" : "ghost"}
              onClick={() => {
                selectProfile(profile);
              }}
            >
              {t(`shell.settings.performanceProfiles.${profile}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="performance-settings__group">
        <h4>{t("shell.settings.uiRefreshRate")}</h4>
        <p>{t("shell.settings.uiRefreshRateDescription")}</p>
        <div
          className="performance-settings__options"
          role="radiogroup"
          aria-label={t("shell.settings.uiRefreshRate")}
        >
          {uiRefreshRates.map((rate) => (
            <Button
              key={rate}
              role="radio"
              size="compact"
              aria-checked={uiRefreshRate === rate}
              variant={uiRefreshRate === rate ? "primary" : "ghost"}
              onClick={() => {
                updateLayout({ uiRefreshRate: rate });
              }}
            >
              {t(UI_REFRESH_RATE_OPTION_KEYS[rate])}
            </Button>
          ))}
        </div>
      </div>

      <div className="performance-settings__group">
        <h4>{t("shell.settings.previewRefreshRate")}</h4>
        <p>{t("shell.settings.previewRefreshRateDescription")}</p>
        <div
          className="performance-settings__options"
          role="radiogroup"
          aria-label={t("shell.settings.previewRefreshRate")}
        >
          {previewRefreshRates.map((rate) => (
            <Button
              key={rate}
              role="radio"
              size="compact"
              aria-checked={previewRefreshFps === rate}
              variant={previewRefreshFps === rate ? "primary" : "ghost"}
              onClick={() => {
                updateLayout({ previewRefreshFps: rate });
              }}
            >
              {t("shell.settings.framesPerSecond", { count: rate })}
            </Button>
          ))}
        </div>
      </div>

      <div className="performance-settings__group">
        <div className="performance-settings__status-line">
          <h4>{t("shell.settings.hardwareAcceleration")}</h4>
          <span>{t("shell.settings.hardwareAccelerationAutomatic")}</span>
        </div>
        <p>{t("shell.settings.hardwareAccelerationDescription")}</p>
      </div>
    </section>
  );
}

type PersistentClearTarget = "current" | "all";

interface PersistentClearFeedback {
  kind: "success" | "memoryOnly" | "error";
  message: string;
}

interface ApplicationDataSettingsProps {
  open: boolean;
}

function ApplicationDataSettings({ open }: ApplicationDataSettingsProps) {
  const activeDocument = useActiveDocument();
  const resetKey = `${open ? "open" : "closed"}:${activeDocument?.documentId ?? "none"}`;
  return <ApplicationDataSettingsContent key={resetKey} />;
}

function ApplicationDataSettingsContent() {
  const { t } = useTranslation();
  const activeDocument = useActiveDocument();
  const installationCode = useApplicationDataStore(
    (state) => state.installationCode,
  );
  const storageStatus = useApplicationDataStore((state) => state.storageStatus);
  const assetNameRecordCount = useApplicationDataStore(
    (state) => Object.keys(state.assetNameOrdinals).length,
  );
  const persistentVariablesByDocument = useApplicationDataStore(
    (state) => state.persistentVariablesByDocument,
  );
  const clearPersistentVariablesForDocument = useApplicationDataStore(
    (state) => state.clearPersistentVariablesForDocument,
  );
  const clearAllPersistentVariables = useApplicationDataStore(
    (state) => state.clearAllPersistentVariables,
  );
  const [clearTarget, setClearTarget] = useState<
    PersistentClearTarget | undefined
  >();
  const [feedback, setFeedback] = useState<
    PersistentClearFeedback | undefined
  >();

  const savedProjectCount = Object.keys(persistentVariablesByDocument).length;
  const savedValueCount = Object.values(persistentVariablesByDocument).reduce(
    (total, values) => total + values.length,
    0,
  );
  const currentSavedValueCount =
    activeDocument === undefined
      ? 0
      : (persistentVariablesByDocument[activeDocument.documentId]?.length ?? 0);

  const requestClear = (target: PersistentClearTarget) => {
    setFeedback(undefined);
    setClearTarget(target);
  };

  const confirmClear = () => {
    if (clearTarget === undefined) {
      return;
    }
    const result =
      clearTarget === "current" && activeDocument !== undefined
        ? clearPersistentVariablesForDocument(activeDocument.documentId)
        : clearTarget === "all"
          ? clearAllPersistentVariables()
          : {
              ok: false as const,
              reason: "invalidDocumentId" as const,
              storageStatus: "memoryOnly" as const,
            };
    setClearTarget(undefined);
    if (!result.ok) {
      setFeedback({
        kind: "error",
        message: t("shell.settings.persistentVariablesClearFailure"),
      });
      return;
    }
    setFeedback({
      kind: result.storageStatus === "memoryOnly" ? "memoryOnly" : "success",
      message:
        result.storageStatus === "memoryOnly"
          ? t("shell.settings.persistentVariablesClearMemoryOnly")
          : clearTarget === "current"
            ? t("shell.settings.persistentVariablesClearSuccessCurrent")
            : t("shell.settings.persistentVariablesClearSuccessAll"),
    });
  };

  const confirmationTitle =
    clearTarget === "current"
      ? t("shell.settings.persistentVariablesConfirmCurrentTitle")
      : t("shell.settings.persistentVariablesConfirmAllTitle");
  const confirmationDescription =
    clearTarget === "current"
      ? t("shell.settings.persistentVariablesConfirmCurrentDescription")
      : t("shell.settings.persistentVariablesConfirmAllDescription");

  return (
    <section className="data-settings" aria-labelledby="data-settings-title">
      <div className="settings-page__intro">
        <h3 id="data-settings-title">{t("shell.settings.dataTitle")}</h3>
        <p>{t("shell.settings.dataDescription")}</p>
      </div>

      <div className="data-settings__identity-card">
        <div className="data-settings__identity-heading">
          <div>
            <h4>{t("shell.settings.installationCode")}</h4>
            <p>{t("shell.settings.installationCodeDescription")}</p>
          </div>
          <span data-status={storageStatus}>
            {t(`shell.settings.storageStatus.${storageStatus}`)}
          </span>
        </div>
        <code className="data-settings__code">
          {installationCode ?? t("shell.settings.installationCodeUnavailable")}
        </code>
        <p className="data-settings__example font-code">
          {t("shell.settings.assetNameExample", {
            code: installationCode ?? "XXXXXXXX",
          })}
        </p>
      </div>

      <div className="data-settings__scope">
        <h4>{t("shell.settings.localDataTitle")}</h4>
        <dl className="data-settings__list">
          <div>
            <dt>{t("shell.settings.interfaceData")}</dt>
            <dd>{t("shell.settings.localOnly")}</dd>
          </div>
          <div>
            <dt>{t("shell.settings.shortcutData")}</dt>
            <dd>{t("shell.settings.localOnly")}</dd>
          </div>
          <div>
            <dt>{t("shell.settings.assetNamingData")}</dt>
            <dd>
              {t("shell.settings.assetNamingRecordCount", {
                count: assetNameRecordCount,
              })}
            </dd>
          </div>
          <div>
            <dt>{t("shell.settings.projectData")}</dt>
            <dd>{t("shell.settings.projectFolder")}</dd>
          </div>
        </dl>
      </div>

      <section
        className="data-settings__persistent-card"
        aria-labelledby="persistent-variables-title"
      >
        <div className="data-settings__persistent-heading">
          <div>
            <h4 id="persistent-variables-title">
              {t("shell.settings.persistentVariablesTitle")}
            </h4>
            <p>{t("shell.settings.persistentVariablesDescription")}</p>
          </div>
          <span>{t("shell.settings.persistentVariablesStoredLocally")}</span>
        </div>
        <dl className="data-settings__persistent-summary">
          <div>
            <dt>{t("shell.settings.persistentVariablesProjectCount")}</dt>
            <dd>{savedProjectCount}</dd>
          </div>
          <div>
            <dt>{t("shell.settings.persistentVariablesValueCount")}</dt>
            <dd>{savedValueCount}</dd>
          </div>
          <div>
            <dt>{t("shell.settings.persistentVariablesCurrentCount")}</dt>
            <dd>{currentSavedValueCount}</dd>
          </div>
        </dl>
        <p className="data-settings__persistent-note">
          {t("shell.settings.persistentVariablesLocalOnlyNote")}
        </p>
        <div className="data-settings__persistent-actions">
          <Button
            size="compact"
            variant="destructive"
            disabled={
              activeDocument === undefined || currentSavedValueCount === 0
            }
            onClick={() => {
              requestClear("current");
            }}
          >
            {t("shell.settings.clearCurrentPersistentVariables")}
          </Button>
          <Button
            size="compact"
            variant="destructive"
            disabled={savedValueCount === 0}
            onClick={() => {
              requestClear("all");
            }}
          >
            {t("shell.settings.clearAllPersistentVariables")}
          </Button>
        </div>
        {feedback ? (
          <p
            className="data-settings__persistent-feedback"
            data-status={feedback.kind}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </p>
        ) : null}
      </section>

      <p className="data-settings__privacy-note">
        <ProductIcon icon="runtime.warning" size="small" />
        <span>{t("shell.settings.installationCodePrivacy")}</span>
      </p>

      <Dialog
        open={clearTarget !== undefined}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setClearTarget(undefined);
          }
        }}
      >
        <DialogContent
          className="persistent-variable-confirmation-dialog"
          closeLabel={t("common.actions.close")}
          title={confirmationTitle}
          description={confirmationDescription}
        >
          <div className="persistent-variable-confirmation-dialog__body">
            <p>{t("shell.settings.persistentVariablesConfirmDetails")}</p>
            <div className="persistent-variable-confirmation-dialog__actions">
              <Button
                variant="ghost"
                onClick={() => {
                  setClearTarget(undefined);
                }}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button variant="destructive" onClick={confirmClear}>
                {t("shell.settings.persistentVariablesConfirmAction")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type SettingsSection = "appearance" | "performance" | "shortcuts" | "data";

const SETTINGS_SECTIONS: readonly {
  id: SettingsSection;
  icon: ProductIconKey;
}[] = [
  { id: "appearance", icon: "recognition.color" },
  { id: "performance", icon: "panel.inspector" },
  { id: "shortcuts", icon: "action.keyboardReference" },
  { id: "data", icon: "category.data" },
];

function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

function omitShortcutConflict(
  conflicts: Partial<Record<ShortcutId, string>>,
  id: ShortcutId,
): Partial<Record<ShortcutId, string>> {
  return Object.fromEntries(
    Object.entries(conflicts).filter(([shortcutId]) => shortcutId !== id),
  );
}

const SCOPES: readonly ShortcutScope[] = ["global", "canvas", "runtime"];

export function SettingsDialog({
  open,
  onOpenChange,
  restoreFocus,
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("appearance");
  const [query, setQuery] = useState("");
  const [conflicts, setConflicts] = useState<
    Partial<Record<ShortcutId, string>>
  >({});

  const overrides = useShortcutPreferenceStore((s) => s.overrides);
  const setBinding = useShortcutPreferenceStore((s) => s.setBinding);
  const resetBinding = useShortcutPreferenceStore((s) => s.resetBinding);
  const resetAll = useShortcutPreferenceStore((s) => s.resetAll);

  const effectiveKeysMap = useMemo(() => {
    const map: Record<ShortcutId, string> = {} as Record<ShortcutId, string>;
    for (const def of DEFAULT_SHORTCUT_DEFINITIONS) {
      map[def.id] = overrides[def.id] ?? def.defaultKeys;
    }
    return map;
  }, [overrides]);

  const hasOverrides = Object.keys(overrides).length > 0;

  const currentDefinitions = useMemo(() => {
    return shortcutDefinitions.map((def) => ({
      ...def,
      keys: effectiveKeysMap[def.id],
      defaultKeys: def.keys,
    }));
  }, [effectiveKeysMap]);

  const normalizedQuery = query.trim().toLocaleLowerCase();

  const filteredShortcuts = useMemo(
    () =>
      currentDefinitions.filter((shortcut) => {
        const searchText = [
          t(`shell.shortcuts.${shortcut.id}.label`),
          t(`shell.shortcuts.${shortcut.id}.description`),
          shortcut.keys,
          t(`shell.settings.scopes.${shortcut.scope}`),
        ]
          .join(" ")
          .toLocaleLowerCase();
        return searchText.includes(normalizedQuery);
      }),
    [currentDefinitions, normalizedQuery, t],
  );

  const groupedShortcuts = useMemo(() => {
    const groups: { scope: ShortcutScope; items: ShortcutDefinition[] }[] = [];
    for (const scope of SCOPES) {
      const items = filteredShortcuts.filter((s) => s.scope === scope);
      if (items.length > 0) {
        groups.push({ scope, items });
      }
    }
    return groups;
  }, [filteredShortcuts]);

  const handleRecord = (id: ShortcutId, newKeys: string) => {
    const conflictingId = checkShortcutConflict(id, newKeys, effectiveKeysMap);
    if (conflictingId) {
      const otherName = t(`shell.shortcuts.${conflictingId}.label`);
      setConflicts((prev) => ({
        ...prev,
        [id]: t("shell.settings.conflictWarning", { other: otherName }),
      }));
      return;
    }

    setConflicts((prev) => omitShortcutConflict(prev, id));
    setBinding(id, newKeys);
  };

  const handleReset = (id: ShortcutId) => {
    setConflicts((prev) => omitShortcutConflict(prev, id));
    resetBinding(id);
  };

  const handleResetAll = () => {
    setConflicts({});
    resetAll();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="settings-dialog"
        closeLabel={t("common.actions.close")}
        title={t("shell.settings.title")}
        description={t("shell.settings.description")}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <Tabs
          className="settings-dialog__layout"
          orientation="vertical"
          value={activeSection}
          onValueChange={(value) => {
            if (isSettingsSection(value)) {
              setActiveSection(value);
            }
          }}
        >
          <TabsList
            className="settings-dialog__navigation"
            aria-label={t("shell.settings.navigationLabel")}
          >
            {SETTINGS_SECTIONS.map((section) => (
              <TabsTrigger
                key={section.id}
                value={section.id}
                className="settings-dialog__navigation-item"
              >
                <ProductIcon icon={section.icon} size="small" />
                <span>{t(`shell.settings.sections.${section.id}`)}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="settings-dialog__content">
            <TabsContent value="appearance" className="settings-page">
              <div className="settings-page__intro">
                <h3>{t("shell.settings.appearanceTitle")}</h3>
                <p>{t("shell.settings.appearanceDescription")}</p>
              </div>
              <AppearanceSettings />
            </TabsContent>

            <TabsContent value="performance" className="settings-page">
              <PerformanceSettings />
            </TabsContent>

            <TabsContent value="shortcuts" className="shortcut-reference">
              <div className="shortcut-reference__intro">
                <div className="shortcut-reference__header">
                  <h3>{t("shell.settings.shortcutsTitle")}</h3>
                  {hasOverrides ? (
                    <Button
                      size="compact"
                      variant="ghost"
                      className="shortcut-reference__reset-all"
                      onClick={handleResetAll}
                    >
                      {t("shell.settings.resetAllShortcuts")}
                    </Button>
                  ) : null}
                </div>
                <p>{t("shell.settings.shortcutsDescription")}</p>
              </div>
              <label className="shortcut-reference__search">
                <ProductIcon icon="action.search" size="small" />
                <Input
                  value={query}
                  placeholder={t("shell.settings.searchShortcuts")}
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                />
              </label>
              <ScrollArea className="shortcut-reference__scroll-area">
                {groupedShortcuts.length === 0 ? (
                  <p className="shortcut-reference__empty">
                    {t("shell.settings.noShortcutResults")}
                  </p>
                ) : (
                  <div className="shortcut-reference__groups">
                    {groupedShortcuts.map((group) => (
                      <div key={group.scope} className="shortcut-group">
                        <h4 className="shortcut-group__title">
                          {t(`shell.settings.scopes.${group.scope}`)}
                        </h4>
                        <ul className="shortcut-group__grid">
                          {group.items.map((shortcut) => (
                            <ShortcutRow
                              key={shortcut.id}
                              shortcut={shortcut}
                              currentKeys={shortcut.keys}
                              conflict={conflicts[shortcut.id] ?? null}
                              onRecord={(newKeys) => {
                                handleRecord(shortcut.id, newKeys);
                              }}
                              onReset={() => {
                                handleReset(shortcut.id);
                              }}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="data" className="settings-page">
              <ApplicationDataSettings open={open} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
