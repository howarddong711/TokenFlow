import { useEffect, useMemo, useState } from "react";
import {
  buildLaunchTrack,
  buildProviderPulseBriefs,
  buildPulseSignals,
  buildPulseStreams,
  DEFAULT_PULSE_POLICY,
  evolvePulseArchive,
  getStreamForHeadlineWindow,
  readPulseArchive,
  readPulsePolicy,
} from "@/lib/pulse";
import type {
  LaunchTrackItem,
  ProviderAccount,
  PulsePolicy,
  PulseProviderBrief,
  PulseSignal,
  PulseStream,
} from "@/types";

const ARCHIVE_STORAGE_KEY = "tokenflow-pulse-archive";
const POLICY_STORAGE_KEY = "tokenflow-pulse-policy";

export interface FlowPulseState {
  policy: PulsePolicy;
  setPolicy: (next: Partial<PulsePolicy>) => void;
  streams: PulseStream[];
  signals: PulseSignal[];
  providerBriefs: PulseProviderBrief[];
  launchTrack: LaunchTrackItem[];
  getHeadlineStream: (account: ProviderAccount) => PulseStream | null;
}

export function useFlowPulse(accounts: ProviderAccount[]): FlowPulseState {
  const [policy, setPolicyState] = useState<PulsePolicy>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_PULSE_POLICY;
    }
    return readPulsePolicy(window.localStorage.getItem(POLICY_STORAGE_KEY));
  });
  const [archive, setArchive] = useState(() => {
    if (typeof window === "undefined") {
      return readPulseArchive(null);
    }
    return readPulseArchive(window.localStorage.getItem(ARCHIVE_STORAGE_KEY));
  });

  useEffect(() => {
    setArchive((current) => evolvePulseArchive(current, accounts, policy));
  }, [accounts, policy]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archive));
  }, [archive]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(policy));
  }, [policy]);

  const streams = useMemo(() => buildPulseStreams(archive, accounts), [archive, accounts]);
  const signals = useMemo(() => buildPulseSignals(accounts, streams, policy), [accounts, streams, policy]);
  const providerBriefs = useMemo(
    () => buildProviderPulseBriefs(accounts, streams, signals),
    [accounts, signals, streams]
  );
  const launchTrack = useMemo(() => buildLaunchTrack(accounts, signals), [accounts, signals]);

  return {
    policy,
    setPolicy: (next) =>
      setPolicyState((current) => {
        const merged = {
          ...current,
          ...next,
        };
        const criticalPercent = Math.min(merged.criticalPercent, merged.warningPercent - 5);
        const warningPercent = Math.max(merged.warningPercent, criticalPercent + 5);
        return {
          ...merged,
          criticalPercent,
          warningPercent,
        };
      }),
    streams,
    signals,
    providerBriefs,
    launchTrack,
    getHeadlineStream: (account) => getStreamForHeadlineWindow(account, streams),
  };
}
