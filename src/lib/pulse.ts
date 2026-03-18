import {
  getAccountUsageWindows,
  getHeadlineUsageWindow,
  getQuotaRemainingPercent,
  getQuotaUsedPercent,
} from "@/lib/monitoring";
import type {
  LaunchTrackItem,
  ProviderAccount,
  ProviderId,
  PulsePolicy,
  PulseProviderBrief,
  PulseSample,
  PulseSignal,
  PulseSignalLevel,
  PulseStream,
  PulseTrend,
} from "@/types";

type PulseArchiveRecord = {
  version: 1;
  streams: Record<string, PulseSample[]>;
};

const LAUNCH_TRACK: Array<{
  providerId: ProviderId;
  tier: "P0" | "P1" | "P2";
  rationale: string;
}> = [
  { providerId: "codex", tier: "P0", rationale: "Quotio parity core: OpenAI coding plans with multi-window usage tracking." },
  { providerId: "claude", tier: "P0", rationale: "Quotio parity core: Claude coding windows and CLI-linked account visibility." },
  { providerId: "qwen", tier: "P1", rationale: "Quotio-aligned OAuth account lane without synthetic quota windows." },
  { providerId: "cursor", tier: "P0", rationale: "Quotio parity core: IDE quota monitoring through local session detection." },
  { providerId: "trae", tier: "P1", rationale: "Quotio parity extension: monitor-only IDE quota tracking through local Trae session detection." },
  { providerId: "copilot", tier: "P0", rationale: "Quotio parity core: GitHub identity quota monitoring via device flow." },
  { providerId: "gemini", tier: "P0", rationale: "Quotio parity core: Gemini CLI and Google-side quota surfaces." },
  { providerId: "antigravity", tier: "P1", rationale: "Quotio-aligned expansion provider with OAuth-based usage visibility." },
  { providerId: "kiro", tier: "P1", rationale: "Quotio-aligned provider worth supporting after the main coding plan set is stable." },
  { providerId: "vertexai", tier: "P1", rationale: "Quotio-aligned cloud quota lane for project-scoped usage." },
  { providerId: "warp", tier: "P2", rationale: "Quota-monitoring-only provider that can follow once the core set is solid." },
];

export const DEFAULT_PULSE_POLICY: PulsePolicy = {
  warningPercent: 35,
  criticalPercent: 15,
  staleMinutes: 180,
  maxPointsPerStream: 48,
};

export function readPulseArchive(raw: string | null): PulseArchiveRecord {
  if (!raw) {
    return { version: 1, streams: {} };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PulseArchiveRecord>;
    if (parsed.version !== 1 || typeof parsed.streams !== "object" || parsed.streams == null) {
      return { version: 1, streams: {} };
    }

    const streams = Object.fromEntries(
      Object.entries(parsed.streams).map(([key, points]) => [
        key,
        Array.isArray(points)
          ? points
              .map((point) => sanitizeSample(point))
              .filter((point): point is PulseSample => point !== null)
          : [],
      ])
    );

    return { version: 1, streams };
  } catch {
    return { version: 1, streams: {} };
  }
}

export function readPulsePolicy(raw: string | null): PulsePolicy {
  if (!raw) {
    return DEFAULT_PULSE_POLICY;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PulsePolicy>;
    const base = {
      warningPercent: clampNumber(parsed.warningPercent, 5, 95, DEFAULT_PULSE_POLICY.warningPercent),
      criticalPercent: clampNumber(parsed.criticalPercent, 1, 90, DEFAULT_PULSE_POLICY.criticalPercent),
      staleMinutes: clampNumber(parsed.staleMinutes, 15, 24 * 60, DEFAULT_PULSE_POLICY.staleMinutes),
      maxPointsPerStream: clampNumber(
        parsed.maxPointsPerStream,
        12,
        240,
        DEFAULT_PULSE_POLICY.maxPointsPerStream
      ),
    };

    const criticalPercent = Math.min(base.criticalPercent, base.warningPercent - 5);
    const warningPercent = Math.max(base.warningPercent, criticalPercent + 5);

    return {
      ...base,
      warningPercent,
      criticalPercent,
    };
  } catch {
    return DEFAULT_PULSE_POLICY;
  }
}

export function evolvePulseArchive(
  current: PulseArchiveRecord,
  accounts: ProviderAccount[],
  policy: PulsePolicy
): PulseArchiveRecord {
  const nextStreams = { ...current.streams };

  for (const account of accounts) {
    if (account.authStatus !== "connected") {
      continue;
    }

    for (const window of getAccountUsageWindows(account)) {
      const streamId = toStreamId(account.accountId, window.id);
      const nextPoint: PulseSample = {
        recordedAt: account.lastFetchedAt ?? new Date().toISOString(),
        remainingPercent: getQuotaRemainingPercent(window.quota),
        usedPercent: getQuotaUsedPercent(window.quota),
        valueLabel: window.quota.valueLabel,
      };

      nextStreams[streamId] = pushPulseSample(
        nextStreams[streamId] ?? [],
        nextPoint,
        policy.maxPointsPerStream
      );
    }
  }

  return {
    version: 1,
    streams: nextStreams,
  };
}

export function buildPulseStreams(
  archive: PulseArchiveRecord,
  accounts: ProviderAccount[]
): PulseStream[] {
  const streams: PulseStream[] = [];

  for (const account of accounts) {
    for (const window of getAccountUsageWindows(account)) {
      const streamId = toStreamId(account.accountId, window.id);
      const points = archive.streams[streamId] ?? [];
      const recentPoints = points.slice(-24);
      streams.push({
        streamId,
        accountId: account.accountId,
        providerId: account.providerId,
        accountLabel: getAccountLabel(account),
        quotaName: window.label,
        points: recentPoints,
        trend: evaluateTrend(recentPoints),
        currentRemainingPercent: getQuotaRemainingPercent(window.quota),
        currentUsedPercent: getQuotaUsedPercent(window.quota),
        currentValueLabel: window.quota.valueLabel,
        lastSeenAt: recentPoints[recentPoints.length - 1]?.recordedAt ?? account.lastFetchedAt,
      });
    }
  }

  return streams.sort((left, right) => {
    const leftRemaining = left.currentRemainingPercent ?? 101;
    const rightRemaining = right.currentRemainingPercent ?? 101;
    return leftRemaining - rightRemaining;
  });
}

export function buildPulseSignals(
  accounts: ProviderAccount[],
  streams: PulseStream[],
  policy: PulsePolicy
): PulseSignal[] {
  const byStream = new Map(streams.map((stream) => [stream.streamId, stream]));
  const signals: PulseSignal[] = [];

  for (const account of accounts) {
    const accountLabel = getAccountLabel(account);
    const observedAt = account.lastFetchedAt ?? new Date().toISOString();

    if (account.authStatus === "error") {
      signals.push({
        id: `${account.accountId}:auth-error`,
        level: "critical",
        kind: "auth",
        providerId: account.providerId,
        accountId: account.accountId,
        accountLabel,
        title: "Authentication failed",
        detail: account.error ?? "The provider returned an authentication or fetch error.",
        observedAt,
        trend: "unknown",
      });
    }

    if (account.authStatus === "connected") {
      const ageMinutes = getAgeMinutes(account.lastFetchedAt);
      if (ageMinutes != null && ageMinutes >= policy.staleMinutes) {
        signals.push({
          id: `${account.accountId}:stale-sync`,
          level: "warning",
          kind: "sync",
          providerId: account.providerId,
          accountId: account.accountId,
          accountLabel,
          title: "Sync freshness degraded",
          detail: `Latest snapshot is ${Math.round(ageMinutes)} minutes old, beyond the ${policy.staleMinutes} minute freshness window.`,
          observedAt,
          trend: "unknown",
        });
      }
    }

    if (account.sessionHealth === "expired" || account.sessionHealth === "invalid") {
      signals.push({
        id: `${account.accountId}:session-critical`,
        level: "critical",
        kind: "session",
        providerId: account.providerId,
        accountId: account.accountId,
        accountLabel,
        title: "Session requires repair",
        detail: account.sessionHealthReason ?? "The current session is no longer valid for monitoring.",
        observedAt,
        trend: "unknown",
      });
    } else if (account.sessionHealth === "stale") {
      signals.push({
        id: `${account.accountId}:session-warning`,
        level: "warning",
        kind: "session",
        providerId: account.providerId,
        accountId: account.accountId,
        accountLabel,
        title: "Session may drift soon",
        detail: account.sessionHealthReason ?? "The current session is stale and should be refreshed soon.",
        observedAt,
        trend: "unknown",
      });
    }

    for (const window of getAccountUsageWindows(account)) {
      const remaining = getQuotaRemainingPercent(window.quota);
      if (remaining == null) {
        continue;
      }

      let level: PulseSignalLevel | null = null;
      if (remaining <= policy.criticalPercent) {
        level = "critical";
      } else if (remaining <= policy.warningPercent) {
        level = "warning";
      }

      if (!level) {
        continue;
      }

      const stream = byStream.get(toStreamId(account.accountId, window.id));
      signals.push({
        id: `${account.accountId}:${window.id}:${level}`,
        level,
        kind: "quota",
        providerId: account.providerId,
        accountId: account.accountId,
        accountLabel,
        title: `${window.label} is running low`,
        detail: `${Math.round(remaining)}% remains for ${window.label}. TokenFlow has flagged it against the current ${level} threshold.`,
        observedAt: window.quota.resetsAt ?? observedAt,
        quotaName: window.label,
        remainingPercent: remaining,
        trend: stream?.trend ?? "unknown",
      });
    }
  }

  return signals.sort((left, right) => compareSignals(left, right));
}

export function buildProviderPulseBriefs(
  accounts: ProviderAccount[],
  streams: PulseStream[],
  signals: PulseSignal[]
): PulseProviderBrief[] {
  return collectProviderIds(accounts, streams).map((providerId) => {
    const providerAccounts = accounts.filter((account) => account.providerId === providerId);
    const providerSignals = signals.filter((signal) => signal.providerId === providerId);
    const providerStreams = streams.filter((stream) => stream.providerId === providerId);

    return {
      providerId,
      connectedCount: providerAccounts.filter((account) => account.authStatus === "connected").length,
      signalCount: providerSignals.length,
      warningCount: providerSignals.filter((signal) => signal.level === "warning").length,
      criticalCount: providerSignals.filter((signal) => signal.level === "critical").length,
      weakestRemainingPercent:
        providerStreams.reduce<number | null>((lowest, stream) => {
          if (stream.currentRemainingPercent == null) {
            return lowest;
          }
          if (lowest == null) {
            return stream.currentRemainingPercent;
          }
          return Math.min(lowest, stream.currentRemainingPercent);
        }, null),
      trend: summarizeTrend(providerStreams.map((stream) => stream.trend)),
    };
  });
}

export function buildLaunchTrack(
  accounts: ProviderAccount[],
  signals: PulseSignal[]
): LaunchTrackItem[] {
  return LAUNCH_TRACK.map((item) => ({
    providerId: item.providerId,
    tier: item.tier,
    rationale: item.rationale,
    connected: accounts.some(
      (account) => account.providerId === item.providerId && account.authStatus === "connected"
    ),
    signalCount: signals.filter((signal) => signal.providerId === item.providerId).length,
  }));
}

export function getStreamForHeadlineWindow(
  account: ProviderAccount,
  streams: PulseStream[]
): PulseStream | null {
  const headline = getHeadlineUsageWindow(account);
  if (!headline) {
    return null;
  }

  return (
    streams.find((stream) => stream.streamId === toStreamId(account.accountId, headline.id)) ??
    null
  );
}

export function getStreamForHeadlineQuota(
  account: ProviderAccount,
  streams: PulseStream[]
): PulseStream | null {
  return getStreamForHeadlineWindow(account, streams);
}

function sanitizeSample(value: unknown): PulseSample | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const sample = value as Partial<PulseSample>;
  if (typeof sample.recordedAt !== "string") {
    return null;
  }

  return {
    recordedAt: sample.recordedAt,
    remainingPercent:
      typeof sample.remainingPercent === "number" ? clampPercent(sample.remainingPercent) : null,
    usedPercent: typeof sample.usedPercent === "number" ? clampPercent(sample.usedPercent) : null,
    valueLabel: typeof sample.valueLabel === "string" ? sample.valueLabel : undefined,
  };
}

function pushPulseSample(
  existing: PulseSample[],
  nextPoint: PulseSample,
  maxPointsPerStream: number
): PulseSample[] {
  const previous = existing[existing.length - 1];
  if (
    previous &&
    previous.recordedAt === nextPoint.recordedAt &&
    previous.remainingPercent === nextPoint.remainingPercent &&
    previous.usedPercent === nextPoint.usedPercent &&
    previous.valueLabel === nextPoint.valueLabel
  ) {
    return existing;
  }

  if (
    previous &&
    previous.remainingPercent === nextPoint.remainingPercent &&
    previous.usedPercent === nextPoint.usedPercent &&
    previous.valueLabel === nextPoint.valueLabel &&
    Math.abs(Date.parse(nextPoint.recordedAt) - Date.parse(previous.recordedAt)) < 60_000
  ) {
    return existing;
  }

  return [...existing, nextPoint].slice(-maxPointsPerStream);
}

function compareSignals(left: PulseSignal, right: PulseSignal): number {
  const levelDelta = signalWeight(right.level) - signalWeight(left.level);
  if (levelDelta !== 0) {
    return levelDelta;
  }

  const remainingDelta = (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101);
  if (remainingDelta !== 0) {
    return remainingDelta;
  }

  return Date.parse(right.observedAt) - Date.parse(left.observedAt);
}

function signalWeight(level: PulseSignalLevel): number {
  switch (level) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
    default:
      return 1;
  }
}

function collectProviderIds(accounts: ProviderAccount[], streams: PulseStream[]): ProviderId[] {
  return [...new Set([...accounts.map((account) => account.providerId), ...streams.map((stream) => stream.providerId)])];
}

function evaluateTrend(points: PulseSample[]): PulseTrend {
  if (points.length < 3) {
    return "unknown";
  }

  const values = points
    .map((point) => point.remainingPercent)
    .filter((value): value is number => typeof value === "number");

  if (values.length < 3) {
    return "unknown";
  }

  const recent = average(values.slice(-3));
  const earlier = average(values.slice(0, Math.min(3, values.length)));
  const delta = recent - earlier;

  if (delta >= 4) {
    return "rising";
  }
  if (delta <= -4) {
    return "falling";
  }
  return "steady";
}

function summarizeTrend(trends: PulseTrend[]): PulseTrend {
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

function getAgeMinutes(timestamp?: string): number | null {
  if (!timestamp) {
    return null;
  }

  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) {
    return null;
  }

  return (Date.now() - value) / 60_000;
}

function toStreamId(accountId: string, windowId: string): string {
  return `${accountId}::${windowId}`;
}

function getAccountLabel(account: ProviderAccount): string {
  return account.alias ?? account.email ?? account.username ?? account.providerId;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
