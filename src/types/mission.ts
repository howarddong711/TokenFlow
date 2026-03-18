import type { ProviderId } from "./providers";
import type { PulseTrend } from "./pulse";

export interface MissionPrefs {
  autoRefreshStale: boolean;
  autoRefreshCritical: boolean;
  replayWindowHours: number;
}

export interface MissionRun {
  id: string;
  providerId: ProviderId;
  accountId?: string;
  kind: "auto_refresh" | "batch_refresh" | "batch_repair";
  status: "completed" | "failed";
  title: string;
  detail: string;
  createdAt: string;
}

export interface MissionQueueItem {
  id: string;
  providerId: ProviderId;
  accountId?: string;
  title: string;
  detail: string;
  priority: "high" | "medium" | "normal";
  kind: "refresh" | "repair" | "review";
}

export interface ProviderHealthCard {
  providerId: ProviderId;
  score: number;
  label: "excellent" | "steady" | "strained" | "fragile";
  trend: PulseTrend;
  connectedCount: number;
  signalCount: number;
  weakestRemainingPercent: number | null;
}

export interface ReplaySlice {
  providerId: ProviderId;
  trend: PulseTrend;
  sampleCount: number;
  averageRemainingPercent: number | null;
  weakestRemainingPercent: number | null;
}

export interface MissionSnapshot {
  prefs: MissionPrefs;
  queue: MissionQueueItem[];
  healthCards: ProviderHealthCard[];
  replay: ReplaySlice[];
  runs: MissionRun[];
}
