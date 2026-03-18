import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCommandActions,
  buildCommandDiagnostics,
  DEFAULT_COMMAND_PREFS,
  getQuietMinutesRemaining,
  isQuietMode,
  mergeSignalEvents,
  readAcknowledgements,
  readCommandEvents,
  readCommandPrefs,
} from "@/lib/command-center";
import type {
  CommandAction,
  CommandCenterPrefs,
  CommandDiagnostic,
  CommandEvent,
  CommandEventKind,
  CommandSnapshot,
  ProviderAccount,
  PulseSignal,
} from "@/types";

const PREFS_STORAGE_KEY = "tokenflow-command-prefs";
const EVENTS_STORAGE_KEY = "tokenflow-command-events";
const ACK_STORAGE_KEY = "tokenflow-command-acks";

export interface UseCommandCenterReturn extends CommandSnapshot {
  acknowledgeSignal: (signalId: string) => void;
  reopenSignal: (signalId: string) => void;
  snoozeFor: (minutes: number) => void;
  clearQuietMode: () => void;
  setDesktopNotifications: (enabled: boolean) => void;
  exportSnapshot: (format: "json" | "markdown") => void;
  requestNotificationPermission: () => Promise<NotificationPermission | "unsupported">;
  quietMinutesRemaining: number | null;
}

export function useCommandCenter(
  accounts: ProviderAccount[],
  signals: PulseSignal[]
): UseCommandCenterReturn {
  const [prefs, setPrefs] = useState<CommandCenterPrefs>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_COMMAND_PREFS;
    }
    return readCommandPrefs(window.localStorage.getItem(PREFS_STORAGE_KEY));
  });
  const [events, setEvents] = useState<CommandEvent[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    return readCommandEvents(window.localStorage.getItem(EVENTS_STORAGE_KEY));
  });
  const [acknowledged, setAcknowledged] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") {
      return {};
    }
    return readAcknowledgements(window.localStorage.getItem(ACK_STORAGE_KEY));
  });
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? window.Notification.permission
      : "unsupported"
  );

  const previousSignalsRef = useRef<PulseSignal[]>([]);
  const deliveredRef = useRef<Record<string, string>>({});
  const liveSignalIds = useMemo(() => new Set(signals.map((signal) => signal.id)), [signals]);

  useEffect(() => {
    setEvents((current) => mergeSignalEvents(current, signals, previousSignalsRef.current));
    previousSignalsRef.current = signals;
  }, [signals]);

  useEffect(() => {
    setAcknowledged((current) =>
      Object.fromEntries(Object.entries(current).filter(([signalId]) => liveSignalIds.has(signalId)))
    );
  }, [liveSignalIds]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(acknowledged));
  }, [acknowledged]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      window.Notification.permission !== "granted" ||
      !prefs.desktopNotifications ||
      isQuietMode(prefs)
    ) {
      return;
    }

    for (const signal of signals) {
      if (signal.level === "info" || acknowledged[signal.id]) {
        continue;
      }

      const fingerprint = `${signal.level}:${signal.observedAt}`;
      if (deliveredRef.current[signal.id] === fingerprint) {
        continue;
      }

      const notification = new window.Notification(signal.title, {
        body: `${signal.accountLabel} · ${signal.detail}`,
        tag: signal.id,
      });
      notification.onclick = () => window.focus();
      deliveredRef.current[signal.id] = fingerprint;
    }
  }, [acknowledged, prefs, signals]);

  const inboxSignals = useMemo(
    () => signals.filter((signal) => !acknowledged[signal.id]),
    [acknowledged, signals]
  );
  const actions = useMemo<CommandAction[]>(
    () => buildCommandActions(accounts, inboxSignals),
    [accounts, inboxSignals]
  );
  const diagnostics = useMemo<CommandDiagnostic[]>(
    () => buildCommandDiagnostics(accounts),
    [accounts]
  );

  return {
    liveSignals: signals,
    inboxSignals,
    history: [...events].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    actions,
    diagnostics,
    prefs,
    notificationsAvailable: notificationPermission !== "unsupported",
    notificationPermission,
    isQuietMode: isQuietMode(prefs),
    quietMinutesRemaining: getQuietMinutesRemaining(prefs),
    acknowledgeSignal: (signalId) => {
      const acknowledgedAt = new Date().toISOString();
      setAcknowledged((current) => ({ ...current, [signalId]: acknowledgedAt }));
      const signal = signals.find((item) => item.id === signalId);
      if (signal) {
        const kind: CommandEventKind = "acknowledged";
        setEvents((current) =>
          [
            ...current,
            {
              id: `${signal.id}:ack:${acknowledgedAt}`,
              signalId: signal.id,
              providerId: signal.providerId,
              accountId: signal.accountId,
              level: signal.level,
              kind,
              title: signal.title,
              detail: "The signal was acknowledged in the command center.",
              createdAt: acknowledgedAt,
            },
          ].slice(-120)
        );
      }
    },
    reopenSignal: (signalId) => {
      setAcknowledged((current) => {
        const next = { ...current };
        delete next[signalId];
        return next;
      });
    },
    snoozeFor: (minutes) => {
      const quietUntil = new Date(Date.now() + minutes * 60_000).toISOString();
      setPrefs((current) => ({ ...current, quietUntil }));
    },
    clearQuietMode: () => {
      setPrefs((current) => {
        const next = { ...current };
        delete next.quietUntil;
        return next;
      });
    },
    setDesktopNotifications: (enabled) => {
      setPrefs((current) => ({ ...current, desktopNotifications: enabled }));
    },
    exportSnapshot: (format) => {
      const now = new Date();
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      const filename = `tokenflow-command-${stamp}.${format === "json" ? "json" : "md"}`;
      const payload =
        format === "json"
          ? JSON.stringify(
              {
                exportedAt: now.toISOString(),
                prefs,
                inboxSignals,
                actions,
                diagnostics,
                history: events,
              },
              null,
              2
            )
          : toMarkdownExport({
              now: now.toISOString(),
              prefs,
              inboxSignals,
              actions,
              diagnostics,
              history: events,
            });

      if (typeof window === "undefined") {
        return;
      }

      const blob = new Blob([payload], {
        type: format === "json" ? "application/json" : "text/markdown",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.URL.revokeObjectURL(url);
    },
    requestNotificationPermission: async () => {
      if (typeof window === "undefined" || !("Notification" in window)) {
        setNotificationPermission("unsupported");
        return "unsupported";
      }
      const permission = await window.Notification.requestPermission();
      setNotificationPermission(permission);
      return permission;
    },
  };
}

function toMarkdownExport(input: {
  now: string;
  prefs: CommandCenterPrefs;
  inboxSignals: PulseSignal[];
  actions: CommandAction[];
  diagnostics: CommandDiagnostic[];
  history: CommandEvent[];
}): string {
  const lines = [
    "# TokenFlow Command Snapshot",
    "",
    `Exported at: ${input.now}`,
    `Desktop notifications: ${input.prefs.desktopNotifications ? "enabled" : "disabled"}`,
    `Quiet until: ${input.prefs.quietUntil ?? "not set"}`,
    "",
    "## Inbox Signals",
    ...(
      input.inboxSignals.length > 0
        ? input.inboxSignals.map(
            (signal) => `- [${signal.level}] ${signal.title} (${signal.accountLabel})`
          )
        : ["- none"]
    ),
    "",
    "## Actions",
    ...(input.actions.length > 0
      ? input.actions.map((action) => `- [${action.level}] ${action.title}`)
      : ["- none"]),
    "",
    "## Diagnostics",
    ...(input.diagnostics.length > 0
      ? input.diagnostics.map(
          (item) =>
            `- ${item.accountLabel}: ${item.sessionState}, ${item.remainingPercent != null ? `${Math.round(item.remainingPercent)}% remaining` : "no quota percent"}, ${item.nextStep}`
        )
      : ["- none"]),
    "",
    "## History",
    ...(input.history.length > 0
      ? input.history.slice(0, 20).map((event) => `- ${event.kind}: ${event.title}`)
      : ["- none"]),
  ];

  return lines.join("\n");
}
