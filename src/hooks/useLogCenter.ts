import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getProviderReportedTokenTotal } from "@/lib/workspace-analytics";
import type { ProviderId } from "@/types";

export type RequestDataSource =
  | "gateway_observed"
  | "provider_reported"
  | "provider_reported_summary"
  | "local_inferred";
export type RequestDataConfidence = "high" | "medium" | "low";
export type RequestTrackingCoverage = "none" | "partial" | "full" | "mixed";
export type RequestTrackingStatusLevel = "ready" | "limited" | "unavailable";

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  providerId: ProviderId;
  model: string;
  status: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  sourceLabel?: string;
  sourceType: RequestDataSource;
  coverage: RequestTrackingCoverage;
  confidence: RequestDataConfidence;
}

export interface AppLogEntry {
  id: string;
  timestamp: string;
  scope: string;
  message: string;
}

interface RequestSummary {
  totalRequests: number;
  successRate: number;
  totalTokens: number;
  averageDurationMs: number;
}

export interface ProviderReportedProviderSummary {
  providerId: ProviderId;
  totalRequests: number;
  totalTokens: number;
  metrics: ProviderReportedMetric[];
}

export interface ProviderReportedMetric {
  id: string;
  label: string;
  value: number;
  limit?: number;
  unit: string;
}

export interface ProviderReportedSummary {
  totalRequests: number;
  totalTokens: number;
  providerIds: ProviderId[];
  byProvider: ProviderReportedProviderSummary[];
  coverage: RequestTrackingCoverage;
}

export interface RequestTrackingSource {
  sourceType: RequestDataSource;
  label: string;
  providerIds: string[];
  coverage: RequestTrackingCoverage;
  status: "ready" | "unavailable";
  detail: string;
}

export interface RequestTrackingStatus {
  primarySourceType?: RequestDataSource;
  primarySourceLabel?: string;
  overallCoverage: RequestTrackingCoverage;
  overallStatus: RequestTrackingStatusLevel;
  sources: RequestTrackingSource[];
}

const APP_LOG_LINE =
  /^\[(?<timestamp>[^\]]+)\]\s+\[(?<scope>[^\]]+)\]\s+(?<message>.+)$/;

function parseAppLogs(raw: string): AppLogEntry[] {
  return raw
    .split(/\r?\n/)
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return null;
      }
      const match = trimmed.match(APP_LOG_LINE);
      if (!match?.groups) {
        return {
          id: `app-log-${index}`,
          timestamp: "",
          scope: "app",
          message: trimmed,
        } satisfies AppLogEntry;
      }
      return {
        id: `app-log-${index}`,
        timestamp: match.groups.timestamp ?? "",
        scope: match.groups.scope ?? "app",
        message: match.groups.message ?? trimmed,
      } satisfies AppLogEntry;
    })
    .filter((entry): entry is AppLogEntry => entry !== null)
    .reverse();
}

function summarizeRequests(
  entries: RequestLogEntry[],
  providerReportedSummary: ProviderReportedSummary
): RequestSummary {
  const observedProviders = new Set(entries.map((entry) => entry.providerId));
  const providerReportedFallback = providerReportedSummary.byProvider.filter(
    (provider) => !observedProviders.has(provider.providerId)
  );

  const providerReportedRequestFallback = providerReportedFallback.reduce(
    (sum, provider) => sum + provider.totalRequests,
    0
  );
  const providerReportedTokenFallback = providerReportedFallback.reduce(
    (sum, provider) => sum + getProviderReportedTokenTotal(provider, entries),
    0
  );

  if (entries.length === 0) {
    return {
      totalRequests: providerReportedRequestFallback,
      successRate: 0,
      totalTokens: providerReportedTokenFallback,
      averageDurationMs: 0,
    };
  }

  const successCount = entries.filter((entry) => entry.status >= 200 && entry.status < 300).length;
  const totalTokens = entries.reduce(
    (sum, entry) => sum + entry.inputTokens + entry.outputTokens,
    0
  );
  const averageDurationMs =
    entries.reduce((sum, entry) => sum + entry.durationMs, 0) / entries.length;

  return {
    totalRequests: entries.length + providerReportedRequestFallback,
    successRate: (successCount / entries.length) * 100,
    totalTokens: totalTokens + providerReportedTokenFallback,
    averageDurationMs,
  };
}

export function useLogCenter() {
  const [requestLogs, setRequestLogs] = useState<RequestLogEntry[]>([]);
  const [rawAppLog, setRawAppLog] = useState("");
  const [appLogPath, setAppLogPath] = useState("");
  const [providerReportedSummary, setProviderReportedSummary] =
    useState<ProviderReportedSummary>({
      totalRequests: 0,
      totalTokens: 0,
      providerIds: [],
      byProvider: [],
      coverage: "none",
    });
  const [trackingStatus, setTrackingStatus] = useState<RequestTrackingStatus>({
    overallCoverage: "none",
    overallStatus: "unavailable",
    sources: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const loadingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setIsLoading(true);
    setError("");
    try {
      const [logs, log, path, nextTrackingStatus, nextProviderReportedSummary] = await Promise.all([
        invoke<RequestLogEntry[]>("get_request_logs", { days: 30 }),
        invoke<string>("get_debug_log"),
        invoke<string>("get_debug_log_path"),
        invoke<RequestTrackingStatus>("get_request_tracking_status"),
        invoke<ProviderReportedSummary>("get_provider_reported_summary"),
      ]);
      setRequestLogs(logs);
      setRawAppLog(log);
      setAppLogPath(path);
      setTrackingStatus(nextTrackingStatus);
      setProviderReportedSummary(nextProviderReportedSummary);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(async () => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setIsLoading(true);
    setError("");
    try {
      await invoke("clear_debug_log");
      setRawAppLog("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const appLogs = useMemo(() => parseAppLogs(rawAppLog), [rawAppLog]);
  const requestSummary = useMemo(
    () => summarizeRequests(requestLogs, providerReportedSummary),
    [requestLogs, providerReportedSummary]
  );

  return {
    requestLogs,
    requestSummary,
    providerReportedSummary,
    trackingStatus,
    appLogs,
    appLogPath,
    isLoading,
    error,
    refresh,
    clear,
  };
}
