import {
  getConnectionLabel,
  getHeadlineUsageWindow,
  getQuotaRemainingPercent,
} from "@/lib/monitoring";
import {
  findDuplicateAccountClusters,
  getAccountDisplayLabel,
} from "@/lib/account-identity";
import type {
  CommandAction,
  CommandDiagnostic,
  CommandCenterPrefs,
  CommandEvent,
  ProviderAccount,
  PulseSignal,
} from "@/types";

export const DEFAULT_COMMAND_PREFS: CommandCenterPrefs = {
  desktopNotifications: true,
};

export function readCommandPrefs(raw: string | null): CommandCenterPrefs {
  if (!raw) {
    return DEFAULT_COMMAND_PREFS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CommandCenterPrefs>;
    return {
      desktopNotifications:
        typeof parsed.desktopNotifications === "boolean"
          ? parsed.desktopNotifications
          : DEFAULT_COMMAND_PREFS.desktopNotifications,
      quietUntil: typeof parsed.quietUntil === "string" ? parsed.quietUntil : undefined,
    };
  } catch {
    return DEFAULT_COMMAND_PREFS;
  }
}

export function readCommandEvents(raw: string | null): CommandEvent[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => sanitizeEvent(item))
      .filter((item): item is CommandEvent => item !== null)
      .slice(-120);
  } catch {
    return [];
  }
}

export function readAcknowledgements(raw: string | null): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

export function mergeSignalEvents(
  currentEvents: CommandEvent[],
  signals: PulseSignal[],
  previousSignals: PulseSignal[]
): CommandEvent[] {
  const next = [...currentEvents];
  const currentMap = new Map(signals.map((signal) => [signal.id, signal]));
  const previousMap = new Map(previousSignals.map((signal) => [signal.id, signal]));
  const now = new Date().toISOString();

  for (const signal of signals) {
    if (previousMap.has(signal.id)) {
      continue;
    }
    next.push({
      id: `${signal.id}:opened:${now}`,
      signalId: signal.id,
      providerId: signal.providerId,
      accountId: signal.accountId,
      level: signal.level,
      kind: "opened",
      title: signal.title,
      detail: signal.detail,
      createdAt: now,
    });
  }

  for (const signal of previousSignals) {
    if (currentMap.has(signal.id)) {
      continue;
    }
    next.push({
      id: `${signal.id}:resolved:${now}`,
      signalId: signal.id,
      providerId: signal.providerId,
      accountId: signal.accountId,
      level: signal.level,
      kind: "resolved",
      title: signal.title,
      detail: "The underlying condition has cleared from the current monitoring snapshot.",
      createdAt: now,
    });
  }

  return next.slice(-120);
}

export function buildCommandActions(
  accounts: ProviderAccount[],
  signals: PulseSignal[]
): CommandAction[] {
  const actions: CommandAction[] = [];

  for (const signal of signals) {
    if (signal.kind === "session") {
      actions.push({
        id: `${signal.id}:repair`,
        providerId: signal.providerId,
        accountId: signal.accountId,
        kind: "repair_session",
        level: signal.level,
        title: "Repair account session",
        detail: `${signal.accountLabel} needs a session refresh before monitoring can stabilize.`,
        actionLabel: "Open provider",
      });
      continue;
    }

    if (signal.kind === "auth") {
      actions.push({
        id: `${signal.id}:reconnect`,
        providerId: signal.providerId,
        accountId: signal.accountId,
        kind: "open_provider",
        level: signal.level,
        title: "Reconnect account",
        detail: `${signal.accountLabel} returned an authentication failure and likely needs a new sign-in flow.`,
        actionLabel: "Open provider",
      });
      continue;
    }

    if (signal.kind === "sync") {
      actions.push({
        id: `${signal.id}:refresh`,
        providerId: signal.providerId,
        accountId: signal.accountId,
        kind: "refresh_account",
        level: signal.level,
        title: "Refresh stale snapshot",
        detail: `${signal.accountLabel} has not refreshed within the expected freshness window.`,
        actionLabel: "Review account",
      });
      continue;
    }
  }

  const connectedProviders = new Set(
    accounts
      .filter((account) => account.authStatus === "connected")
      .map((account) => account.providerId)
  );

  for (const providerId of ["codex", "claude", "cursor", "copilot"] as const) {
    if (connectedProviders.has(providerId)) {
      continue;
    }
    actions.push({
      id: `launch:${providerId}`,
      providerId,
      kind: "connect_provider",
      level: "normal",
      title: "Connect a core provider",
      detail: `${providerId} is still disconnected. Bringing a P0 provider online improves launch coverage and signal accuracy.`,
      actionLabel: "Connect now",
    });
  }

  return dedupeActions(actions).slice(0, 8);
}

export function buildCommandDiagnostics(accounts: ProviderAccount[]): CommandDiagnostic[] {
  const accountDiagnostics = accounts.map((account) => {
    const headline = getHeadlineUsageWindow(account);
    const remainingPercent = headline ? getQuotaRemainingPercent(headline.quota) : null;

    return {
      id: account.accountId,
      providerId: account.providerId,
      accountId: account.accountId,
      accountLabel: getAccountDisplayLabel(account),
      kind: "account",
      authPath: getConnectionLabel(account),
      sessionState: inferSessionState(account),
      remainingPercent,
      headlineWindowLabel: headline?.label,
      nextStep: buildNextStep(account, remainingPercent),
      lastSeenAt: account.lastFetchedAt,
    } satisfies CommandDiagnostic;
  });

  const duplicateDiagnostics = findDuplicateAccountClusters(accounts).map((cluster) => {
    const primary = cluster.accounts[0];
    return {
      id: `duplicate:${cluster.providerId}:${cluster.matchKind}:${cluster.value}`,
      providerId: cluster.providerId,
      accountId: primary.accountId,
      accountLabel:
        cluster.matchKind === "email" ? cluster.displayValue : "Duplicate connection source",
      kind: "duplicate",
      authPath:
        cluster.matchKind === "email"
          ? `Same email detected across ${cluster.accounts.length} monitored accounts.`
          : `Same local or browser source detected across ${cluster.accounts.length} monitored accounts.`,
      sessionState: "watch",
      remainingPercent: null,
      nextStep:
        "Review the attached accounts and remove or rename any duplicate imports so monitoring stays trustworthy.",
      lastSeenAt: latestSeenAt(cluster.accounts),
      duplicateCount: cluster.accounts.length,
      duplicateMatchKind: cluster.matchKind,
      duplicateMatchValue: cluster.displayValue,
      relatedAccounts: cluster.accounts.map(getAccountDisplayLabel),
    } satisfies CommandDiagnostic;
  });

  return [...duplicateDiagnostics, ...accountDiagnostics].sort((left, right) => {
    const sessionDelta = diagnosticScore(right) - diagnosticScore(left);
    if (sessionDelta !== 0) {
      return sessionDelta;
    }
    return (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101);
  });
}

export function isQuietMode(prefs: CommandCenterPrefs): boolean {
  if (!prefs.quietUntil) {
    return false;
  }
  const value = Date.parse(prefs.quietUntil);
  return !Number.isNaN(value) && value > Date.now();
}

export function getQuietMinutesRemaining(prefs: CommandCenterPrefs): number | null {
  if (!isQuietMode(prefs) || !prefs.quietUntil) {
    return null;
  }
  return Math.max(1, Math.round((Date.parse(prefs.quietUntil) - Date.now()) / 60_000));
}

function sanitizeEvent(input: unknown): CommandEvent | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const event = input as Partial<CommandEvent>;
  if (
    typeof event.id !== "string" ||
    typeof event.signalId !== "string" ||
    typeof event.providerId !== "string" ||
    typeof event.level !== "string" ||
    typeof event.kind !== "string" ||
    typeof event.title !== "string" ||
    typeof event.detail !== "string" ||
    typeof event.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: event.id,
    signalId: event.signalId,
    providerId: event.providerId,
    accountId: typeof event.accountId === "string" ? event.accountId : undefined,
    level: event.level,
    kind: event.kind,
    title: event.title,
    detail: event.detail,
    createdAt: event.createdAt,
  } as CommandEvent;
}

function dedupeActions(actions: CommandAction[]): CommandAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.kind}:${action.providerId}:${action.accountId ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function inferSessionState(account: ProviderAccount): CommandDiagnostic["sessionState"] {
  if (account.authStatus === "error") {
    return "error";
  }
  if (account.authStatus !== "connected") {
    return "offline";
  }
  if (account.sessionHealth === "expired" || account.sessionHealth === "invalid") {
    return "repair";
  }
  if (account.sessionHealth === "stale") {
    return "watch";
  }
  return "healthy";
}

function buildNextStep(account: ProviderAccount, remainingPercent: number | null): string {
  if (account.authStatus === "error") {
    return "Reconnect this account and validate credentials.";
  }
  if (account.authStatus !== "connected") {
    return "Bring this provider online or keep it out of the launch track.";
  }
  if (account.sessionHealth === "expired" || account.sessionHealth === "invalid") {
    return "Repair the session before trusting live quota data.";
  }
  if (account.sessionHealth === "stale") {
    return "Refresh soon to avoid monitoring drift.";
  }
  if (remainingPercent != null && remainingPercent <= 15) {
    return "Prepare a fallback account or rotate to another provider.";
  }
  if (remainingPercent != null && remainingPercent <= 35) {
    return "Keep a close eye on this quota window.";
  }
  return "No immediate action needed.";
}

function diagnosticWeight(state: CommandDiagnostic["sessionState"]): number {
  switch (state) {
    case "error":
      return 4;
    case "repair":
      return 3;
    case "watch":
      return 2;
    case "offline":
      return 1;
    case "healthy":
    default:
      return 0;
  }
}

function diagnosticScore(item: CommandDiagnostic): number {
  if (item.kind === "duplicate") {
    return 25;
  }
  return diagnosticWeight(item.sessionState) * 10;
}

function latestSeenAt(accounts: ProviderAccount[]): string | undefined {
  return accounts
    .map((account) => account.lastFetchedAt)
    .filter((value): value is string => typeof value === "string")
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}
