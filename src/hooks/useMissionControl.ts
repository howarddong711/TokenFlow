import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildMissionQueue,
  buildProviderHealthCards,
  buildReplaySlices,
  DEFAULT_MISSION_PREFS,
  readMissionPrefs,
  readMissionRuns,
} from "@/lib/mission-control";
import type {
  MissionPrefs,
  MissionQueueItem,
  MissionRun,
  ProviderAccount,
  ProviderHealthCard,
  ProviderId,
  PulseProviderBrief,
  PulseSignal,
  PulseStream,
  ReplaySlice,
} from "@/types";

const PREFS_STORAGE_KEY = "tokenflow-mission-prefs";
const RUNS_STORAGE_KEY = "tokenflow-mission-runs";
const AUTO_REFRESH_STORAGE_KEY = "tokenflow-mission-auto-refresh";
const AUTO_COOLDOWN_MS = 10 * 60 * 1000;

export interface UseMissionControlReturn {
  prefs: MissionPrefs;
  queue: MissionQueueItem[];
  healthCards: ProviderHealthCard[];
  replay: ReplaySlice[];
  runs: MissionRun[];
  setPrefs: (next: Partial<MissionPrefs>) => void;
  runBatchRefresh: () => Promise<void>;
  runBatchRepair: () => Promise<void>;
  runQueueItem: (item: MissionQueueItem) => Promise<void>;
}

export function useMissionControl(args: {
  accounts: ProviderAccount[];
  signals: PulseSignal[];
  streams: PulseStream[];
  providerBriefs: PulseProviderBrief[];
  refreshAccount: (accountId: string) => Promise<void>;
  repairAccount: (accountId: string) => Promise<void>;
}) : UseMissionControlReturn {
  const { accounts, signals, streams, providerBriefs, refreshAccount, repairAccount } = args;
  const [prefs, setPrefsState] = useState<MissionPrefs>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_MISSION_PREFS;
    }
    return readMissionPrefs(window.localStorage.getItem(PREFS_STORAGE_KEY));
  });
  const [runs, setRuns] = useState<MissionRun[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    return readMissionRuns(window.localStorage.getItem(RUNS_STORAGE_KEY));
  });
  const [autoRefreshLedger, setAutoRefreshLedger] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") {
      return {};
    }
    try {
      return JSON.parse(window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) ?? "{}") as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  });

  const providerIds = useMemo(
    () => [...new Set(accounts.map((account) => account.providerId))] as ProviderId[],
    [accounts]
  );
  const queue = useMemo(() => buildMissionQueue(accounts, signals), [accounts, signals]);
  const briefMap = useMemo(
    () =>
      Object.fromEntries(
        providerBriefs.map((brief) => [
          brief.providerId,
          {
            connectedCount: brief.connectedCount,
            signalCount: brief.signalCount,
            weakestRemainingPercent: brief.weakestRemainingPercent,
            trend: brief.trend,
          },
        ])
      ) as Record<
        ProviderId,
        {
          connectedCount: number;
          signalCount: number;
          weakestRemainingPercent: number | null;
          trend: PulseStream["trend"];
        }
      >,
    [providerBriefs]
  );
  const healthCards = useMemo(
    () => buildProviderHealthCards(providerIds, briefMap, accounts),
    [accounts, briefMap, providerIds]
  );
  const replay = useMemo(
    () => buildReplaySlices(providerIds, streams, prefs.replayWindowHours),
    [prefs.replayWindowHours, providerIds, streams]
  );

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
    window.localStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(runs));
  }, [runs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, JSON.stringify(autoRefreshLedger));
  }, [autoRefreshLedger]);

  const executeRefresh = useCallback(async (
    accountId: string,
    providerId: ProviderId,
    title: string,
    automatic = false
  ) => {
    const now = new Date().toISOString();
    try {
      await refreshAccount(accountId);
      const run: MissionRun = {
        id: `${accountId}:${now}`,
        providerId,
        accountId,
        kind: automatic ? "auto_refresh" : "batch_refresh",
        status: "completed",
        title,
        detail: automatic
          ? "Mission control triggered an automatic refresh."
          : "Mission control completed a refresh run.",
        createdAt: now,
      };
      setRuns((current) => [...current, run].slice(-160));
      setAutoRefreshLedger((current) => ({ ...current, [accountId]: now }));
    } catch (error) {
      const run: MissionRun = {
        id: `${accountId}:${now}:failed`,
        providerId,
        accountId,
        kind: automatic ? "auto_refresh" : "batch_refresh",
        status: "failed",
        title,
        detail: error instanceof Error ? error.message : "Refresh failed.",
        createdAt: now,
      };
      setRuns((current) => [...current, run].slice(-160));
    }
  }, [refreshAccount]);

  const executeRepair = useCallback(async (accountId: string, providerId: ProviderId, title: string) => {
    const now = new Date().toISOString();
    try {
      await repairAccount(accountId);
      const run: MissionRun = {
        id: `${accountId}:${now}:repair`,
        providerId,
        accountId,
        kind: "batch_repair",
        status: "completed",
        title,
        detail: "Mission control completed a repair run.",
        createdAt: now,
      };
      setRuns((current) => [...current, run].slice(-160));
    } catch (error) {
      const run: MissionRun = {
        id: `${accountId}:${now}:repair:failed`,
        providerId,
        accountId,
        kind: "batch_repair",
        status: "failed",
        title,
        detail: error instanceof Error ? error.message : "Repair failed.",
        createdAt: now,
      };
      setRuns((current) => [...current, run].slice(-160));
    }
  }, [repairAccount]);

  useEffect(() => {
    const candidates = queue.filter((item) => {
      if (item.kind !== "refresh" || !item.accountId) {
        return false;
      }
      if (item.priority === "high" && prefs.autoRefreshCritical) {
        return true;
      }
      if (item.priority !== "high" && prefs.autoRefreshStale) {
        return true;
      }
      return false;
    });

    for (const item of candidates) {
      const lastRunAt = autoRefreshLedger[item.accountId!];
      if (lastRunAt && Date.now() - Date.parse(lastRunAt) < AUTO_COOLDOWN_MS) {
        continue;
      }

      void executeRefresh(item.accountId!, item.providerId, item.title, true);
    }
  }, [autoRefreshLedger, executeRefresh, prefs.autoRefreshCritical, prefs.autoRefreshStale, queue]);

  return {
    prefs,
    queue,
    healthCards,
    replay,
    runs: [...runs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    setPrefs: (next) =>
      setPrefsState((current) => ({
        ...current,
        ...next,
        replayWindowHours:
          typeof next.replayWindowHours === "number"
            ? Math.min(168, Math.max(6, Math.round(next.replayWindowHours)))
            : current.replayWindowHours,
      })),
    runBatchRefresh: async () => {
      const targets = queue.filter((item) => item.kind === "refresh" && item.accountId).slice(0, 6);
      for (const item of targets) {
        await executeRefresh(item.accountId!, item.providerId, item.title, false);
      }
    },
    runBatchRepair: async () => {
      const targets = queue.filter((item) => item.kind === "repair" && item.accountId).slice(0, 4);
      for (const item of targets) {
        await executeRepair(item.accountId!, item.providerId, item.title);
      }
    },
    runQueueItem: async (item) => {
      if (!item.accountId) {
        return;
      }
      if (item.kind === "refresh") {
        await executeRefresh(item.accountId, item.providerId, item.title, false);
      } else if (item.kind === "repair") {
        await executeRepair(item.accountId, item.providerId, item.title);
      }
    },
  };
}
