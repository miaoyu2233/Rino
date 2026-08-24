import { MotionConfig } from "motion/react";

import { ApplicationFrame } from "../app-shell/ApplicationFrame";
import { TooltipProvider } from "../components/ui/Tooltip";
import { ApplicationErrorBoundary } from "../diagnostics/ApplicationErrorBoundary";
import { RegistryProvider } from "../graph/registry/RegistryProvider";
import { DevicePreviewSessionProvider } from "../ipc/DevicePreviewSessionProvider";
import { RuntimeProvider } from "../ipc/RuntimeProvider";
import { motionTransitions } from "../design-system/motion";
import { ThemeProvider } from "../design-system/theme/ThemeProvider";
import { LocaleProvider } from "../localization/LocaleProvider";

export function App() {
  return (
    <ApplicationErrorBoundary>
      <LocaleProvider>
        <ThemeProvider>
          <MotionConfig
            reducedMotion="user"
            transition={motionTransitions.standard}
          >
            <TooltipProvider>
              <RuntimeProvider>
                <DevicePreviewSessionProvider>
                  <RegistryProvider>
                    <ApplicationFrame />
                  </RegistryProvider>
                </DevicePreviewSessionProvider>
              </RuntimeProvider>
            </TooltipProvider>
          </MotionConfig>
        </ThemeProvider>
      </LocaleProvider>
    </ApplicationErrorBoundary>
  );
}
