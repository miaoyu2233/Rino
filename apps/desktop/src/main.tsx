import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { DevicePreviewWindowRoot } from "./device-preview/DevicePreviewWindowApp";
import { isDevicePreviewWindow } from "./device-preview/device-preview-window-bridge";
import { initializeTheme } from "./design-system/theme/theme-state";
import { ApplicationErrorScreen } from "./diagnostics/ApplicationErrorScreen";
import {
  createApplicationFailureGate,
  installGlobalApplicationFailureHandlers,
  normalizeApplicationFailure,
  type ApplicationFailureDetails,
} from "./diagnostics/application-failure";
import { reportProblem } from "./diagnostics/diagnostic-store";
import { initializeProjectService } from "./graph/project/project-service";
import { initializeLocalization } from "./localization/i18n";
import { initializeApplicationData } from "./preferences/application-data-store";
import { initializeLayoutPreferences } from "./preferences/layout-preference-store";
import { hardenObjectPrototype } from "./security/prototype-hardening";
import { StartupGate } from "./startup/startup-gate";
import { completeStartupWindow } from "./startup/startup-gate-runtime";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("The application root element is missing.");
}

const root = createRoot(rootElement);
const showFatalFailure = (failure: ApplicationFailureDetails): void => {
  void completeStartupWindow();
  reportProblem({
    severity: "error",
    source: "application",
    titleKey: "diagnostics.applicationError.title",
    descriptionKey: "diagnostics.applicationError.description",
    code: "APPLICATION_FATAL",
  });
  root.render(<ApplicationErrorScreen failure={failure} />);
};

const reportFatalFailure = createApplicationFailureGate(showFatalFailure);

installGlobalApplicationFailureHandlers(reportFatalFailure);

try {
  hardenObjectPrototype();
  initializeTheme();
  initializeLocalization();
  const isPreviewWindow = isDevicePreviewWindow();

  if (!isPreviewWindow) {
    initializeApplicationData();
    initializeLayoutPreferences();
    initializeProjectService();
  }

  root.render(
    <StrictMode>
      {isPreviewWindow ? (
        <DevicePreviewWindowRoot />
      ) : (
        <StartupGate>
          <App />
        </StartupGate>
      )}
    </StrictMode>,
  );
} catch (failure: unknown) {
  reportFatalFailure(normalizeApplicationFailure(failure));
}
