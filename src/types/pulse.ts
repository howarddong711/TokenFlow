import type { ProviderId } from "./providers";

export type PulseTrend = "rising" | "falling" | "steady" | "unknown";

export type PulseSignalLevel = "critical" | "warning" | "info";

export type PulseSignalKind = "quota" | "session" | "sync" | "auth";

export interface PulsePolicy {
  warningPercent: number;
  criticalPercent: number;
  staleMinutes: number;
  maxPointsPerStream: number;
}

export interface PulseSample {
  recordedAt: string;
  remainingPercent: number | null;
  usedPercent: number | null;
  valueLabel?: string;
}

export interface PulseStream {
  streamId: string;
  accountId: string;
  providerId: ProviderId;
  accountLabel: string;
  quotaName: string;
  points: PulseSample[];
  trend: PulseTrend;
  currentRemainingPercent: number | null;
  currentUsedPercent: number | null;
  currentValueLabel?: string;
  lastSeenAt?: string;
}

export interface PulseSignal {
  id: string;
  level: PulseSignalLevel;
  kind: PulseSignalKind;
  providerId: ProviderId;
  accountId: string;
  accountLabel: string;
  title: string;
  detail: string;
  observedAt: string;
  quotaName?: string;
  remainingPercent?: number | null;
  trend: PulseTrend;
}

export interface PulseProviderBrief {
  providerId: ProviderId;
  connectedCount: number;
  signalCount: number;
  warningCount: number;
  criticalCount: number;
  weakestRemainingPercent: number | null;
  trend: PulseTrend;
}

export interface LaunchTrackItem {
  providerId: ProviderId;
  tier: "P0" | "P1" | "P2";
  rationale: string;
  connected: boolean;
  signalCount: number;
}
