import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";

export interface AppUpdateInfo {
  version: string;
  currentVersion: string;
  notes?: string | null;
  publishedAt?: string | null;
}

export interface AppUpdatePolicy {
  channel: string;
  inAppUpdatesEnabled: boolean;
}

export type AppUpdaterState =
  | { phase: "idle"; checkedAt?: string; update?: AppUpdateInfo; error?: string }
  | { phase: "checking"; checkedAt?: string; update?: AppUpdateInfo; error?: string }
  | { phase: "upToDate"; checkedAt: string; update?: undefined; error?: undefined }
  | { phase: "available"; checkedAt: string; update: AppUpdateInfo; error?: undefined }
  | { phase: "installing"; checkedAt?: string; update?: AppUpdateInfo; error?: undefined }
  | { phase: "installed"; checkedAt?: string; update?: AppUpdateInfo; error?: undefined }
  | { phase: "error"; checkedAt?: string; update?: AppUpdateInfo; error: string };

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function useAppUpdater(autoUpdate: boolean) {
  const [state, setState] = useState<AppUpdaterState>({ phase: "idle" });
  const [policy, setPolicy] = useState<AppUpdatePolicy>({
    channel: "github",
    inAppUpdatesEnabled: true,
  });
  const autoStartedRef = useRef(false);

  const installUpdate = async (checkedAtOverride?: string, updateOverride?: AppUpdateInfo) => {
    if (!policy.inAppUpdatesEnabled) {
      setState((current) => ({
        phase: "error",
        checkedAt: checkedAtOverride ?? current.checkedAt,
        update: updateOverride ?? current.update,
        error: `In-app updates are disabled for channel: ${policy.channel}`,
      }));
      return;
    }

    setState((current) => ({
      phase: "installing",
      checkedAt: checkedAtOverride ?? current.checkedAt,
      update: updateOverride ?? current.update,
    }));

    try {
      await invoke("install_pending_app_update");
      setState((current) => ({
        phase: "installed",
        checkedAt: current.checkedAt,
        update: current.update,
      }));
    } catch (error) {
      setState((current) => ({
        phase: "error",
        checkedAt: current.checkedAt,
        update: current.update,
        error: getErrorMessage(error),
      }));
    }
  };

  const checkForUpdates = async (options?: {
    autoInstall?: boolean;
    silentIfUpToDate?: boolean;
  }) => {
    if (!policy.inAppUpdatesEnabled) {
      setState((current) => ({
        phase: "idle",
        checkedAt: current.checkedAt,
        update: current.update,
      }));
      return;
    }

    setState((current) => ({
      phase: "checking",
      checkedAt: current.checkedAt,
      update: current.update,
    }));

    try {
      const checkedAt = new Date().toISOString();
      const update = await invoke<AppUpdateInfo | null>("check_for_app_update");

      if (!update) {
        if (options?.silentIfUpToDate) {
          setState({ phase: "upToDate", checkedAt });
        } else {
          setState({ phase: "upToDate", checkedAt });
        }
        return;
      }

      if (options?.autoInstall) {
        await installUpdate(checkedAt, update);
        return;
      }

      setState({
        phase: "available",
        checkedAt,
        update,
      });
    } catch (error) {
      setState((current) => ({
        phase: "error",
        checkedAt: current.checkedAt,
        update: current.update,
        error: getErrorMessage(error),
      }));
    }
  };

  const runAutoUpdate = useEffectEvent(() => {
    void checkForUpdates({ autoInstall: true, silentIfUpToDate: true });
  });

  useEffect(() => {
    if (
      import.meta.env.DEV ||
      !autoUpdate ||
      autoStartedRef.current ||
      !policy.inAppUpdatesEnabled
    ) {
      return;
    }

    autoStartedRef.current = true;
    runAutoUpdate();
  }, [autoUpdate, policy.inAppUpdatesEnabled]);

  useEffect(() => {
    let cancelled = false;

    const loadPolicy = async () => {
      try {
        const next = await invoke<AppUpdatePolicy>("get_app_update_policy");
        if (!cancelled) {
          setPolicy(next);
        }
      } catch {
        if (!cancelled) {
          setPolicy({
            channel: "github",
            inAppUpdatesEnabled: true,
          });
        }
      }
    };

    void loadPolicy();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    state,
    policy,
    checkForUpdates,
    installUpdate: () => installUpdate(),
  };
}
