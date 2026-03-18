import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAccountRiskLevel } from "@/lib/monitoring";
import type { ProviderAccount } from "@/types";
import { PROVIDERS } from "@/types";

interface TrayStatus {
  inboxCount?: number;
  isQuietMode?: boolean;
}

function buildTooltipSummary(accounts: ProviderAccount[], status?: TrayStatus): string {
  const connected = accounts
    .filter((account) => account.authStatus === "connected")
    .map((account) => {
      const provider = PROVIDERS[account.providerId];
      return `* ${provider?.name ?? account.providerId}`;
    });

  const attention = accounts.filter((account) => {
    const risk = getAccountRiskLevel(account);
    return risk === "critical" || risk === "warning" || risk === "error";
  }).length;

  if (connected.length === 0) {
    return "TokenFlow\nNo providers connected";
  }

  return [
    "TokenFlow",
    ...connected,
    `${connected.length} provider(s) connected`,
    attention > 0 ? `${attention} account(s) need attention` : "All monitored accounts healthy",
    typeof status?.inboxCount === "number"
      ? `${status.inboxCount} item(s) in command inbox`
      : null,
    status?.isQuietMode ? "Quiet mode active" : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function useTray(accounts: ProviderAccount[], status?: TrayStatus, enabled = true) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested(async (event) => {
        if (enabled) {
          event.preventDefault();
          await appWindow.hide();
          return;
        }

        await invoke("quit_app");
      });
    };

    void setup();

    return () => {
      unlisten?.();
    };
  }, [enabled]);

  useEffect(() => {
    const summary = buildTooltipSummary(accounts, status);
    invoke("update_tray_tooltip", { summary }).catch(() => {
      // Ignore tray sync failures in environments where the tray is unavailable.
    });
  }, [accounts, status]);
}
