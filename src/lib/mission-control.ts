import type {
  MissionPrefs,
  MissionQueueItem,
  MissionRun,
  ProviderAccount,
  ProviderHealthCard,
  ProviderId,
  PulseSignal,
  PulseStream,
  ReplaySlice,
} from "@/types";

export const DEFAULT_MISSION_PREFS: MissionPrefs = {
  autoRefreshStale: true,
  autoRefreshCritical: true,
  replayWindowHours: 24,
};

export function readMissionPrefs(raw: string | null): MissionPrefs {
  if (!raw) {
    return DEFAULT_MISSION_PREFS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<MissionPrefs>;
    return {
      autoRefreshStale:
        typeof parsed.autoRefreshStale === "boolean"
          ? parsed.autoRefreshStale
          : DEFAULT_MISSION_PREFS.autoRefreshStale,
      autoRefreshCritical:
        typeof parsed.autoRefreshCritical === "boolean"
          ? parsed.autoRefreshCritical
          : DEFAULT_MISSION_PREFS.autoRefreshCritical,
      replayWindowHours: clampReplayWindow(parsed.replayWindowHours),
    };
  } catch {
    return DEFAULT_MISSION_PREFS;
  }
}

export function readMissionRuns(raw: string | null): MissionRun[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => sanitizeRun(entry))
      .filter((entry): entry is MissionRun => entry !== null)
      .slice(-160);
  } catch {
    return [];
  }
}

export function buildMissionQueue(
  accounts: ProviderAccount[],
  signals: PulseSignal[]
): MissionQueueItem[] {
  const queue: MissionQueueItem[] = [];

  for (const signal of signals) {
    if (signal.kind === "sync") {
      queue.push({
        id: `${signal.id}:refresh`,
        providerId: signal.providerId,
        accountId: signal.accountId,
        title: "Refresh stale snapshot",
        detail: `${signal.accountLabel} is outside the freshness window and should be refreshed now.`,
        priority: signal.level === "critical" ? "high" : "medium",
        kind: "refresh",
      });
      continue;
    }

    if (signal.kind === "session") {
      queue.push({
        id: `${signal.id}:repair`,
        providerId: signal.providerId,
        accountId: signal.accountId,
        title:
          signal.providerId === "cursor"
            ? "Repair unstable session"
            : "Review degraded session",
        detail:
          signal.providerId === "cursor"
            ? `${signal.accountLabel} has a degraded session and may stop yielding trustworthy quota data.`
            : `${signal.accountLabel} has a degraded session and should be reviewed manually in the provider workspace.`,
        priority: signal.level === "critical" ? "high" : "medium",
        kind: signal.providerId === "cursor" ? "repair" : "review",
      });
      continue;
    }

    if (signal.kind === "quota" && signal.remainingPercent != null && signal.remainingPercent <= 15) {
      queue.push({
        id: `${signal.id}:review`,
        providerId: signal.providerId,
        accountId: signal.accountId,
        title: "Review low-quota fallback",
        detail: `${signal.accountLabel} is at ${Math.round(signal.remainingPercent)}% remaining. Prepare another account or provider lane.`,
        priority: "high",
        kind: "review",
      });
    }
  }

  for (const account of accounts) {
    if (account.authStatus === "error") {
      queue.push({
        id: `${account.accountId}:reconnect`,
        providerId: account.providerId,
        accountId: account.accountId,
        title: "Reconnect failed account",
        detail: `${account.alias ?? account.email ?? account.providerId} is currently failing authentication.`,
        priority: "high",
        kind: "review",
      });
    }
  }

  return dedupeQueue(queue).sort((left, right) => queueWeight(right.priority) - queueWeight(left.priority));
}

export function buildProviderHealthCards(
  providerIds: ProviderId[],
  briefs: Record<ProviderId, { connectedCount: number; signalCount: number; weakestRemainingPercent: number | null; trend: PulseStream["trend"] }>,
  accounts: ProviderAccount[]
): ProviderHealthCard[] {
  return providerIds.map((providerId) => {
    const brief = briefs[providerId] ?? {
      connectedCount: 0,
      signalCount: 0,
      weakestRemainingPercent: null,
      trend: "unknown" as const,
    };
    const providerAccounts = accounts.filter((account) => account.providerId === providerId);
    const connectedCount = providerAccounts.filter((account) => account.authStatus === "connected").length;
    const errorCount = providerAccounts.filter((account) => account.authStatus === "error").length;
    const score = clampScore(
      100 -
        brief.signalCount * 8 -
        errorCount * 15 -
        (brief.weakestRemainingPercent != null ? Math.max(0, 40 - brief.weakestRemainingPercent) * 0.8 : 12) +
        connectedCount * 4
    );

    return {
      providerId,
      score,
      label: healthLabel(score),
      trend: brief.trend,
      connectedCount: brief.connectedCount,
      signalCount: brief.signalCount,
      weakestRemainingPercent: brief.weakestRemainingPercent,
    };
  }).sort((left, right) => right.score - left.score);
}

export function buildReplaySlices(
  providerIds: ProviderId[],
  streams: PulseStream[],
  replayWindowHours: number
): ReplaySlice[] {
  const threshold = Date.now() - replayWindowHours * 60 * 60 * 1000;

  return providerIds.map((providerId) => {
    const providerStreams = streams.filter((stream) => stream.providerId === providerId);
    const points = providerStreams.flatMap((stream) =>
      stream.points.filter((point) => Date.parse(point.recordedAt) >= threshold)
    );
    const percents = points
      .map((point) => point.remainingPercent)
      .filter((value): value is number => typeof value === "number");

    return {
      providerId,
      trend: summarizeReplayTrend(providerStreams.map((stream) => stream.trend)),
      sampleCount: points.length,
      averageRemainingPercent:
        percents.length > 0
          ? percents.reduce((sum, value) => sum + value, 0) / percents.length
          : null,
      weakestRemainingPercent: percents.length > 0 ? Math.min(...percents) : null,
    };
  }).sort((left, right) => (right.averageRemainingPercent ?? -1) - (left.averageRemainingPercent ?? -1));
}

function sanitizeRun(input: unknown): MissionRun | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const run = input as Partial<MissionRun>;
  if (
    typeof run.id !== "string" ||
    typeof run.providerId !== "string" ||
    typeof run.kind !== "string" ||
    typeof run.status !== "string" ||
    typeof run.title !== "string" ||
    typeof run.detail !== "string" ||
    typeof run.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: run.id,
    providerId: run.providerId,
    accountId: typeof run.accountId === "string" ? run.accountId : undefined,
    kind: run.kind,
    status: run.status,
    title: run.title,
    detail: run.detail,
    createdAt: run.createdAt,
  } as MissionRun;
}

function healthLabel(score: number): ProviderHealthCard["label"] {
  if (score >= 86) {
    return "excellent";
  }
  if (score >= 68) {
    return "steady";
  }
  if (score >= 45) {
    return "strained";
  }
  return "fragile";
}

function summarizeReplayTrend(trends: PulseStream["trend"][]): ReplaySlice["trend"] {
  if (trends.includes("falling")) {
    return "falling";
  }
  if (trends.includes("rising")) {
    return "rising";
  }
  if (trends.includes("steady")) {
    return "steady";
  }
  return "unknown";
}

function clampReplayWindow(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_MISSION_PREFS.replayWindowHours;
  }
  return Math.min(168, Math.max(6, Math.round(value)));
}

function queueWeight(priority: MissionQueueItem["priority"]): number {
  switch (priority) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "normal":
    default:
      return 1;
  }
}

function clampScore(score: number): number {
  return Math.round(Math.min(100, Math.max(0, score)));
}

function dedupeQueue(items: MissionQueueItem[]): MissionQueueItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.providerId}:${item.accountId ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
