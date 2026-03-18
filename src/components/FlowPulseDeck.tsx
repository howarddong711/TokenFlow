import {
  Activity,
  Radar,
  Settings2,
  Siren,
  TrendingDown,
  TrendingUp,
  Waypoints,
} from "lucide-react";
import { PulseSparkline } from "@/components/PulseSparkline";
import { useI18n } from "@/i18n";
import { getProductCopy } from "@/i18n/productCopy";
import { formatLastFetchedAt } from "@/lib/monitoring";
import { cn } from "@/lib/utils";
import type {
  LaunchTrackItem,
  ProviderAccount,
  ProviderId,
  PulsePolicy,
  PulseProviderBrief,
  PulseSignal,
  PulseStream,
} from "@/types";
import { PROVIDERS } from "@/types";

interface FlowPulseDeckProps {
  accounts: ProviderAccount[];
  signals: PulseSignal[];
  streams: PulseStream[];
  providerBriefs: PulseProviderBrief[];
  launchTrack: LaunchTrackItem[];
  policy: PulsePolicy;
  onPolicyChange: (next: Partial<PulsePolicy>) => void;
  filterProviderId?: ProviderId;
}

export function FlowPulseDeck({
  accounts,
  signals,
  streams,
  providerBriefs,
  launchTrack,
  policy,
  onPolicyChange,
  filterProviderId,
}: FlowPulseDeckProps) {
  const { lang } = useI18n();
  const copy = getProductCopy(lang).flowPulse;
  const visibleSignals = filterProviderId
    ? signals.filter((signal) => signal.providerId === filterProviderId)
    : signals;
  const visibleStreams = filterProviderId
    ? streams.filter((stream) => stream.providerId === filterProviderId)
    : streams;
  const visibleBriefs = filterProviderId
    ? providerBriefs.filter((brief) => brief.providerId === filterProviderId)
    : providerBriefs;
  const visibleLaunchTrack = filterProviderId
    ? launchTrack.filter((item) => item.providerId === filterProviderId)
    : launchTrack;
  const connectedCount = accounts.filter(
    (account) =>
      account.authStatus === "connected" &&
      (!filterProviderId || account.providerId === filterProviderId)
  ).length;

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Siren className="size-3.5" />
                {copy.badge}
              </div>
              <h2 className="mt-3 text-lg font-semibold tracking-tight">{copy.signalStream}</h2>
              <p className="text-sm text-muted-foreground">{copy.signalStreamBody}</p>
            </div>
            <div className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
              {copy.active(visibleSignals.length)}
            </div>
          </div>

          {visibleSignals.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/70 px-4 py-5 text-sm text-emerald-800">
              {copy.noSignals}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {visibleSignals.slice(0, 6).map((signal) => {
                const meta = PROVIDERS[signal.providerId];
                return (
                  <div
                    key={signal.id}
                    className="rounded-2xl border border-border/70 bg-background/75 p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <SignalTonePill level={signal.level} />
                          <span className="text-sm font-semibold">{signal.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {meta.name} / {signal.accountLabel}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {signal.detail}
                        </p>
                      </div>
                      <div className="min-w-[160px] text-left md:text-right">
                        <p className="text-sm font-medium">
                          {signal.remainingPercent != null
                            ? copy.remaining(signal.remainingPercent)
                            : signal.kind}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatLastFetchedAt(signal.observedAt)}
                        </p>
                        <TrendBadge trend={signal.trend} className="mt-2 justify-start md:justify-end" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4" />
            <h2 className="text-lg font-semibold tracking-tight">{copy.policyStudio}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.policyStudioBody}</p>

          <div className="mt-5 flex flex-wrap gap-2">
            {getPolicyPresets(copy).map((preset) => (
              <button
                key={preset.name}
                onClick={() => onPolicyChange(preset.values)}
                className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-foreground/15 hover:text-foreground"
              >
                {preset.name}
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            <PolicySlider
              label={copy.warningThreshold}
              value={policy.warningPercent}
              min={5}
              max={95}
              suffix="%"
              onChange={(value) =>
                onPolicyChange({
                  warningPercent: Math.max(value, policy.criticalPercent + 5),
                })
              }
            />
            <PolicySlider
              label={copy.criticalThreshold}
              value={policy.criticalPercent}
              min={1}
              max={90}
              suffix="%"
              onChange={(value) =>
                onPolicyChange({
                  criticalPercent: Math.min(value, policy.warningPercent - 5),
                })
              }
            />
            <PolicySlider
              label={copy.freshnessWindow}
              value={policy.staleMinutes}
              min={15}
              max={720}
              step={15}
              suffix="m"
              onChange={(value) => onPolicyChange({ staleMinutes: value })}
            />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <CompactMetric label={copy.connected} value={String(connectedCount)} detail={copy.connectedDetail} />
            <CompactMetric label={copy.streams} value={String(visibleStreams.length)} detail={copy.streamsDetail} />
            <CompactMetric label={copy.signals} value={String(visibleSignals.length)} detail={copy.signalsDetail} />
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Radar className="size-4" />
            <h2 className="text-lg font-semibold tracking-tight">{copy.trajectoryBoard}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.trajectoryBody}</p>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {visibleStreams.slice(0, 6).map((stream) => (
              <div
                key={stream.streamId}
                className="rounded-2xl border border-border/70 bg-background/75 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {PROVIDERS[stream.providerId].name} / {stream.accountLabel}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{stream.quotaName}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">
                      {stream.currentRemainingPercent != null
                        ? `${Math.round(stream.currentRemainingPercent)}%`
                        : copy.na}
                    </p>
                    <TrendBadge trend={stream.trend} className="mt-1 justify-end" />
                  </div>
                </div>
                <PulseSparkline points={stream.points} trend={stream.trend} className="mt-4" />
                <p className="mt-2 text-xs text-muted-foreground">
                  {(stream.currentValueLabel ?? copy.progressStream) + " / " + formatLastFetchedAt(stream.lastSeenAt)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4">
          <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Waypoints className="size-4" />
              <h2 className="text-lg font-semibold tracking-tight">{copy.launchTrack}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{copy.launchTrackBody}</p>
            <div className="mt-5 space-y-3">
              {visibleLaunchTrack.map((item) => {
                const meta = PROVIDERS[item.providerId];
                return (
                  <div
                    key={item.providerId}
                    className="rounded-2xl border border-border/70 bg-background/75 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                            {item.tier}
                          </span>
                          <span className="text-sm font-semibold">{meta.name}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {item.rationale}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {item.connected ? copy.connectedState : copy.notLive}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {copy.signalCount(item.signalCount)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Activity className="size-4" />
              <h2 className="text-lg font-semibold tracking-tight">{copy.providerPulse}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{copy.providerPulseBody}</p>
            <div className="mt-5 grid gap-3">
              {visibleBriefs.map((brief) => {
                const meta = PROVIDERS[brief.providerId];
                return (
                  <div
                    key={brief.providerId}
                    className="rounded-2xl border border-border/70 bg-background/75 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{meta.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {copy.providerSummary(
                            brief.connectedCount,
                            brief.warningCount,
                            brief.criticalCount
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold">
                          {brief.weakestRemainingPercent != null
                            ? `${Math.round(brief.weakestRemainingPercent)}%`
                            : copy.na}
                        </p>
                        <TrendBadge trend={brief.trend} className="mt-1 justify-end" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function PolicySlider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-2xl border border-border/70 bg-background/75 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--primary)]"
      />
    </label>
  );
}

function CompactMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function SignalTonePill({ level }: { level: PulseSignal["level"] }) {
  const { lang } = useI18n();
  const copy = getProductCopy(lang).flowPulse;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
        level === "critical"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : level === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-sky-200 bg-sky-50 text-sky-700"
      )}
    >
      {getSignalLevelLabel(copy, level)}
    </span>
  );
}

function TrendBadge({
  trend,
  className,
}: {
  trend: PulseStream["trend"];
  className?: string;
}) {
  const { lang } = useI18n();
  const copy = getProductCopy(lang).flowPulse;
  const icon =
    trend === "falling" ? (
      <TrendingDown className="size-3.5" />
    ) : trend === "rising" ? (
      <TrendingUp className="size-3.5" />
    ) : (
      <Activity className="size-3.5" />
    );

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground",
        trend === "falling" && "text-rose-600",
        trend === "rising" && "text-emerald-600",
        className
      )}
    >
      {icon}
      {getTrendLabel(copy, trend)}
    </span>
  );
}

function getPolicyPresets(copy: ReturnType<typeof getProductCopy>["flowPulse"]) {
  return [
    {
      name: copy.presets.balanced,
      values: { warningPercent: 35, criticalPercent: 15, staleMinutes: 180 },
    },
    {
      name: copy.presets.guarded,
      values: { warningPercent: 45, criticalPercent: 25, staleMinutes: 120 },
    },
    {
      name: copy.presets.quiet,
      values: { warningPercent: 25, criticalPercent: 10, staleMinutes: 360 },
    },
  ] as const;
}

function getSignalLevelLabel(
  copy: ReturnType<typeof getProductCopy>["flowPulse"],
  level: PulseSignal["level"]
) {
  if (level === "critical") return copy.levels.critical;
  if (level === "warning") return copy.levels.warning;
  return copy.levels.info;
}

function getTrendLabel(
  copy: ReturnType<typeof getProductCopy>["flowPulse"],
  trend: PulseStream["trend"]
) {
  if (trend === "rising") return copy.trends.rising;
  if (trend === "falling") return copy.trends.falling;
  if (trend === "steady") return copy.trends.steady;
  return trend;
}
