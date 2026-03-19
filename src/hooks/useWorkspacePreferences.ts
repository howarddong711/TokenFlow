import { useEffect, useMemo, useState } from "react";
import type { ProviderId } from "@/types";
import { PROVIDERS } from "@/types";

const STORAGE_KEY = "tokenflow-workspace-prefs";

export type WorkspaceTheme = "light" | "dark" | "system";

export interface WorkspacePreferences {
  theme: WorkspaceTheme;
  privacyMode: boolean;
  minimizeToTray: boolean;
  launchOnStartup: boolean;
  autoUpdate: boolean;
  providerColors: Record<ProviderId, string>;
}

const LEGACY_PROVIDER_COLORS: Partial<Record<ProviderId, string>> = {
  codex: "#10a37f",
  claude: "#d4a574",
  qwen: "#7c3aed",
  cursor: "#6366f1",
  trae: "#0ea5e9",
  factory: "#06b6d4",
  gemini: "#4285f4",
  iflow: "#06b6d4",
  antigravity: "#8b5cf6",
  copilot: "#6e40c9",
  kiro: "#0f766e",
  vertexai: "#2563eb",
  opencode: "#059669",
  warp: "#1d4ed8",
};

const DEFAULT_PROVIDER_COLORS = Object.fromEntries(
  Object.entries(PROVIDERS).map(([providerId, meta]) => [providerId, meta.color])
) as Record<ProviderId, string>;

const DEFAULT_PREFERENCES: WorkspacePreferences = {
  theme: "system",
  privacyMode: false,
  minimizeToTray: true,
  launchOnStartup: false,
  autoUpdate: false,
  providerColors: DEFAULT_PROVIDER_COLORS,
};

function readPreferences(): WorkspacePreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspacePreferences>;
    return {
      theme:
        parsed.theme === "dark" || parsed.theme === "light" || parsed.theme === "system"
          ? parsed.theme
          : DEFAULT_PREFERENCES.theme,
      privacyMode: Boolean(parsed.privacyMode),
      minimizeToTray:
        typeof parsed.minimizeToTray === "boolean"
          ? parsed.minimizeToTray
          : DEFAULT_PREFERENCES.minimizeToTray,
      launchOnStartup:
        typeof parsed.launchOnStartup === "boolean"
          ? parsed.launchOnStartup
          : DEFAULT_PREFERENCES.launchOnStartup,
      autoUpdate:
        typeof parsed.autoUpdate === "boolean"
          ? parsed.autoUpdate
          : DEFAULT_PREFERENCES.autoUpdate,
      providerColors: upgradeLegacyProviderColors({
        ...DEFAULT_PROVIDER_COLORS,
        ...(parsed.providerColors ?? {}),
      }),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function upgradeLegacyProviderColors(
  providerColors: Record<ProviderId, string>
): Record<ProviderId, string> {
  const next = { ...providerColors };

  for (const [providerId, legacyColor] of Object.entries(LEGACY_PROVIDER_COLORS) as Array<
    [ProviderId, string]
  >) {
    if (next[providerId]?.toLowerCase() === legacyColor.toLowerCase()) {
      next[providerId] = DEFAULT_PROVIDER_COLORS[providerId];
    }
  }

  return next;
}

export function useWorkspacePreferences() {
  const [preferences, setPreferences] = useState<WorkspacePreferences>(readPreferences);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedDark =
        preferences.theme === "dark" || (preferences.theme === "system" && media.matches);
      if (resolvedDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    applyTheme();
    media.addEventListener("change", applyTheme);

    return () => {
      media.removeEventListener("change", applyTheme);
    };
  }, [preferences.theme]);

  return useMemo(
    () => ({
      preferences,
      setTheme: (theme: WorkspaceTheme) =>
        setPreferences((current) => ({
          ...current,
          theme,
        })),
      setPrivacyMode: (privacyMode: boolean) =>
        setPreferences((current) => ({
          ...current,
          privacyMode,
        })),
      setMinimizeToTray: (minimizeToTray: boolean) =>
        setPreferences((current) => ({
          ...current,
          minimizeToTray,
        })),
      setLaunchOnStartup: (launchOnStartup: boolean) =>
        setPreferences((current) => ({
          ...current,
          launchOnStartup,
        })),
      setAutoUpdate: (autoUpdate: boolean) =>
        setPreferences((current) => ({
          ...current,
          autoUpdate,
        })),
      setProviderColor: (providerId: ProviderId, color: string) =>
        setPreferences((current) => ({
          ...current,
          providerColors: {
            ...current.providerColors,
            [providerId]: color,
          },
        })),
      resetProviderColors: () =>
        setPreferences((current) => ({
          ...current,
          providerColors: DEFAULT_PROVIDER_COLORS,
        })),
    }),
    [preferences]
  );
}
