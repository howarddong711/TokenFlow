import type { ProviderId } from "./providers";
import type { PulseSignal, PulseSignalLevel } from "./pulse";
import type { DuplicateMatchKind } from "@/lib/account-identity";

export type CommandEventKind = "opened" | "resolved" | "acknowledged";

export type CommandActionKind =
  | "open_provider"
  | "repair_session"
  | "refresh_account"
  | "connect_provider";

export interface CommandCenterPrefs {
  desktopNotifications: boolean;
  quietUntil?: string;
}

export interface CommandEvent {
  id: string;
  signalId: string;
  providerId: ProviderId;
  accountId?: string;
  level: PulseSignalLevel;
  kind: CommandEventKind;
  title: string;
  detail: string;
  createdAt: string;
}

export interface CommandAction {
  id: string;
  providerId: ProviderId;
  accountId?: string;
  kind: CommandActionKind;
  level: PulseSignalLevel | "normal";
  title: string;
  detail: string;
  actionLabel: string;
}

export interface CommandDiagnostic {
  id: string;
  providerId: ProviderId;
  accountId: string;
  accountLabel: string;
  kind?: "account" | "duplicate";
  authPath: string;
  sessionState: "healthy" | "watch" | "repair" | "offline" | "error";
  remainingPercent: number | null;
  headlineWindowLabel?: string;
  nextStep: string;
  lastSeenAt?: string;
  duplicateCount?: number;
  duplicateMatchKind?: DuplicateMatchKind;
  duplicateMatchValue?: string;
  relatedAccounts?: string[];
}

export interface CommandSnapshot {
  liveSignals: PulseSignal[];
  inboxSignals: PulseSignal[];
  history: CommandEvent[];
  actions: CommandAction[];
  diagnostics: CommandDiagnostic[];
  prefs: CommandCenterPrefs;
  notificationsAvailable: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  isQuietMode: boolean;
}
