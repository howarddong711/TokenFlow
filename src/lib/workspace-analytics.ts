import { subDays, format } from "./workspace-date";
import type {
  ProviderReportedProviderSummary,
  ProviderReportedSummary,
  RequestLogEntry,
} from "@/hooks/useLogCenter";
import type { ProviderAccount, ProviderId } from "@/types";
import {
  getAccountUsageWindows,
  getConnectedAccounts,
} from "@/lib/monitoring";
import { PROVIDERS } from "@/types";

export interface DashboardBarSegment {
  providerId: ProviderId;
  value: number;
  color: string;
}

export interface DashboardBarDatum {
  dateKey: string;
  label: string;
  total: number;
  segments: DashboardBarSegment[];
}

export interface ProviderWorkspaceGroup {
  providerId: ProviderId;
  accounts: ProviderAccount[];
  totalWindows: number;
}

export interface AccountActivitySummary {
  state: "tracked" | "empty" | "unattributed";
  totalTokens: number | null;
  totalRequests: number | null;
  lastRequestAt?: string;
}

export interface ProviderReportedHistorySnapshot {
  totalRequests: number;
  totalTokens: number;
}

export type ProviderReportedHistory = Record<
  string,
  Partial<Record<ProviderId, ProviderReportedHistorySnapshot>>
>;

const PROVIDER_REPORTED_HISTORY_KEY = "tokenflow-provider-reported-history-v1";
const OPENAI_BASELINE_PROVIDER_ID: ProviderId = "codex";
const DEFAULT_OPENAI_TOKENS_PER_REQUEST = 8000;

export function buildProviderWorkspaceGroups(
  accounts: ProviderAccount[]
): ProviderWorkspaceGroup[] {
  const connected = getConnectedAccounts(accounts);
  return Object.values(PROVIDERS)
    .map((provider) => {
      const providerAccounts = connected.filter((account) => account.providerId === provider.id);
      return {
        providerId: provider.id,
        accounts: providerAccounts,
        totalWindows: providerAccounts.reduce(
          (sum, account) => sum + getAccountUsageWindows(account).length,
          0
        ),
      };
    })
    .filter((group) => group.accounts.length > 0);
}

export function buildMonthlyTokenBars(
  requestLogs: RequestLogEntry[],
  providerColors: Record<ProviderId, string>,
  days = 30,
  providerReportedHistory?: ProviderReportedHistory
): DashboardBarDatum[] {
  const bars = buildMonthlyBars(
    requestLogs,
    providerColors,
    days,
    (entry) => entry.inputTokens + entry.outputTokens
  );

  if (!providerReportedHistory) {
    return bars;
  }

  const estimatedTokensPerRequest = getOpenAiBaselineTokensPerRequest(requestLogs);
  return mergeProviderReportedHistoryIntoBars(
    bars,
    requestLogs,
    providerColors,
    providerReportedHistory,
    (snapshot) =>
      snapshot.totalTokens > 0
        ? snapshot.totalTokens
        : snapshot.totalRequests * estimatedTokensPerRequest
  );
}

export function buildMonthlyRequestBars(
  requestLogs: RequestLogEntry[],
  providerColors: Record<ProviderId, string>,
  days = 30,
  providerReportedHistory?: ProviderReportedHistory
): DashboardBarDatum[] {
  const bars = buildMonthlyBars(
    requestLogs,
    providerColors,
    days,
    () => 1
  );

  if (!providerReportedHistory) {
    return bars;
  }

  return mergeProviderReportedHistoryIntoBars(
    bars,
    requestLogs,
    providerColors,
    providerReportedHistory,
    (snapshot) => snapshot.totalRequests
  );
}

function buildMonthlyBars(
  requestLogs: RequestLogEntry[],
  providerColors: Record<ProviderId, string>,
  days: number,
  getValue: (entry: RequestLogEntry) => number
): DashboardBarDatum[] {
  const end = new Date();
  const start = subDays(end, days - 1);
  const buckets = new Map<string, Map<ProviderId, number>>();

  for (let offset = 0; offset < days; offset += 1) {
    const day = subDays(end, days - 1 - offset);
    const key = format(day, "yyyy-MM-dd");
    buckets.set(key, new Map());
  }

  for (const entry of requestLogs) {
    const parsed = new Date(entry.timestamp);
    if (Number.isNaN(parsed.getTime()) || parsed < start || parsed > end) {
      continue;
    }
    const key = format(parsed, "yyyy-MM-dd");
    const providerBucket = buckets.get(key);
    if (!providerBucket) {
      continue;
    }
    providerBucket.set(
      entry.providerId,
      (providerBucket.get(entry.providerId) ?? 0) + getValue(entry)
    );
  }

  return [...buckets.entries()].map(([key, providerMap]) => {
    const segments = [...providerMap.entries()]
      .map(([providerId, value]) => ({
        providerId,
        value,
        color: providerColors[providerId] ?? PROVIDERS[providerId].color,
      }))
      .sort((left, right) => right.value - left.value);

    return {
      dateKey: key,
      label: key.slice(5),
      total: segments.reduce((sum, segment) => sum + segment.value, 0),
      segments,
    };
  });
}

export function buildAccountActivityMap(
  accounts: ProviderAccount[],
  requestLogs: RequestLogEntry[]
): Record<string, AccountActivitySummary> {
  const connectedAccounts = getConnectedAccounts(accounts);
  const connectedCounts = new Map<ProviderId, number>();
  const logsByProvider = new Map<ProviderId, RequestLogEntry[]>();

  for (const account of connectedAccounts) {
    connectedCounts.set(
      account.providerId,
      (connectedCounts.get(account.providerId) ?? 0) + 1
    );
  }

  for (const entry of requestLogs) {
    const current = logsByProvider.get(entry.providerId) ?? [];
    current.push(entry);
    logsByProvider.set(entry.providerId, current);
  }

  return Object.fromEntries(
    connectedAccounts.map((account) => {
      const providerLogs = logsByProvider.get(account.providerId) ?? [];
      const connectedCount = connectedCounts.get(account.providerId) ?? 0;

      if (providerLogs.length === 0) {
        return [
          account.accountId,
          {
            state: "empty",
            totalTokens: null,
            totalRequests: null,
          } satisfies AccountActivitySummary,
        ];
      }

      if (connectedCount > 1) {
        return [
          account.accountId,
          {
            state: "unattributed",
            totalTokens: null,
            totalRequests: null,
          } satisfies AccountActivitySummary,
        ];
      }

      const lastRequestAt = [...providerLogs]
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0]
        ?.timestamp;

      return [
        account.accountId,
        {
          state: "tracked",
          totalTokens: providerLogs.reduce(
            (sum, entry) => sum + entry.inputTokens + entry.outputTokens,
            0
          ),
          totalRequests: providerLogs.length,
          lastRequestAt,
        } satisfies AccountActivitySummary,
      ];
    })
  );
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return trimCompact(`${(value / 1_000_000_000).toFixed(1)}B`);
  }
  if (value >= 1_000_000) {
    return trimCompact(`${(value / 1_000_000).toFixed(1)}M`);
  }
  if (value >= 1_000) {
    return trimCompact(`${(value / 1_000).toFixed(1)}K`);
  }
  return `${Math.round(value)}`;
}

export function getOpenAiBaselineTokensPerRequest(
  requestLogs: RequestLogEntry[]
): number {
  const openAiLogs = requestLogs.filter(
    (entry) =>
      entry.providerId === OPENAI_BASELINE_PROVIDER_ID &&
      entry.inputTokens + entry.outputTokens > 0
  );
  const fallbackLogs = requestLogs.filter(
    (entry) => entry.inputTokens + entry.outputTokens > 0
  );
  const baselineLogs = openAiLogs.length > 0 ? openAiLogs : fallbackLogs;

  if (baselineLogs.length === 0) {
    return DEFAULT_OPENAI_TOKENS_PER_REQUEST;
  }

  const totalTokens = baselineLogs.reduce(
    (sum, entry) => sum + entry.inputTokens + entry.outputTokens,
    0
  );

  if (totalTokens <= 0) {
    return DEFAULT_OPENAI_TOKENS_PER_REQUEST;
  }

  return Math.max(1, Math.round(totalTokens / baselineLogs.length));
}

export function getProviderReportedTokenTotal(
  provider: Pick<ProviderReportedProviderSummary, "totalRequests" | "totalTokens">,
  requestLogs: RequestLogEntry[]
): number {
  if (provider.totalTokens > 0) {
    return provider.totalTokens;
  }

  if (provider.totalRequests <= 0) {
    return 0;
  }

  return provider.totalRequests * getOpenAiBaselineTokensPerRequest(requestLogs);
}

function trimCompact(value: string): string {
  return value.replace(".0", "");
}

function mergeProviderReportedHistoryIntoBars(
  bars: DashboardBarDatum[],
  requestLogs: RequestLogEntry[],
  providerColors: Record<ProviderId, string>,
  providerReportedHistory: ProviderReportedHistory,
  getCurrentTotal: (snapshot: ProviderReportedHistorySnapshot) => number
): DashboardBarDatum[] {
  const observedProviders = new Set(requestLogs.map((entry) => entry.providerId));
  const todayKey = format(new Date(), "yyyy-MM-dd");

  for (const providerId of Object.values(PROVIDERS).map((provider) => provider.id)) {
    if (observedProviders.has(providerId)) {
      continue;
    }

    let previousTotal: number | null = null;

    for (const bar of bars) {
      const snapshot = providerReportedHistory[bar.dateKey]?.[providerId];
      if (!snapshot) {
        continue;
      }

      const currentTotal = getCurrentTotal(snapshot);
      const delta = Math.round(
        computeHistoryDelta(currentTotal, previousTotal, bar.dateKey === todayKey)
      );
      previousTotal = currentTotal;

      if (delta <= 0) {
        continue;
      }

      bar.segments.push({
        providerId,
        value: delta,
        color: providerColors[providerId] ?? PROVIDERS[providerId].color,
      });
      bar.segments.sort((left, right) => right.value - left.value);
      bar.total += delta;
    }
  }

  return bars;
}

function computeHistoryDelta(
  currentTotal: number,
  previousTotal: number | null,
  isToday: boolean
): number {
  if (currentTotal <= 0) {
    return 0;
  }

  if (previousTotal == null) {
    return isToday ? currentTotal : 0;
  }

  return currentTotal >= previousTotal
    ? currentTotal - previousTotal
    : currentTotal;
}

export function readProviderReportedHistory(): ProviderReportedHistory {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(PROVIDER_REPORTED_HISTORY_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as ProviderReportedHistory;
  } catch {
    return {};
  }
}

export function storeProviderReportedHistory(
  summary: ProviderReportedSummary
): ProviderReportedHistory {
  const current = readProviderReportedHistory();

  if (typeof window === "undefined" || summary.byProvider.length === 0) {
    return current;
  }

  const todayKey = format(new Date(), "yyyy-MM-dd");
  const next: ProviderReportedHistory = {
    ...current,
    [todayKey]: {
      ...(current[todayKey] ?? {}),
    },
  };

  for (const provider of summary.byProvider) {
    next[todayKey][provider.providerId] = {
      totalRequests: provider.totalRequests,
      totalTokens: provider.totalTokens,
    };
  }

  const cutoff = subDays(new Date(), 45);
  for (const key of Object.keys(next)) {
    const date = new Date(`${key}T00:00:00`);
    if (Number.isNaN(date.getTime()) || date < cutoff) {
      delete next[key];
    }
  }

  window.localStorage.setItem(PROVIDER_REPORTED_HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function formatDuration(durationMs: number): string {
  if (durationMs <= 0) {
    return "0ms";
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${(durationMs / 60_000).toFixed(1)}m`;
}

export function maskIdentity(value?: string, privacyMode?: boolean): string {
  if (!value) {
    return "";
  }
  if (!privacyMode) {
    return value;
  }
  if (value.includes("@")) {
    return maskEmail(value);
  }
  if (value.length <= 2) {
    return `${value[0]}*`;
  }
  return `${value.slice(0, 1)}***${value.slice(-1)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return email;
  }
  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : "";
  return `${head}***${tail}@${domain}`;
}

export function getDisplayAccountName(account: ProviderAccount, privacyMode: boolean): string {
  const primary =
    account.alias || account.email || account.username || account.browserLabel || account.providerId;
  return maskIdentity(primary, privacyMode);
}

export function getDisplayAccountMeta(account: ProviderAccount, privacyMode: boolean): string {
  if (account.email) {
    return maskIdentity(account.email, privacyMode);
  }
  if (account.username) {
    return maskIdentity(account.username, privacyMode);
  }
  return account.browserLabel || account.sourceLabel || "Local";
}

export function getProviderConnectionCount(accounts: ProviderAccount[]): number {
  return new Set(
    getConnectedAccounts(accounts).map((account) => account.providerId)
  ).size;
}
