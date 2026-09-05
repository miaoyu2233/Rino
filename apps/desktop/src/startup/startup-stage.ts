export const STARTUP_STAGE_EVENT_NAME = "rino://startup-stage";

export const STARTUP_STAGES = [
  "initializing",
  "runtime",
  "registry",
  "workspace",
  "opening",
] as const;

export type StartupStage = (typeof STARTUP_STAGES)[number];
export type SplashLocale = "zh-CN" | "en-US";

interface StartupStageCopy {
  readonly status: string;
}

interface SplashscreenCopy {
  readonly context: string;
  readonly subtitle: string;
  readonly stages: Record<StartupStage, StartupStageCopy>;
}

const SPLASHSCREEN_COPY: Record<SplashLocale, SplashscreenCopy> = {
  "zh-CN": {
    context: "Rino 桌面应用",
    subtitle: "可视化自动化编辑器",
    stages: {
      initializing: { status: "正在初始化桌面应用" },
      runtime: { status: "正在启动运行环境" },
      registry: { status: "正在加载节点组件" },
      workspace: { status: "正在准备工作区" },
      opening: { status: "正在打开主界面" },
    },
  },
  "en-US": {
    context: "Rino desktop application",
    subtitle: "Visual automation editor",
    stages: {
      initializing: { status: "Initializing desktop application" },
      runtime: { status: "Starting runtime environment" },
      registry: { status: "Loading node components" },
      workspace: { status: "Preparing workspace" },
      opening: { status: "Opening main interface" },
    },
  },
};

export function resolveSplashLocale(
  language: string | undefined,
): SplashLocale {
  return language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function isStartupStage(value: unknown): value is StartupStage {
  return (
    typeof value === "string" &&
    (STARTUP_STAGES as readonly string[]).includes(value)
  );
}

/** Accepts only the fixed string payload emitted by the native startup command. */
export function parseStartupStagePayload(
  payload: unknown,
): StartupStage | undefined {
  return isStartupStage(payload) ? payload : undefined;
}

export function getSplashscreenCopy(locale: SplashLocale): SplashscreenCopy {
  return SPLASHSCREEN_COPY[locale];
}
